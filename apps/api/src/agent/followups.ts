/**
 * Recordatorios automáticos ("¿sigues interesado?") configurados por producto
 * en Catálogo → Seguimiento → Recordatorios.
 *
 * Regla: el tiempo de cada paso cuenta desde el ÚLTIMO mensaje del cliente, y solo se envía
 * si después de ese mensaje le respondimos y él no volvió a escribir. Cuando el cliente
 * escribe, el contador se reinicia (whatsapp/service.ts → followUpsSent = 0).
 *
 * - Dentro de las 24 h: texto libre (fijo o redactado por la IA).
 * - Después de 24 h: solo la plantilla aprobada del paso; si no tiene, el paso se salta.
 * - Solo en el horario de envío de la tienda; nunca con el bot pausado ni con pedido confirmado.
 * - Si hay varios pasos vencidos (p. ej. el servidor estuvo caído) se envía solo el último.
 */
import { type Database, schema, withTenant } from "@chatea/db";
import { PLATFORM_PROMPT } from "@chatea/shared";
import { generateText } from "ai";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { ModelResolver } from "../ai/models.js";
import type { RealtimeBus } from "../realtime.js";
import { type SendInput, sendToConversation, type WaConfig } from "../whatsapp/service.js";
import { toModelMessages } from "./format.js";

const { conversations, products, messages, tenantSettings, channelRoutes, agentRuns } = schema;

const WINDOW_MS = 24 * 3600_000;

type ProductFollowUps = schema.ProductFollowUps;
type Step = ProductFollowUps["reminders"][number];

export interface FollowUpDeps {
  db: Database;
  wa: WaConfig;
  bus: RealtimeBus;
  resolveModel: ModelResolver;
  log?: { error: (o: object, m: string) => void };
}

/** Índice del paso a enviar (el último vencido aún no enviado) o null. */
export function dueStep(
  steps: Step[],
  sent: number,
  lastInboundAt: Date,
  now: Date,
): number | null {
  const elapsed = (now.getTime() - lastInboundAt.getTime()) / 60_000;
  let due: number | null = null;
  for (let i = sent; i < steps.length; i++) {
    const s = steps[i];
    if (s && elapsed >= s.delayMinutes) due = i;
  }
  return due;
}

/** ¿La hora local de la tienda está dentro de su horario de envío? (admite horarios que cruzan medianoche) */
export function inSendingHours(
  window: { start: string; end: string },
  timeZone: string,
  now: Date,
): boolean {
  const hm = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(now);
  const { start, end } = window;
  if (start === end) return true;
  return start < end ? hm >= start && hm < end : hm >= start || hm < end;
}

/** Pasos activos, ordenados por tiempo. */
export const activeSteps = (f: ProductFollowUps | null | undefined): Step[] =>
  (f?.reminders ?? []).filter((s) => s.enabled).sort((a, b) => a.delayMinutes - b.delayMinutes);

/** Una pasada por todas las tiendas. La llama un intervalo en app.ts. */
export async function runFollowUps(
  deps: FollowUpDeps,
  now = new Date(),
  /** Limitar a ciertas tiendas (pruebas). */
  only?: string[],
): Promise<number> {
  const all = await deps.db.selectDistinct({ id: channelRoutes.tenantId }).from(channelRoutes);
  const tenants = only ? all.filter((t) => only.includes(t.id)) : all;
  let sent = 0;
  for (const t of tenants) {
    try {
      sent += await runTenant(deps, t.id, now);
    } catch (e) {
      deps.log?.error({ err: e, tenantId: t.id }, "falló el seguimiento automático");
    }
  }
  return sent;
}

async function runTenant(deps: FollowUpDeps, tenantId: string, now: Date): Promise<number> {
  const { db } = deps;
  const { candidates, settings } = await withTenant(db, tenantId, async (tx) => {
    const [settings] = await tx.select().from(tenantSettings);
    const candidates = await tx
      .select({
        id: conversations.id,
        sent: conversations.followUpsSent,
        lastInboundAt: conversations.lastInboundAt,
        checkout: conversations.checkoutState,
        followUps: products.followUps,
        productName: products.name,
      })
      .from(conversations)
      .innerJoin(products, eq(products.id, conversations.productId))
      .where(
        and(
          eq(conversations.status, "abierta"),
          eq(conversations.botPaused, false),
          isNotNull(conversations.lastInboundAt),
          // Le respondimos después de su último mensaje y no volvió a escribir.
          sql`${conversations.lastMessageAt} > ${conversations.lastInboundAt}`,
          // Aún hay pasos por enviar (filtro grueso; el fino es en JS).
          sql`${conversations.followUpsSent} < jsonb_array_length(${products.followUps}->'reminders')`,
        ),
      )
      .limit(200);
    return { candidates, settings };
  });
  if (
    !inSendingHours(
      settings?.messagingWindow ?? { start: "08:00", end: "22:00" },
      settings?.timezone ?? "America/Guayaquil",
      now,
    )
  )
    return 0;

  let count = 0;
  for (const c of candidates) {
    if (!c.lastInboundAt) continue;
    const etapa = (c.checkout as Record<string, string>)?.etapa;
    if (etapa === "confirmado" || etapa === "cancelado") continue;
    const steps = activeSteps(c.followUps);
    const idx = dueStep(steps, c.sent, c.lastInboundAt, now);
    if (idx === null) continue;
    const step = steps[idx];
    if (!step) continue;

    // Reclama el paso (si otra pasada ya lo tomó, no hace nada).
    const claimed = await withTenant(db, tenantId, (tx) =>
      tx
        .update(conversations)
        .set({ followUpsSent: idx + 1 })
        .where(and(eq(conversations.id, c.id), eq(conversations.followUpsSent, c.sent)))
        .returning({ id: conversations.id }),
    );
    if (!claimed.length) continue;

    const windowOpen = now.getTime() - c.lastInboundAt.getTime() < WINDOW_MS;
    let input: SendInput | null = null;
    if (!windowOpen) {
      if (step.template?.name)
        input = {
          kind: "template",
          name: step.template.name,
          language: step.template.lang || "es",
          params: [],
          preview: `[plantilla ${step.template.name}]`,
        };
    } else if (step.mode === "ia") {
      input = await aiReminder(deps, tenantId, c.id, c.productName, step.message);
    } else if (step.message.trim()) {
      input = { kind: "text", body: step.message.trim() };
    }
    if (!input) continue;

    const toSend = input;
    const msg = await withTenant(db, tenantId, (tx) =>
      sendToConversation(tx, deps.wa, c.id, toSend, { kind: "ia" }),
    );
    if (msg) {
      count++;
      deps.bus.publish(tenantId, { type: "message", conversationId: c.id, messageId: msg.id });
    }
    await withTenant(db, tenantId, (tx) =>
      tx.insert(agentRuns).values({
        conversationId: c.id,
        agent: "seguimiento",
        model: step.mode === "ia" && windowOpen ? "ia" : "fijo",
        status: msg?.status === "fallido" ? "error" : "ok",
        reply: `recordatorio ${idx + 1}: ${msg?.body ?? ""}`.slice(0, 2000),
      }),
    );
  }
  return count;
}

/** La IA redacta el recordatorio siguiendo la instrucción del paso y el historial. */
async function aiReminder(
  deps: FollowUpDeps,
  tenantId: string,
  conversationId: string,
  productName: string,
  instruction: string,
): Promise<SendInput | null> {
  try {
    const resolved = await deps.resolveModel(tenantId, "ventas");
    const history = (
      await withTenant(deps.db, tenantId, (tx) =>
        tx
          .select({
            direction: messages.direction,
            author: messages.author,
            type: messages.type,
            body: messages.body,
          })
          .from(messages)
          .where(eq(messages.conversationId, conversationId))
          .orderBy(desc(messages.createdAt))
          .limit(20),
      )
    ).reverse();
    const result = await generateText({
      model: resolved.model,
      temperature: resolved.temperature,
      maxOutputTokens: 300,
      system: `${PLATFORM_PROMPT}

El cliente dejó de responder durante la venta de "${productName}". Escribe UN solo mensaje corto de seguimiento para retomar la conversación, sin repetir textualmente mensajes anteriores ni inventar ofertas.
Instrucción de la tienda para este recordatorio: ${instruction || "pregunta amablemente si aún le interesa"}`,
      messages: [
        ...toModelMessages(history),
        { role: "user", content: "(sistema: el cliente no respondió; escribe el recordatorio)" },
      ],
    });
    const text = result.text.trim();
    return text ? { kind: "text", body: text } : null;
  } catch (e) {
    deps.log?.error({ err: e, conversationId }, "la IA no pudo redactar el recordatorio");
    return null;
  }
}
