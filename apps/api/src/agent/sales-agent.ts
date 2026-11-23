/**
 * Agente IA de ventas (Fase 3a).
 *
 * Por cada turno del cliente (ya agrupado por el scheduler):
 *   1. Guardas: bot pausado, conversación cerrada, ventana de 24 h, último mensaje no es del cliente,
 *      límite de turnos por hora.
 *   2. Embudo inicial fijo (sin IA) la primera vez que se activa un producto.
 *   3. Prompt por capas (plataforma > tienda > maestro > producto) + contexto dinámico
 *      (estado del pedido, hora local) → LLM con herramientas.
 *   4. La respuesta se parte en burbujas y se envía; cada ejecución queda en agent_runs.
 *
 * El LLM corre FUERA de transacciones: cada lectura/escritura usa su propio withTenant corto.
 */
import { type Database, schema, withTenant } from "@chatea/db";
import {
  buildBuiltinVariables,
  type CheckoutState,
  checkoutUpdateSchema,
  composePrompt,
  describeCheckout,
  missingCheckoutFields,
  PLATFORM_PROMPT,
  windowOpen,
} from "@chatea/shared";
import { generateText, stepCountIs, tool } from "ai";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { AiNotConfiguredError, type ModelResolver } from "../ai/models.js";
import type { RealtimeBus } from "../realtime.js";
import { activePrompt, catalogForPrompt, loadProduct } from "../services/catalog.js";
import { type SendInput, sendToConversation, type WaConfig } from "../whatsapp/service.js";
import { sameReply, splitReply, toModelMessages } from "./format.js";

const { conversations, contacts, messages, products, productTriggers, agentRuns, tenantSettings } =
  schema;

export interface AgentDeps {
  db: Database;
  wa: WaConfig;
  bus: RealtimeBus;
  resolveModel: ModelResolver;
  log?: { warn: (o: object, m: string) => void; error: (o: object, m: string) => void };
}

/** Turnos de IA permitidos por conversación en 1 hora antes de pasar a un humano. */
export const MAX_TURNS_PER_HOUR = 20;
const HISTORY_LIMIT = 40;
const HANDOFF_LABEL = "requiere_humano";
const CONFIRMED_LABEL = "pedido_confirmado";

/** Capa de herramientas: cómo debe usar el modelo las tools (se suma al prompt). */
const TOOLS_PROMPT = `Herramientas:
- update_order_data: registra cada dato del pedido apenas el cliente lo dé (nombre, teléfono, ciudad, dirección, cantidad u oferta, variante). Llama a la herramienta y luego responde.
- confirm_order: cuando estén todos los datos obligatorios y el cliente haya aceptado el resumen del pedido.
- send_media: envía una imagen, video o audio del producto por su número de recurso cuando ayude a vender (no repitas uno ya enviado).
- handoff_to_human: si el cliente pide hablar con una persona, está molesto, hace un reclamo, o pregunta algo que no está en tus instrucciones.
Responde SIEMPRE con texto para el cliente después de usar herramientas. Separa ideas distintas con una línea en blanco: cada párrafo se envía como un mensaje aparte (máximo 3).`;

type Outcome =
  | { status: "omitido"; reason: string }
  | { status: "embudo" }
  | { status: "ok"; parts: number }
  | { status: "error"; error: string };

export async function runSalesAgent(
  deps: AgentDeps,
  tenantId: string,
  conversationId: string,
): Promise<Outcome> {
  const { db } = deps;
  const ctx = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ conv: conversations, contact: contacts })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(eq(conversations.id, conversationId));
    if (!row) return null;
    const history = (
      await tx
        .select({
          direction: messages.direction,
          author: messages.author,
          type: messages.type,
          body: messages.body,
          status: messages.status,
        })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        // Orden de llegada: el timestamp de Meta viene en segundos y desordena ráfagas.
        .orderBy(desc(messages.createdAt))
        .limit(HISTORY_LIMIT)
    ).reverse();
    const [settings] = await tx.select().from(tenantSettings);
    const [turns] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.conversationId, conversationId),
          eq(agentRuns.status, "ok"),
          gte(agentRuns.createdAt, new Date(Date.now() - 3600_000)),
        ),
      );
    return { ...row, history, settings, turns: turns?.n ?? 0 };
  });
  if (!ctx) return { status: "omitido", reason: "no_existe" };
  const { conv, contact, history, settings } = ctx;

  // ---------- Guardas ----------
  if (conv.botPaused) return { status: "omitido", reason: "bot_pausado" };
  if (conv.status !== "abierta") return { status: "omitido", reason: "cerrada" };
  if (!windowOpen(conv.lastInboundAt)) return { status: "omitido", reason: "ventana_cerrada" };
  const last = history[history.length - 1];
  if (last?.direction !== "in") return { status: "omitido", reason: "ya_respondido" }; // p. ej. un asesor contestó antes
  if (ctx.turns >= MAX_TURNS_PER_HOUR) {
    await handoff(deps, tenantId, conversationId, "La IA llegó al límite de turnos por hora.");
    return { status: "omitido", reason: "limite_turnos" };
  }

  // ---------- Embudo inicial (sin IA) ----------
  if (conv.productId && !conv.funnelSentAt) {
    const sent = await sendFunnel(deps, tenantId, conversationId, conv.productId);
    if (sent) return { status: "embudo" };
  }

  // ---------- Modelo ----------
  let resolved: Awaited<ReturnType<ModelResolver>>;
  try {
    resolved = await deps.resolveModel(tenantId, "ventas");
  } catch (e) {
    if (e instanceof AiNotConfiguredError)
      return { status: "omitido", reason: "ia_no_configurada" };
    throw e;
  }

  // ---------- Prompt ----------
  const [org] = await db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, tenantId));
  const prompt = await withTenant(db, tenantId, async (tx) => {
    const common = await activePrompt(tx, "common", null);
    if (!conv.productId) {
      const catalog = await tx
        .select({
          id: products.id,
          name: products.name,
          price: products.price,
          currency: products.currency,
        })
        .from(products)
        .where(eq(products.status, "activo"))
        .orderBy(asc(products.name))
        .limit(50);
      const keywords = await tx
        .select({ productId: productTriggers.productId, value: productTriggers.value })
        .from(productTriggers)
        .where(eq(productTriggers.kind, "keyword"));
      const list = catalog
        .map((p) => {
          const kw = keywords.filter((k) => k.productId === p.id).map((k) => k.value);
          return `- id=${p.id} | ${p.name} | ${p.price} ${p.currency}${kw.length ? ` | palabras: ${kw.join(", ")}` : ""}`;
        })
        .join("\n");
      return {
        text: [
          PLATFORM_PROMPT,
          common?.content ?? "",
          `Tienda: ${org?.name ?? ""}. El cliente aún no eligió producto. Saluda, entiende qué busca y, cuando quede claro cuál producto le interesa, llama a select_product con su id. No inventes productos fuera de esta lista:\n${list || "(catálogo vacío)"}`,
        ]
          .filter((t) => t.trim())
          .join("\n\n---\n\n"),
        media: [] as { kind: string; url: string; caption: string }[],
      };
    }
    const product = await loadProduct(tx, conv.productId);
    if (!product) return null;
    const [master, productPrompt] = await Promise.all([
      activePrompt(tx, "master", null),
      activePrompt(tx, "product", product.id),
    ]);
    const composed = composePrompt({
      platform: PLATFORM_PROMPT,
      common: common?.content,
      master: master?.content,
      product: {
        mode: (productPrompt?.mode ?? "libre") as "libre" | "guiado",
        content: productPrompt?.content ?? "",
        sections: productPrompt?.sections ?? {},
        variables: productPrompt?.variables ?? {},
      },
      builtins: buildBuiltinVariables(
        catalogForPrompt(product, { name: org?.name ?? "", country: settings?.country ?? "" }),
      ),
    });
    return { text: composed.text, media: product.media };
  });
  if (!prompt) return { status: "omitido", reason: "producto_no_existe" };

  const checkout = (conv.checkoutState ?? {}) as CheckoutState;
  const now = new Intl.DateTimeFormat("es", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: settings?.timezone ?? "America/Guayaquil",
  }).format(new Date());
  const mediaList = prompt.media
    .map((m, i) => `${i + 1}. [${m.kind}] ${m.caption || "(sin descripción)"}`)
    .join("\n");
  const system = [
    prompt.text,
    TOOLS_PROMPT,
    `Contexto de esta conversación (datos del sistema, no del cliente):
- Fecha y hora local: ${now}
- Nombre de WhatsApp del cliente: ${contact.name ?? contact.profileName ?? "desconocido"}
- Teléfono del cliente: ${contact.phone}
${describeCheckout(checkout)}${mediaList ? `\nRecursos disponibles para send_media:\n${mediaList}` : ""}`,
  ].join("\n\n---\n\n");

  // ---------- Herramientas ----------
  const outbox: SendInput[] = [];
  const calls: { name: string; input: unknown }[] = [];
  let state: CheckoutState = { ...checkout };
  let handedOff = false;

  const tools = {
    update_order_data: tool({
      description: "Registra o corrige datos del pedido que el cliente acaba de dar.",
      inputSchema: checkoutUpdateSchema.omit({ etapa: true }),
      execute: async (input) => {
        calls.push({ name: "update_order_data", input });
        const clean = Object.fromEntries(
          Object.entries(input).filter(([, v]) => typeof v === "string" && v.trim()),
        );
        state = {
          ...state,
          ...clean,
          etapa: state.etapa === "confirmado" ? "confirmado" : "datos",
        };
        await saveCheckout(db, tenantId, conversationId, state);
        return { ok: true, faltan: missingCheckoutFields(state) };
      },
    }),
    confirm_order: tool({
      description: "Marca el pedido como confirmado por el cliente.",
      inputSchema: z.object({}),
      execute: async () => {
        calls.push({ name: "confirm_order", input: {} });
        const faltan = missingCheckoutFields(state);
        if (faltan.length) return { ok: false, faltan };
        state = { ...state, etapa: "confirmado" };
        await saveCheckout(db, tenantId, conversationId, state, CONFIRMED_LABEL);
        return { ok: true };
      },
    }),
    handoff_to_human: tool({
      description: "Pasa la conversación a un asesor humano y pausa la IA.",
      inputSchema: z.object({ reason: z.string().max(300) }),
      execute: async ({ reason }) => {
        calls.push({ name: "handoff_to_human", input: { reason } });
        handedOff = true;
        await handoff(deps, tenantId, conversationId, reason);
        return { ok: true };
      },
    }),
    ...(prompt.media.length
      ? {
          send_media: tool({
            description: "Envía un recurso del producto (imagen, video o audio) por su número.",
            inputSchema: z.object({ resource: z.number().int().min(1) }),
            execute: async ({ resource }) => {
              calls.push({ name: "send_media", input: { resource } });
              const m = prompt.media[resource - 1];
              if (!m || !["image", "video", "audio", "document"].includes(m.kind))
                return { ok: false, error: "recurso_no_existe" };
              outbox.push({
                kind: "media",
                mediaType: m.kind as "image" | "video" | "audio" | "document",
                url: m.url,
                caption: m.caption || undefined,
              });
              return { ok: true };
            },
          }),
        }
      : {}),
    ...(!conv.productId
      ? {
          select_product: tool({
            description: "Fija el producto que le interesa al cliente (id del catálogo).",
            inputSchema: z.object({ productId: z.uuid() }),
            execute: async ({ productId }) => {
              calls.push({ name: "select_product", input: { productId } });
              const ok = await withTenant(db, tenantId, async (tx) => {
                const [p] = await tx
                  .select({ id: products.id })
                  .from(products)
                  .where(and(eq(products.id, productId), eq(products.status, "activo")));
                if (!p) return false;
                await tx
                  .update(conversations)
                  .set({ productId })
                  .where(eq(conversations.id, conversationId));
                return true;
              });
              return ok ? { ok: true } : { ok: false, error: "producto_no_existe" };
            },
          }),
        }
      : {}),
  };

  // ---------- LLM ----------
  const started = Date.now();
  let reply = "";
  let usage = { input: 0, output: 0, cached: 0, steps: 0 };
  try {
    const result = await generateText({
      model: resolved.model,
      temperature: resolved.temperature,
      system,
      messages: toModelMessages(history),
      tools,
      stopWhen: stepCountIs(5),
      maxOutputTokens: 800,
    });
    reply = result.text.trim();
    usage = {
      input: result.totalUsage.inputTokens ?? 0,
      output: result.totalUsage.outputTokens ?? 0,
      cached: result.totalUsage.inputTokenDetails?.cacheReadTokens ?? 0,
      steps: result.steps.length,
    };
  } catch (e) {
    const error = (e as Error).message.slice(0, 500);
    await recordRun(db, tenantId, conversationId, {
      model: resolved.label,
      status: "error",
      latencyMs: Date.now() - started,
      toolCalls: calls,
      error,
    });
    deps.log?.error({ conversationId, err: error }, "falló el agente de ventas");
    return { status: "error", error };
  }

  // ---------- Anti-bucle ----------
  const lastAi = [...history].reverse().find((m) => m.direction === "out" && m.author === "ia");
  if (reply && lastAi && sameReply(reply, lastAi.body) && !handedOff) {
    handedOff = true;
    await handoff(deps, tenantId, conversationId, "La IA iba a repetir la misma respuesta.");
    reply = "";
  }

  // ---------- Envío ----------
  const parts = splitReply(reply, 3);
  const queue: SendInput[] = [...parts.map((body) => ({ kind: "text" as const, body })), ...outbox];
  for (const input of queue) {
    const msg = await withTenant(db, tenantId, (tx) =>
      sendToConversation(tx, deps.wa, conversationId, input, { kind: "ia" }),
    );
    if (msg) deps.bus.publish(tenantId, { type: "message", conversationId, messageId: msg.id });
  }

  await recordRun(db, tenantId, conversationId, {
    model: resolved.label,
    status: "ok",
    inputTokens: usage.input,
    outputTokens: usage.output,
    cachedTokens: usage.cached,
    steps: usage.steps,
    latencyMs: Date.now() - started,
    toolCalls: calls,
    reply,
  });
  return { status: "ok", parts: queue.length };
}

/** Mensaje inicial + media "inicial" + pregunta de entrada del producto. */
async function sendFunnel(
  deps: AgentDeps,
  tenantId: string,
  conversationId: string,
  productId: string,
): Promise<boolean> {
  const product = await withTenant(deps.db, tenantId, async (tx) => {
    // Se marca antes de enviar: si dos turnos compiten, solo uno manda el embudo.
    const [claimed] = await tx
      .update(conversations)
      .set({ funnelSentAt: new Date() })
      .where(and(eq(conversations.id, conversationId), sql`${conversations.funnelSentAt} is null`))
      .returning({ id: conversations.id });
    return claimed ? loadProduct(tx, productId) : null;
  });
  if (!product) return false;
  const queue: SendInput[] = [];
  if (product.initialMessage.trim())
    queue.push({ kind: "text", body: product.initialMessage.trim() });
  for (const m of product.media.filter((x) => x.usage === "inicial")) {
    if (!["image", "video", "audio", "document"].includes(m.kind)) continue;
    queue.push({
      kind: "media",
      mediaType: m.kind as "image" | "video" | "audio" | "document",
      url: m.url,
      caption: m.caption || undefined,
    });
  }
  if (product.entryQuestion.trim())
    queue.push({ kind: "text", body: product.entryQuestion.trim() });
  // Producto sin embudo configurado: que responda la IA directamente.
  if (!queue.length) return false;
  for (const input of queue) {
    const msg = await withTenant(deps.db, tenantId, (tx) =>
      sendToConversation(tx, deps.wa, conversationId, input, { kind: "ia" }),
    );
    if (msg) deps.bus.publish(tenantId, { type: "message", conversationId, messageId: msg.id });
  }
  await recordRun(deps.db, tenantId, conversationId, {
    model: "embudo",
    status: "ok",
    reply: `embudo: ${queue.length} mensajes`,
  });
  return true;
}

async function saveCheckout(
  db: Database,
  tenantId: string,
  conversationId: string,
  state: CheckoutState,
  label?: string,
) {
  await withTenant(db, tenantId, (tx) =>
    tx
      .update(conversations)
      .set({
        checkoutState: state as Record<string, string>,
        ...(label
          ? {
              labels: sql`(select array_agg(distinct l) from unnest(array_append(${conversations.labels}, ${label})) l)`,
            }
          : {}),
      })
      .where(eq(conversations.id, conversationId)),
  );
}

async function handoff(deps: AgentDeps, tenantId: string, conversationId: string, reason: string) {
  await withTenant(deps.db, tenantId, (tx) =>
    tx
      .update(conversations)
      .set({
        botPaused: true,
        handoffReason: reason.slice(0, 300),
        labels: sql`(select array_agg(distinct l) from unnest(array_append(${conversations.labels}, ${HANDOFF_LABEL})) l)`,
      })
      .where(eq(conversations.id, conversationId)),
  );
  deps.bus.publish(tenantId, { type: "conversation", conversationId });
}

async function recordRun(
  db: Database,
  tenantId: string,
  conversationId: string,
  run: Partial<typeof agentRuns.$inferInsert> & { status: string },
) {
  await withTenant(db, tenantId, (tx) =>
    tx.insert(agentRuns).values({ agent: "ventas", ...run, conversationId }),
  );
}
