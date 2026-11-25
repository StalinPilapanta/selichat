/**
 * Etapa del lead de una conversación.
 * - Antes de la venta avanza solo hacia adelante (interesado → datos → ganado) y no pisa lo
 *   que decidió un asesor ni una venta ya hecha.
 * - Después de la venta la manda el pedido en Dropi: en agencia, entregado (cerrado),
 *   devuelto/cancelado (perdido).
 * - Interesado sin respuesta pasa a perdido («No responde»); si vuelve a escribir, se reabre.
 * - Cerrado a las 72 h y perdido a las 48 h se BORRAN (la conversación con sus mensajes y
 *   notas). Los pedidos se conservan sin conversación (seguimiento en Dropi) y el contacto
 *   queda: si vuelve a escribir entra como lead nuevo.
 */
import { type Database, schema, type Tx, withTenant } from "@chatea/db";
import {
  LEAD_FLOW,
  LEAD_HIDE_HOURS,
  LEAD_NO_REPLY_HOURS,
  type LeadStage,
  type OrderStage,
} from "@chatea/shared";
import { and, eq, lt, or, sql } from "drizzle-orm";

const { conversations, channelRoutes } = schema;
const FLOW = sql.raw(`array[${LEAD_FLOW.map((s) => `'${s}'`).join(",")}]::text[]`);
const CLOSED = sql.raw(`('ganado', 'en_agencia', 'cerrado', 'perdido')`);

export async function advanceLead(
  tx: Tx,
  conversationId: string,
  target: LeadStage,
  opts: { force?: boolean; lostReason?: string } = {},
) {
  const cur = conversations.leadStage;
  const allowed = opts.force
    ? sql`(${cur} <> ${target} or (${target} = 'perdido' and ${conversations.lostReason} is distinct from ${opts.lostReason ?? "otro"}))`
    : target === "perdido"
      ? sql`${cur} not in ${CLOSED}`
      : sql`${cur} not in ${CLOSED} and coalesce(array_position(${FLOW}, ${cur}), 0) < array_position(${FLOW}, ${target}::text)`;
  const [row] = await tx
    .update(conversations)
    .set({
      leadStage: target,
      leadStageAt: new Date(),
      lostReason: target === "perdido" ? (opts.lostReason ?? "otro") : null,
    })
    .where(and(eq(conversations.id, conversationId), allowed))
    .returning({ id: conversations.id });
  return Boolean(row);
}

/** Etapa del lead según el estado del pedido (después de la venta manda Dropi). */
export function leadStageForOrder(
  stage: OrderStage,
): { stage: LeadStage; lostReason?: string } | null {
  if (stage === "en_oficina") return { stage: "en_agencia" };
  if (stage === "entregado") return { stage: "cerrado" };
  if (stage === "devolucion") return { stage: "perdido", lostReason: "devuelto" };
  if (stage === "cancelado") return null; // lo resuelve quien cancela (puede haber otro pedido)
  return { stage: "ganado" };
}

export async function syncLeadFromOrder(tx: Tx, conversationId: string, orderStage: OrderStage) {
  const target = leadStageForOrder(orderStage);
  if (!target) return false;
  return advanceLead(tx, conversationId, target.stage, {
    force: true,
    lostReason: target.lostReason,
  });
}

/**
 * Escribió otra vez: un perdido por no responder vuelve a Interesado, igual que un lead que
 * ya salió del tablero (cerrado hace más de 72 h o perdido hace más de 48 h): es otra venta.
 */
export async function reopenOnInbound(tx: Tx, conversationId: string) {
  const c = conversations;
  const hidden = (stage: LeadStage) =>
    sql`(${c.leadStage} = ${stage} and ${c.leadStageAt} < now() - make_interval(hours => ${LEAD_HIDE_HOURS[stage] ?? 0}))`;
  await tx
    .update(c)
    .set({ leadStage: "interesado", leadStageAt: new Date(), lostReason: null })
    .where(
      and(
        eq(c.id, conversationId),
        sql`((${c.leadStage} = 'perdido' and ${c.lostReason} = 'no_responde') or ${hidden("cerrado")} or ${hidden("perdido")})`,
      ),
    );
}

/**
 * Tarea periódica: interesados sin respuesta → perdidos («No responde»), y se borran los
 * cerrados (72 h) y perdidos (48 h).
 */
export async function runLeadHousekeeping(db: Database, now = new Date()) {
  const tenants = await db.selectDistinct({ id: channelRoutes.tenantId }).from(channelRoutes);
  const cutoff = new Date(now.getTime() - LEAD_NO_REPLY_HOURS * 3600_000);
  const before = (stage: "cerrado" | "perdido") =>
    new Date(now.getTime() - (LEAD_HIDE_HOURS[stage] ?? 0) * 3600_000);
  let lost = 0;
  let deleted = 0;
  for (const t of tenants) {
    const gone = await withTenant(db, t.id, (tx) =>
      tx
        .delete(conversations)
        .where(
          or(
            and(
              eq(conversations.leadStage, "cerrado"),
              lt(conversations.leadStageAt, before("cerrado")),
            ),
            and(
              eq(conversations.leadStage, "perdido"),
              lt(conversations.leadStageAt, before("perdido")),
            ),
          ),
        )
        .returning({ id: conversations.id }),
    );
    deleted += gone.length;
    const rows = await withTenant(db, t.id, (tx) =>
      tx
        .update(conversations)
        .set({ leadStage: "perdido", leadStageAt: now, lostReason: "no_responde" })
        .where(
          and(
            eq(conversations.leadStage, "interesado"),
            lt(conversations.lastInboundAt, cutoff),
            // Con un pedido vivo nunca es «no responde».
            sql`not exists (select 1 from orders o where o.conversation_id = ${conversations.id} and o.stage <> 'cancelado')`,
          ),
        )
        .returning({ id: conversations.id }),
    );
    lost += rows.length;
  }
  return { lost, deleted };
}
