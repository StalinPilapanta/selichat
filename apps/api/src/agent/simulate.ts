/**
 * Banco de pruebas del agente de ventas: corre el MISMO motor que en WhatsApp
 * (engine.ts) pero con efectos en memoria. Nada se envía ni se guarda.
 *
 * - chatTurn: un turno manual (el asesor escribe como si fuera el cliente).
 * - simulateConversation: un cliente simulado por IA conversa con el agente y un juez
 *   evalúa criterios (pide los datos que faltan, no repite preguntas, precio correcto…).
 */
import { type Database, withTenant } from "@chatea/db";
import type { CheckoutState } from "@chatea/shared";
import { generateText, type ModelMessage, Output } from "ai";
import { z } from "zod";
import type { ModelResolver } from "../ai/models.js";
import { agencyMode, findAgencies, resolveAgency } from "../carriers/servientrega.js";
import { type DropiDeps, loadDropi, resolvePlace } from "../orders/service.js";
import { loadProduct } from "../services/catalog.js";
import { type AgentPrompt, loadAgentPrompt, runAgentTurn, tenantInfo } from "./engine.js";
import { splitReply } from "./format.js";
import type { AgencyDeps } from "./sales-agent.js";

export interface SimDeps {
  db: Database;
  resolveModel: ModelResolver;
  dropi?: Omit<DropiDeps, "db">;
  agencies?: AgencyDeps;
}

export interface SimMessage {
  role: "cliente" | "agente";
  text: string;
  tools?: string[];
}

export class SimError extends Error {}

/** Criterios que se evalúan siempre (se pueden sumar propios). */
export const DEFAULT_CHECKS = [
  "Responde en mensajes cortos y naturales, como por WhatsApp.",
  "Usa solo precios y ofertas que están en sus instrucciones; no inventa datos.",
  "Pide los datos del pedido que faltan (nombre, ciudad, dirección, cantidad) sin volver a pedir los que el cliente ya dio.",
  "Responde las dudas u objeciones del cliente antes de insistir con la venta.",
  "Si el cliente quiere comprar, llega a confirmar el pedido.",
];

async function context(deps: SimDeps, tenantId: string, productId: string) {
  const tenant = await tenantInfo(deps.db, tenantId);
  const loaded = await withTenant(deps.db, tenantId, async (tx) => {
    const product = await loadProduct(tx, productId);
    if (!product) return null;
    const prompt = await loadAgentPrompt(tx, {
      productId,
      tenantName: tenant.name,
      country: tenant.country,
    });
    return prompt ? { product, prompt } : null;
  });
  if (!loaded) throw new SimError("producto_no_existe");
  const resolved = await deps.resolveModel(tenantId, "ventas");
  // Mismas herramientas que en WhatsApp: cobertura de Dropi y agencias (solo lectura).
  const dropi = deps.dropi ? await loadDropi({ db: deps.db, ...deps.dropi }, tenantId) : null;
  const mode = deps.agencies?.url
    ? await agencyMode(deps.db, tenantId, deps.agencies.encryptionKey)
    : "off";
  const agencies = mode !== "off" ? deps.agencies : null;
  return {
    tenant,
    resolved,
    dropi,
    agencies,
    agencyOnly: mode === "solo",
    db: deps.db,
    ...loaded,
  };
}

/** Embudo inicial del producto, igual que el primer contacto real. */
function funnel(product: { initialMessage: string; entryQuestion: string }): SimMessage[] {
  return [product.initialMessage, product.entryQuestion]
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ role: "agente" as const, text }));
}

const toModel = (msgs: SimMessage[]): ModelMessage[] => {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of msgs) {
    const role = m.role === "cliente" ? "user" : "assistant";
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n${m.text}`;
    else out.push({ role, content: m.text });
  }
  while (out.length && out[0]?.role === "assistant") out.shift();
  return out;
};

async function agentReply(
  c: Awaited<ReturnType<typeof context>>,
  prompt: AgentPrompt,
  history: SimMessage[],
  checkout: CheckoutState,
) {
  const { dropi, agencies } = c;
  const turn = await runAgentTurn({
    resolved: c.resolved,
    prompt,
    agencyOnly: c.agencyOnly,
    hasProduct: true,
    checkout,
    context: {
      now: new Date(),
      timezone: c.tenant.timezone,
      customerName: "Cliente de prueba",
      phone: "593990000000",
    },
    messages: toModel(history),
    io: {
      saveCheckout: async () => {},
      handoff: async () => {},
      selectProduct: async () => true,
      ...(dropi
        ? {
            checkCity: (ciudad: string, provincia?: string) =>
              resolvePlace(dropi.client, dropi.config.options.rateType, ciudad, provincia, c.db),
          }
        : {}),
      ...(agencies
        ? {
            findAgencies: (texto: string, hint?: { ciudad?: string }) =>
              findAgencies(agencies.url, texto, agencies.fetchImpl, {
                ciudad: hint?.ciudad,
                geocoder: agencies.geocoder,
              }),
            chooseAgency: (value: string) => resolveAgency(agencies.url, value, agencies.fetchImpl),
          }
        : {}),
    },
  });
  const tools = turn.calls.map((x) => x.name);
  const texts = splitReply(turn.reply, 3);
  const media = turn.outbox
    .filter((o) => o.kind === "media")
    .map((o) => `[envía ${o.kind === "media" ? o.mediaType : ""}]`);
  const replies: SimMessage[] = [...texts, ...media].map((text, i) => ({
    role: "agente",
    text,
    tools: i === 0 ? tools : undefined,
  }));
  if (!replies.length && tools.length) replies.push({ role: "agente", text: "(sin texto)", tools });
  return { replies, checkout: turn.state, handedOff: turn.handedOff, usage: turn.usage };
}

/** Un turno manual: devuelve las respuestas del agente y el pedido actualizado. */
export async function chatTurn(
  deps: SimDeps,
  tenantId: string,
  input: { productId: string; history: SimMessage[]; checkout: CheckoutState },
) {
  const c = await context(deps, tenantId, input.productId);
  const history = input.history.length ? input.history : funnel(c.product);
  if (history[history.length - 1]?.role !== "cliente")
    return { replies: input.history.length ? [] : history, checkout: input.checkout };
  const r = await agentReply(c, c.prompt, history, input.checkout);
  return { replies: r.replies, checkout: r.checkout, handedOff: r.handedOff, usage: r.usage };
}

const verdictSchema = z.object({
  checks: z.array(
    z.object({
      criterio: z.string(),
      cumple: z.boolean(),
      detalle: z.string().describe("Por qué, citando el mensaje si no cumple"),
    }),
  ),
  resumen: z.string().describe("Una o dos frases para el dueño de la tienda"),
});

export interface SimulationInput {
  productId: string;
  persona: string;
  maxTurns: number;
  checks: string[];
}

/** Cliente simulado por IA vs agente, y un juez que evalúa los criterios. */
export async function simulateConversation(deps: SimDeps, tenantId: string, s: SimulationInput) {
  const c = await context(deps, tenantId, s.productId);
  const transcript: SimMessage[] = funnel(c.product);
  if (!transcript.length) transcript.push({ role: "agente", text: "¡Hola! ¿En qué te ayudo?" });
  let checkout: CheckoutState = {};
  let handedOff = false;
  const usage = { input: 0, output: 0 };
  const customerInstructions = `Eres un CLIENTE real escribiendo por WhatsApp a una tienda de ${c.tenant.country || "Latinoamérica"} que vende "${c.product.name}". Llegaste por un anuncio.
Tu perfil y comportamiento: ${s.persona}
Escribe como cliente: mensajes cortos, informales, a veces con faltas. Inventa datos verosímiles (nombre, ciudad, dirección) cuando te los pidan, si tu perfil es de comprar.
Nunca digas que eres una IA. Si ya confirmaste el pedido o decidiste no comprar, responde exactamente: [FIN]`;

  for (let turn = 0; turn < s.maxTurns && !handedOff; turn++) {
    // El cliente ve la conversación desde su lado (roles invertidos).
    const customerView: ModelMessage[] = transcript.map((m) => ({
      role: m.role === "agente" ? "user" : "assistant",
      content: m.text,
    }));
    const said = await generateText({
      model: c.resolved.model,
      temperature: 0.8,
      maxOutputTokens: 200,
      instructions: customerInstructions,
      messages: customerView,
    });
    usage.input += said.totalUsage.inputTokens ?? 0;
    usage.output += said.totalUsage.outputTokens ?? 0;
    const text = said.text.trim();
    if (!text || text.includes("[FIN]")) break;
    transcript.push({ role: "cliente", text });

    const r = await agentReply(c, c.prompt, transcript, checkout);
    usage.input += r.usage.input;
    usage.output += r.usage.output;
    transcript.push(...r.replies);
    checkout = r.checkout;
    handedOff = r.handedOff;
  }

  const checks = [...DEFAULT_CHECKS, ...s.checks.map((x) => x.trim()).filter(Boolean)];
  const judged = await generateText({
    model: c.resolved.model,
    temperature: 0,
    maxOutputTokens: 1500,
    output: Output.object({ schema: verdictSchema }),
    instructions: `Eres un supervisor de ventas que evalúa a un agente de WhatsApp. Juzga SOLO los mensajes del AGENTE con estos criterios y responde uno por uno, en el mismo orden.
Instrucciones que tenía el agente (para verificar precios y datos):
${c.prompt.text.slice(0, 12000)}`,
    messages: [
      {
        role: "user",
        content: `Criterios:\n${checks.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\nConversación:\n${transcript
          .map(
            (m) =>
              `${m.role.toUpperCase()}: ${m.text}${m.tools?.length ? `  {herramientas: ${m.tools.join(", ")}}` : ""}`,
          )
          .join("\n")}\n\nDatos del pedido registrados al final: ${JSON.stringify(checkout)}`,
      },
    ],
  });
  usage.input += judged.totalUsage.inputTokens ?? 0;
  usage.output += judged.totalUsage.outputTokens ?? 0;
  const verdict = judged.output;
  return {
    transcript,
    checkout,
    handedOff,
    verdict: { ...verdict, passed: verdict.checks.every((x) => x.cumple) },
    usage,
    model: c.resolved.label,
  };
}
