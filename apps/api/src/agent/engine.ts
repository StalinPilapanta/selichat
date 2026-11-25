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
  ORDER_STAGES,
  type OrderStage,
  PLATFORM_PROMPT,
} from "@chatea/shared";
import { generateText, type ModelMessage, stepCountIs, tool } from "ai";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ResolvedModel } from "../ai/models.js";
import type { Agency, AgencySearch } from "../carriers/servientrega.js";
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

/**
 * Flujo de venta de inicio a fin (capa de plataforma, vale para todos los productos).
 * El guion del producto da el tono y los argumentos; esto asegura que la venta se cierre
 * con todos los datos y que después de confirmar no se vuelva a vender ni se derive.
 */
export function salesFlowPrompt(agencyOnly: boolean, agencies: boolean) {
  const entrega = agencyOnly
    ? "ciudad y la agencia Servientrega donde retira (con find_agencies y choose_agency; no hay entrega a domicilio)"
    : agencies
      ? "ciudad y, según prefiera, dirección de entrega con una referencia o la agencia Servientrega donde retira"
      : "ciudad y dirección de entrega con una referencia";
  return `Flujo de la venta (síguelo en orden; la "Etapa" del contexto dice dónde vas):
1. Descubrimiento: saluda, entiende para quién es y qué necesita. Una pregunta a la vez.
2. Oferta: conecta beneficios con su necesidad y ofrece las opciones del catálogo (recomienda una). Resuelve objeciones con lo que dicen tus instrucciones.
3. Datos: cuando quiera comprar, pide solo lo que falte (mira "Faltan para confirmar"), máximo dos datos por mensaje: nombre y apellido, ${entrega}, y la cantidad u oferta. Registra cada dato apenas lo dé.
4. Resumen: con todo registrado, envía un resumen corto: producto, cantidad/oferta, total, nombre, ciudad, ${agencyOnly ? "agencia" : "dirección o agencia"} y pago contra entrega. Pregunta "¿Confirmamos tu pedido?".
5. Confirmación: cuando acepte, llama confirm_order y cierra: pedido registrado, ${agencyOnly ? "agencia donde retira (nombre, dirección y horario)" : "dónde lo recibe"}, que pagará al recibir y que le enviaremos la guía y le avisaremos cuando llegue. No inventes tiempos de entrega que no estén en tus instrucciones.
6. Después de confirmar (Etapa confirmado): la venta ya está hecha. No vuelvas a ofrecer ni a pedir datos. Responde sus dudas con el "Estado del pedido" del contexto (agencia, guía, estado). Si quiere cambiar un dato y el pedido aún no está en Dropi, corrígelo con update_order_data; si ya está en Dropi, pásalo a un asesor con handoff_to_human.
Tú gestionas la entrega y la agencia con tus herramientas: nunca respondas "eso lo ve logística" ni derives algo que puedes resolver con los datos que tienes.`;
}

export const CONFIRMED_LABEL = "pedido_confirmado";

/** Tiempo máximo de un turno del modelo (incluye herramientas). */
export const TURN_TIMEOUT_MS = 90_000;

export interface AgentPrompt {
  text: string;
  media: { kind: string; url: string; caption: string }[];
}

/** Primera línea útil de la descripción (beneficio en pocas palabras). */
function shortDescription(text: string) {
  const line = text
    .split(/\n|(?<=[.!?])\s/)
    .map((l) => l.replace(/[*_#>`]/g, "").trim())
    .find((l) => l.length > 8);
  return line ? (line.length > 110 ? `${line.slice(0, 107)}…` : line) : "";
}

/**
 * Cliente que escribe sin palabra clave ni anuncio: la IA pregunta qué le interesa, muestra los
 * productos disponibles (y el sitio web de la tienda) y al elegir sigue el flujo de ese producto.
 */
export function noProductPrompt(
  tenantName: string,
  catalog: { id: string; name: string; description: string; price: string; currency: string }[],
  keywords: { productId: string; value: string }[],
  websiteUrl: string | null,
) {
  const list = catalog
    .map((p) => {
      const kw = keywords.filter((k) => k.productId === p.id).map((k) => k.value);
      const desc = shortDescription(p.description);
      return `- id=${p.id} | ${p.name}${desc ? ` — ${desc}` : ""} | ${p.price} ${p.currency}${kw.length ? ` | palabras: ${kw.join(", ")}` : ""}`;
    })
    .join("\n");
  return `## Cliente sin producto elegido (${tenantName})
El cliente escribió sin decir qué producto busca (no usó una palabra clave ni vino de un anuncio).
1. Saluda con calidez en un mensaje corto y pregúntale con qué producto le podemos ayudar o qué necesita resolver.
2. Muéstrale los productos disponibles en una lista breve: un renglón por producto con su nombre y para qué sirve (sin precios ni ids, salvo que pregunte el precio).${websiteUrl ? `\n3. Invítalo a ver todo el catálogo en ${websiteUrl}.` : ""}
- Si menciona un síntoma o necesidad, recomienda el producto que mejor encaje y explica por qué en una frase.
- Apenas quede claro cuál producto le interesa, llama a select_product con su id y continúa con el flujo de venta de ese producto. No pidas datos de entrega antes de elegir producto.
- Si ya escribió algo que coincide con un producto (nombre o palabra clave), llama a select_product sin volver a preguntar.
- No inventes productos fuera de esta lista. Si no tenemos lo que busca, dilo con amabilidad y ofrece lo más cercano.

Productos disponibles:
${list || "(catálogo vacío)"}`;
}

/** Prompt del producto (o de catálogo general si aún no hay producto). null = producto no existe. */
export async function loadAgentPrompt(
  tx: Tx,
  opts: { productId: string | null; tenantName: string; country: string },
): Promise<AgentPrompt | null> {
  const common = await activePrompt(tx, "common", null);
  if (!opts.productId) {
    const [catalog, keywords, [settings], master] = await Promise.all([
      tx
        .select({
          id: products.id,
          name: products.name,
          description: products.description,
          price: products.price,
          currency: products.currency,
        })
        .from(products)
        .where(eq(products.status, "activo"))
        .orderBy(asc(products.name))
        .limit(50),
      tx
        .select({ productId: productTriggers.productId, value: productTriggers.value })
        .from(productTriggers)
        .where(eq(productTriggers.kind, "keyword")),
      tx.select({ websiteUrl: schema.tenantSettings.websiteUrl }).from(schema.tenantSettings),
      activePrompt(tx, "master", null),
    ]);
    return {
      text: [
        PLATFORM_PROMPT,
        common?.content ?? "",
        master?.content ?? "",
        noProductPrompt(opts.tenantName, catalog, keywords, settings?.websiteUrl ?? null),
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
  findAgencies?(texto: string, hint?: { ciudad?: string }): Promise<AgencySearch>;
  /** Valida la agencia elegida (registro o nombre de una agencia mostrada). */
  chooseAgency?(value: string): Promise<Agency | null>;
}

const AGENCY_STEPS = `  · find_agencies con la ciudad y el sector, barrio o una referencia tal como lo dijo el cliente (si lo corrige, usa lo más reciente). Según "estado": unica → confírmale esa agencia; cercanas → ofrécele la primera como la más cercana y las otras como opción; lista → muéstralas numeradas (nombre corto y dirección) y pídele que responda con el número; falta_sector → pídele el sector o barrio, o una referencia (parque, colegio, avenida, centro comercial), y vuelve a buscar; sin_retiro o sin_ciudad → explícale con amabilidad y pide otra zona o ciudad.
  · Si el cliente nombra una zona o agencia ("Huachi Grande", "la del centro"), relaciónala con las mostradas; si no está, búscala con find_agencies.
  · Cuando elija, llama choose_agency con el "registro" exacto de esa agencia: eso deja agencia, ciudad y provincia en el pedido. Nunca escribas la agencia a mano con update_order_data ni inventes agencias; solo se ofrecen las que devuelve la herramienta (todas entregan en oficina).
  · Al confirmar el pedido, dile la agencia donde retira (nombre, dirección y horario de lunes a viernes y sábados si aplica) y que le avisaremos cuando el paquete llegue.`;

const AGENCY_PROMPT_OPCION = `- Retiro en agencia Servientrega (opcional): cuando el cliente dé su ciudad, ofrécele retirar el pedido en una agencia Servientrega cercana como alternativa a la entrega a domicilio. Si prefiere la agencia:
${AGENCY_STEPS}`;

const AGENCY_PROMPT_SOLO = `- ENTREGA EN AGENCIA SERVIENTREGA (regla de la tienda, tiene prioridad sobre el guion): todos los pedidos se envían a una agencia Servientrega donde el cliente retira y paga; NO hay entrega a domicilio, así que no pidas dirección de domicilio. Los datos de entrega son: nombre y apellido, ciudad y la agencia elegida. Pide ciudad y sector o barrio donde le quede mejor retirarlo:
${AGENCY_STEPS}`;

const CITY_PROMPT = `- check_city: apenas el cliente diga su ciudad, verifícala (con su provincia si la dio). Si hay varias con ese nombre, pregúntale la provincia; si no hay cobertura, díselo con amabilidad y pide otra ciudad o una dirección cercana.`;

export interface TurnInput {
  resolved: ResolvedModel;
  /** Pedido de la conversación (para responder en la posventa). */
  order?: {
    stage: string;
    dropiOrderId: string | null;
    trackingCode: string | null;
    carrier: string | null;
    total: string;
    currency: string;
  } | null;
  /** La tienda solo envía a agencia: la agencia reemplaza a la dirección (obligatoria). */
  agencyOnly?: boolean;
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
  const chooseAgency = t.io.chooseAgency?.bind(t.io);
  const rules = { agencyOnly: Boolean(t.agencyOnly && findAgencies) };
  const agencyPrompt =
    findAgencies && (rules.agencyOnly ? AGENCY_PROMPT_SOLO : AGENCY_PROMPT_OPCION);
  const stableSystem = [
    t.prompt.text,
    [
      TOOLS_PROMPT,
      salesFlowPrompt(rules.agencyOnly, Boolean(findAgencies)),
      checkCity && CITY_PROMPT,
      agencyPrompt,
    ]
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
${describeCheckout(t.checkout, rules)}${
  t.order
    ? `\nEstado del pedido: ${ORDER_STAGES[t.order.stage as OrderStage] ?? t.order.stage}${t.order.dropiOrderId ? ` · Dropi #${t.order.dropiOrderId}` : ""}${t.order.trackingCode ? ` · guía ${t.order.trackingCode}` : ""}${t.order.carrier ? ` · ${t.order.carrier}` : ""} · total ${t.order.total} ${t.order.currency}`
    : ""
}`;

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
        return { ok: true, faltan: missingCheckoutFields(state, rules) };
      },
    }),
    confirm_order: tool({
      description: "Marca el pedido como confirmado por el cliente.",
      inputSchema: z.object({}),
      execute: async () => {
        calls.push({ name: "confirm_order", input: {} });
        const faltan = missingCheckoutFields(state, rules);
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
              "Busca las agencias Servientrega con retiro en oficina para la ciudad y el sector, barrio o referencia del cliente.",
            inputSchema: z.object({
              texto: z
                .string()
                .min(2)
                .max(200)
                .describe("Ciudad y sector, barrio, calles o referencia, como lo dijo el cliente"),
            }),
            execute: async ({ texto }) => {
              calls.push({ name: "find_agencies", input: { texto } });
              try {
                const r = await findAgencies(texto, { ciudad: state.ciudad });
                return {
                  ok: r.agencias.length > 0 || r.estado === "falta_sector",
                  estado: r.estado,
                  ciudad: r.ciudad,
                  agenciasConRetiroEnLaCiudad: r.totalCiudad,
                  nota: r.nota || undefined,
                  agencias: r.agencias.map((a) => ({
                    registro: a.registro,
                    nombre: a.nombreCorto,
                    direccion: a.direccion,
                    sector: a.sector,
                    horario: a.horario,
                    sabados: a.finDeSemana,
                    ...("distanciaKm" in a && typeof a.distanciaKm === "number"
                      ? { distanciaKm: a.distanciaKm }
                      : {}),
                  })),
                };
              } catch {
                return { ok: false, motivo: "No se pudo consultar las agencias ahora." };
              }
            },
          }),
          ...(chooseAgency
            ? {
                choose_agency: tool({
                  description:
                    "Registra la agencia Servientrega que eligió el cliente (el registro que devolvió find_agencies).",
                  inputSchema: z.object({ registro: z.string().min(3).max(300) }),
                  execute: async ({ registro }) => {
                    calls.push({ name: "choose_agency", input: { registro } });
                    const a = await chooseAgency(registro).catch(() => null);
                    if (!a)
                      return {
                        ok: false,
                        motivo: "Esa agencia no está en la búsqueda: vuelve a usar find_agencies.",
                      };
                    if (!a.entregaEnOficina)
                      return { ok: false, motivo: "Esa agencia no entrega paquetes al cliente." };
                    let ciudad = a.ciudad;
                    let provincia = a.provincia;
                    let aviso: string | undefined;
                    // El destino en Dropi es la ciudad de la agencia: se valida su cobertura.
                    if (checkCity) {
                      const c = await checkCity(a.ciudad, a.provincia).catch(() => null);
                      if (c?.ok) {
                        ciudad = c.city;
                        provincia = c.department;
                      } else if (c && !c.ok) aviso = c.reason;
                    }
                    state = {
                      ...state,
                      agencia: a.registro,
                      ciudad,
                      provincia,
                      etapa: state.etapa === "confirmado" ? "confirmado" : "datos",
                    };
                    await t.io.saveCheckout(state);
                    return {
                      ok: true,
                      agencia: a.nombreCorto,
                      direccion: a.direccion,
                      horario: a.horario,
                      sabados: a.finDeSemana,
                      ciudad,
                      provincia,
                      aviso,
                      faltan: missingCheckoutFields(state, rules),
                    };
                  },
                }),
              }
            : {}),
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
    // Sin límite, un proveedor colgado deja la conversación bloqueada (no responde nunca).
    abortSignal: AbortSignal.timeout(TURN_TIMEOUT_MS),
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
