/**
 * Motor de un turno del agente de ventas, independiente de WhatsApp y de la base:
 * prompt por capas → modelo con herramientas → respuesta + efectos.
 * Lo usan el agente real (sales-agent.ts, efectos en DB/WhatsApp) y el simulador del
 * banco de pruebas (simulate.ts, efectos en memoria).
 */
import { type Database, schema, type Tx, withTenant } from "@chatea/db";
import {
  buildBuiltinVariables,
  type CheckoutState,
  checkoutUpdateSchema,
  composePrompt,
  describeCheckout,
  missingCheckoutFields,
  PLATFORM_PROMPT,
} from "@chatea/shared";
import { generateText, type ModelMessage, stepCountIs, tool } from "ai";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ResolvedModel } from "../ai/models.js";
import type { Agency } from "../carriers/servientrega.js";
import { activePrompt, catalogForPrompt, loadProduct } from "../services/catalog.js";
import type { SendInput } from "../whatsapp/service.js";

const { products, productTriggers } = schema;

/** Cómo debe usar el modelo las herramientas (se suma al prompt). */
export const TOOLS_PROMPT = `Herramientas:
- update_order_data: registra cada dato del pedido apenas el cliente lo dé (nombre, teléfono, provincia, ciudad, dirección, cantidad u oferta, variante). Llama a la herramienta y luego responde.
- confirm_order: cuando estén todos los datos obligatorios y el cliente haya aceptado el resumen del pedido.
- send_media: envía una imagen, video o audio del producto por su número de recurso cuando ayude a vender (no repitas uno ya enviado).
- handoff_to_human: si el cliente pide hablar con una persona, está molesto, hace un reclamo, o pregunta algo que no está en tus instrucciones.
Responde SIEMPRE con texto para el cliente después de usar herramientas. Separa ideas distintas con una línea en blanco: cada párrafo se envía como un mensaje aparte (máximo 3).`;

export const CONFIRMED_LABEL = "pedido_confirmado";

export interface AgentPrompt {
  text: string;
  media: { kind: string; url: string; caption: string }[];
}

/** Prompt del producto (o de catálogo general si aún no hay producto). null = producto no existe. */
export async function loadAgentPrompt(
  tx: Tx,
  opts: { productId: string | null; tenantName: string; country: string },
): Promise<AgentPrompt | null> {
  const common = await activePrompt(tx, "common", null);
  if (!opts.productId) {
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
        `Tienda: ${opts.tenantName}. El cliente aún no eligió producto. Saluda, entiende qué busca y, cuando quede claro cuál producto le interesa, llama a select_product con su id. No inventes productos fuera de esta lista:\n${list || "(catálogo vacío)"}`,
      ]
        .filter((t) => t.trim())
        .join("\n\n---\n\n"),
      media: [],
    };
  }
  const product = await loadProduct(tx, opts.productId);
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
      catalogForPrompt(product, { name: opts.tenantName, country: opts.country }),
    ),
  });
  return { text: composed.text, media: product.media };
}

/** Nombre, país y zona horaria de la tienda. */
export async function tenantInfo(db: Database, tenantId: string) {
  const [org] = await db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, tenantId));
  const settings = await withTenant(db, tenantId, async (tx) => {
    const [s] = await tx.select().from(schema.tenantSettings);
    return s;
  });
  return {
    name: org?.name ?? "",
    country: settings?.country ?? "",
    timezone: settings?.timezone ?? "America/Guayaquil",
  };
}

/** Efectos de las herramientas: DB/WhatsApp en el agente real, memoria en el simulador. */
export interface TurnIO {
  saveCheckout(state: CheckoutState, label?: string): Promise<void>;
  handoff(reason: string): Promise<void>;
  selectProduct(productId: string): Promise<boolean>;
  /** Valida la ciudad contra la cobertura de Dropi (solo si la tienda conectó Dropi). */
  checkCity?(
    ciudad: string,
    provincia?: string,
  ): Promise<
    | { ok: true; city: string; department: string }
    | { ok: false; reason: string; options?: string[] }
  >;
  /** Agencias de Servientrega cerca de lo que dijo el cliente (si la tienda lo activó). */
  findAgencies?(texto: string): Promise<{ ciudad: string | null; agencias: Agency[] }>;
}

const AGENCY_PROMPT = `- find_agencies: cuando el cliente dé su ciudad y sector (o pregunte por retirar en oficina), busca las agencias de Servientrega cercanas y ofrécele retirar ahí como alternativa a la entrega a domicilio: nombre, dirección y horario, priorizando las que "entregan en oficina" (las que no, NO las ofrezcas para retiro). Si elige una, regístrala con update_order_data en el campo agencia (nombre y dirección). No inventes agencias.`;

const CITY_PROMPT = `- check_city: apenas el cliente diga su ciudad, verifícala (con su provincia si la dio). Si hay varias con ese nombre, pregúntale la provincia; si no hay cobertura, díselo con amabilidad y pide otra ciudad o una dirección cercana.`;

export interface TurnInput {
  resolved: ResolvedModel;
  prompt: AgentPrompt;
  /** ¿La conversación ya tiene producto? (si no, se ofrece select_product) */
  hasProduct: boolean;
  checkout: CheckoutState;
  context: { now: Date; timezone: string; customerName: string; phone: string };
  messages: ModelMessage[];
  io: TurnIO;
}

export interface TurnResult {
  reply: string;
  outbox: SendInput[];
  calls: { name: string; input: unknown }[];
  state: CheckoutState;
  handedOff: boolean;
  usage: { input: number; output: number; cached: number; steps: number };
}

export async function runAgentTurn(t: TurnInput): Promise<TurnResult> {
  const now = new Intl.DateTimeFormat("es", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: t.context.timezone,
  }).format(t.context.now);
  const media = t.prompt.media;
  const mediaList = media
    .map((m, i) => `${i + 1}. [${m.kind}] ${m.caption || "(sin descripción)"}`)
    .join("\n");
  // Caché de prompt: la parte fija (instrucciones + catálogo + recursos) va primero y es
  // idéntica en cada turno, así el proveedor la reutiliza (Anthropic con cacheControl;
  // OpenAI, xAI y Gemini cachean prefijos automáticamente). Lo que cambia va después.
  const checkCity = t.io.checkCity?.bind(t.io);
  const findAgencies = t.io.findAgencies?.bind(t.io);
  const stableSystem = [
    t.prompt.text,
    [TOOLS_PROMPT, checkCity && CITY_PROMPT, findAgencies && AGENCY_PROMPT]
      .filter(Boolean)
      .join("\n"),
    mediaList ? `Recursos disponibles para send_media:\n${mediaList}` : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
  const dynamicSystem = `Contexto de esta conversación (datos del sistema, no del cliente):
- Fecha y hora local: ${now}
- Nombre de WhatsApp del cliente: ${t.context.customerName}
- Teléfono del cliente: ${t.context.phone}
${describeCheckout(t.checkout)}`;

  const outbox: SendInput[] = [];
  const calls: { name: string; input: unknown }[] = [];
  let state: CheckoutState = { ...t.checkout };
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
        await t.io.saveCheckout(state);
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
        await t.io.saveCheckout(state, CONFIRMED_LABEL);
        return { ok: true };
      },
    }),
    handoff_to_human: tool({
      description: "Pasa la conversación a un asesor humano y pausa la IA.",
      inputSchema: z.object({ reason: z.string().max(300) }),
      execute: async ({ reason }) => {
        calls.push({ name: "handoff_to_human", input: { reason } });
        handedOff = true;
        await t.io.handoff(reason);
        return { ok: true };
      },
    }),
    ...(media.length
      ? {
          send_media: tool({
            description: "Envía un recurso del producto (imagen, video o audio) por su número.",
            inputSchema: z.object({ resource: z.number().int().min(1) }),
            execute: async ({ resource }) => {
              calls.push({ name: "send_media", input: { resource } });
              const m = media[resource - 1];
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
    ...(checkCity
      ? {
          check_city: tool({
            description:
              "Verifica si hay envío a la ciudad del cliente y la registra en el pedido.",
            inputSchema: z.object({
              ciudad: z.string().min(2).max(80),
              provincia: z.string().max(80).optional(),
            }),
            execute: async ({ ciudad, provincia }) => {
              calls.push({ name: "check_city", input: { ciudad, provincia } });
              try {
                const r = await checkCity(ciudad, provincia);
                if (!r.ok) return { ok: false, motivo: r.reason, opciones: r.options };
                state = {
                  ...state,
                  ciudad: r.city,
                  provincia: r.department,
                  etapa: state.etapa === "confirmado" ? "confirmado" : "datos",
                };
                await t.io.saveCheckout(state);
                return { ok: true, ciudad: r.city, provincia: r.department };
              } catch {
                // Dropi no responde: no se bloquea la venta, se valida al subir.
                return { ok: true, nota: "No se pudo verificar ahora; continúa con la venta." };
              }
            },
          }),
        }
      : {}),
    ...(findAgencies
      ? {
          find_agencies: tool({
            description:
              "Busca agencias de Servientrega cercanas a la ciudad y sector que indicó el cliente.",
            inputSchema: z.object({
              texto: z.string().min(2).max(200).describe("Ciudad y sector o calles del cliente"),
            }),
            execute: async ({ texto }) => {
              calls.push({ name: "find_agencies", input: { texto } });
              try {
                const r = await findAgencies(texto);
                if (!r.agencias.length)
                  return { ok: false, motivo: "No hay agencias de Servientrega en esa zona." };
                return { ok: true, ciudad: r.ciudad, agencias: r.agencias };
              } catch {
                return { ok: false, motivo: "No se pudo consultar las agencias ahora." };
              }
            },
          }),
        }
      : {}),
    ...(!t.hasProduct
      ? {
          select_product: tool({
            description: "Fija el producto que le interesa al cliente (id del catálogo).",
            inputSchema: z.object({ productId: z.uuid() }),
            execute: async ({ productId }) => {
              calls.push({ name: "select_product", input: { productId } });
              const ok = await t.io.selectProduct(productId);
              return ok ? { ok: true } : { ok: false, error: "producto_no_existe" };
            },
          }),
        }
      : {}),
  };

  const result = await generateText({
    model: t.resolved.model,
    temperature: t.resolved.temperature,
    instructions: [
      {
        role: "system",
        content: stableSystem,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      { role: "system", content: dynamicSystem },
    ],
    messages: t.messages,
    tools,
    stopWhen: stepCountIs(5),
    maxOutputTokens: 800,
  });
  return {
    reply: result.text.trim(),
    outbox,
    calls,
    state,
    handedOff,
    usage: {
      input: result.totalUsage.inputTokens ?? 0,
      output: result.totalUsage.outputTokens ?? 0,
      cached: result.totalUsage.inputTokenDetails?.cacheReadTokens ?? 0,
      steps: result.steps.length,
    },
  };
}
