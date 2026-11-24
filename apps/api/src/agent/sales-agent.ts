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
import { type Database, schema, type Tx, withTenant } from "@chatea/db";
import { type CheckoutState, windowOpen } from "@chatea/shared";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  AiNotConfiguredError,
  type ModelResolver,
  type TranscriberResolver,
  VISION_KINDS,
} from "../ai/models.js";
import type { Geocoder } from "../carriers/agencias-geo.js";
import { agencyMode, findAgencies, resolveAgency } from "../carriers/servientrega.js";
import {
  createOrderFromConversation,
  type DropiDeps,
  loadDropi,
  resolvePlace,
  uploadOrder,
} from "../orders/service.js";
import type { RealtimeBus } from "../realtime.js";
import { loadProduct } from "../services/catalog.js";
import {
  type SendInput,
  sendToConversation,
  showTyping,
  type WaConfig,
} from "../whatsapp/service.js";
import { CONFIRMED_LABEL, loadAgentPrompt, runAgentTurn, tenantInfo } from "./engine.js";
import { sameReply, splitReply, toModelMessages, withImages } from "./format.js";
import { prepareTurnMedia } from "./media.js";

const { conversations, contacts, messages, products, agentRuns, tenantSettings } = schema;

/** Buscador de agencias Servientrega (URL de la plataforma). */
export interface AgencyDeps {
  url: string;
  encryptionKey: string;
  fetchImpl?: typeof fetch;
  /** Ubica referencias del cliente en el mapa (null = no geocodificar). */
  geocoder?: Geocoder | null;
}

export interface AgentDeps {
  db: Database;
  wa: WaConfig;
  bus: RealtimeBus;
  resolveModel: ModelResolver;
  /** Transcribe audios del cliente (si el tenant tiene un proveedor que transcriba). */
  resolveTranscriber?: TranscriberResolver;
  /** Pedidos → Dropi (sin esto, confirmar no crea el pedido). */
  dropi?: Omit<DropiDeps, "db">;
  /** Buscador de agencias Servientrega (URL de la plataforma). */
  agencies?: AgencyDeps;
  log?: { warn: (o: object, m: string) => void; error: (o: object, m: string) => void };
  /** Pausa con «escribiendo…» entre burbujas (ms por carácter, con tope); 0 en pruebas. */
  typingPaceMs?: number;
}

/** Meta muestra «escribiendo…» hasta 25 s: se renueva mientras la IA piensa. */
const TYPING_REFRESH_MS = 20_000;

const historyQuery = (tx: Tx, conversationId: string) =>
  tx
    .select({
      direction: messages.direction,
      author: messages.author,
      type: messages.type,
      body: messages.body,
      data: messages.data,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    // Orden de llegada: el timestamp de Meta viene en segundos y desordena ráfagas.
    .orderBy(desc(messages.createdAt))
    .limit(HISTORY_LIMIT);

/** Turnos de IA permitidos por conversación en 1 hora antes de pasar a un humano. */
export const MAX_TURNS_PER_HOUR = 20;
const HISTORY_LIMIT = 40;
const HANDOFF_LABEL = "requiere_humano";

type Outcome =
  | { status: "omitido"; reason: string }
  | { status: "embudo" }
  | { status: "ok"; parts: number }
  | { status: "error"; error: string };

/** Motivos por los que la IA no contesta que el asesor tiene que ver en la ficha. */
const VISIBLE_SKIPS = new Set([
  "ia_no_configurada",
  "ventana_cerrada",
  "limite_turnos",
  "producto_no_existe",
  "cerrada",
]);

/**
 * Turno del agente. Además de responder, deja rastro de por qué NO respondió (error del
 * proveedor, límite de turnos, IA sin configurar…) para mostrarlo en la ficha.
 */
export async function runSalesAgent(
  deps: AgentDeps,
  tenantId: string,
  conversationId: string,
): Promise<Outcome> {
  let out: Outcome;
  try {
    out = await salesTurn(deps, tenantId, conversationId);
  } catch (e) {
    const error = (e as Error).message?.slice(0, 500) || "error";
    await recordRun(deps.db, tenantId, conversationId, { status: "error", error }).catch(
      () => null,
    );
    throw e;
  }
  if (out.status === "omitido" && VISIBLE_SKIPS.has(out.reason))
    await recordRun(deps.db, tenantId, conversationId, {
      status: "omitido",
      reply: out.reason,
    }).catch(() => null);
  return out;
}

async function salesTurn(
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
    const history = (await historyQuery(tx, conversationId)).reverse();
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
  const { conv, contact, settings } = ctx;
  const turnHistory = ctx.history;

  // ---------- Guardas ----------
  if (conv.botPaused) return { status: "omitido", reason: "bot_pausado" };
  if (conv.status !== "abierta") return { status: "omitido", reason: "cerrada" };
  if (!windowOpen(conv.lastInboundAt)) return { status: "omitido", reason: "ventana_cerrada" };
  const last = ctx.history[ctx.history.length - 1];
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

  // ---------- «Escribiendo…» mientras la IA piensa ----------
  const typing = () =>
    withTenant(db, tenantId, (tx) => showTyping(tx, deps.wa, conversationId)).catch(() => false);
  void typing();
  const typingTimer = setInterval(() => void typing(), TYPING_REFRESH_MS);
  typingTimer.unref?.();
  try {
    return await think();
  } finally {
    clearInterval(typingTimer);
  }

  async function think(): Promise<Outcome> {
    // ---------- Audios e imágenes del cliente ----------
    const media = await prepareTurnMedia(deps, tenantId, conversationId, {
      vision: resolved.kind ? VISION_KINDS.includes(resolved.kind) : false,
    });
    let history = turnHistory;
    if (media.transcribed > 0)
      history = (
        await withTenant(db, tenantId, (tx) => historyQuery(tx, conversationId))
      ).reverse();

    // ---------- Prompt + modelo con herramientas (motor compartido con el simulador) ----------
    const tenant = await tenantInfo(db, tenantId);
    const prompt = await withTenant(db, tenantId, (tx) =>
      loadAgentPrompt(tx, {
        productId: conv.productId,
        tenantName: tenant.name,
        country: settings?.country ?? tenant.country,
      }),
    );
    if (!prompt) return { status: "omitido", reason: "producto_no_existe" };

    const dropi = deps.dropi ? await loadDropi({ db, ...deps.dropi }, tenantId) : null;
    const mode = deps.agencies?.url
      ? await agencyMode(db, tenantId, deps.agencies.encryptionKey)
      : "off";
    const agencies = mode !== "off" ? deps.agencies : null;

    const started = Date.now();
    let turn: Awaited<ReturnType<typeof runAgentTurn>>;
    const calls: { name: string; input: unknown }[] = [];
    try {
      turn = await runAgentTurn({
        resolved,
        prompt,
        agencyOnly: mode === "solo",
        hasProduct: Boolean(conv.productId),
        checkout: (conv.checkoutState ?? {}) as CheckoutState,
        context: {
          now: new Date(),
          timezone: settings?.timezone ?? tenant.timezone,
          customerName: contact.name ?? contact.profileName ?? "desconocido",
          phone: contact.phone,
        },
        messages: withImages(toModelMessages(history), media.images),
        io: {
          saveCheckout: async (state, label) => {
            await saveCheckout(db, tenantId, conversationId, state, label);
            if (label === CONFIRMED_LABEL) await onConfirmed(deps, tenantId, conversationId);
          },
          handoff: (reason) => handoff(deps, tenantId, conversationId, reason),
          ...(dropi
            ? {
                checkCity: (ciudad: string, provincia?: string) =>
                  resolvePlace(dropi.client, dropi.config.options.rateType, ciudad, provincia, db),
              }
            : {}),
          ...(agencies
            ? {
                findAgencies: (texto: string, hint?: { ciudad?: string }) =>
                  findAgencies(agencies.url, texto, agencies.fetchImpl, {
                    ciudad: hint?.ciudad,
                    geocoder: agencies.geocoder,
                    nombreCliente: [contact.name, contact.profileName].filter(Boolean).join(" "),
                  }),
                chooseAgency: (value: string) =>
                  resolveAgency(agencies.url, value, agencies.fetchImpl),
              }
            : {}),
          selectProduct: (productId) =>
            withTenant(db, tenantId, async (tx) => {
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
            }),
        },
      });
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
    let { reply, handedOff } = turn;
    const { outbox, usage } = turn;
    calls.push(...turn.calls);

    // ---------- Anti-bucle ----------
    const lastAi = [...history].reverse().find((m) => m.direction === "out" && m.author === "ia");
    if (reply && lastAi && sameReply(reply, lastAi.body) && !handedOff) {
      handedOff = true;
      await handoff(deps, tenantId, conversationId, "La IA iba a repetir la misma respuesta.");
      reply = "";
    }

    // ---------- Envío ----------
    const parts = splitReply(reply, 3);
    const queue: SendInput[] = [
      ...parts.map((body) => ({ kind: "text" as const, body })),
      ...outbox,
    ];
    const pace = deps.typingPaceMs ?? 0;
    for (const [i, input] of queue.entries()) {
      // Entre burbujas: «escribiendo…» y una pausa según el largo, como una persona.
      if (i > 0 && pace > 0) {
        await typing();
        const len = input.kind === "text" ? input.body.length : 40;
        await new Promise((r) => setTimeout(r, Math.min(3500, 600 + len * pace)));
      }
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
  await withTenant(db, tenantId, async (tx) => {
    // La ficha del cliente toma el nombre y la ciudad que dio en el chat.
    if (state.nombre?.trim() || state.ciudad?.trim()) {
      const [c] = await tx
        .select({ contactId: conversations.contactId })
        .from(conversations)
        .where(eq(conversations.id, conversationId));
      if (c)
        await tx
          .update(contacts)
          .set({
            ...(state.nombre?.trim()
              ? { name: sql`coalesce(${contacts.name}, ${state.nombre.trim()})` }
              : {}),
            ...(state.ciudad?.trim() ? { city: state.ciudad.trim() } : {}),
          })
          .where(eq(contacts.id, c.contactId));
    }
    await tx
      .update(conversations)
      .set({
        checkoutState: state as Record<string, string>,
        ...(label
          ? {
              labels: sql`(select array_agg(distinct l) from unnest(array_append(${conversations.labels}, ${label})) l)`,
            }
          : {}),
      })
      .where(eq(conversations.id, conversationId));
  });
}

/** El cliente confirmó con la IA: se crea el pedido y, si la tienda lo pide, se sube a Dropi. */
async function onConfirmed(deps: AgentDeps, tenantId: string, conversationId: string) {
  if (!deps.dropi) return;
  const dropiDeps: DropiDeps = { db: deps.db, ...deps.dropi };
  try {
    const { order, created } = await createOrderFromConversation(
      deps.db,
      tenantId,
      conversationId,
      {
        source: "ia",
      },
    );
    deps.bus.publish(tenantId, { type: "conversation", conversationId });
    if (!created) return;
    const dropi = await loadDropi(dropiDeps, tenantId);
    if (!dropi?.config.options.autoUpload) return;
    // En segundo plano: la respuesta al cliente no espera a Dropi.
    void uploadOrder(dropiDeps, tenantId, order.id, { actor: "ia" })
      .then((r) => {
        if (r.status === "error")
          deps.log?.warn({ orderId: order.id, err: r.error }, "no se subió a Dropi");
        deps.bus.publish(tenantId, { type: "conversation", conversationId });
      })
      .catch((err) => deps.log?.error({ orderId: order.id, err }, "falló la subida a Dropi"));
  } catch (err) {
    deps.log?.error({ conversationId, err: (err as Error).message }, "no se pudo crear el pedido");
  }
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
