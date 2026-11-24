/**
 * Avisos al cliente por WhatsApp según el estado del pedido (como alertas.py del bot de ventas):
 * - «retiro»: el paquete llegó a la agencia u oficina de la transportadora;
 * - «recordatorio»: sigue en la agencia sin retirar después de N días (una sola vez);
 * - «novedad»: la transportadora reporta una novedad.
 *
 * Dentro de las 24 h del último mensaje del cliente se envía texto; después, solo la plantilla
 * aprobada que la tienda configuró (si no hay, queda anotado en el historial del pedido).
 * Cada aviso se envía una sola vez por pedido (order_events.payload.aviso).
 */
import { schema, withTenant } from "@chatea/db";
import { agencyLabel, type OrderNotices, type OrderStage } from "@chatea/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { directorio } from "../carriers/agencias-geo.js";
import type { RealtimeBus } from "../realtime.js";
import { type SendInput, sendToConversation, type WaConfig } from "../whatsapp/service.js";
import { type DropiDeps, loadDropi } from "./service.js";

const { orders, orderEvents, conversations, contacts, dropiRoutes } = schema;
const WINDOW_MS = 24 * 3600_000;

export interface NotifyDeps extends DropiDeps {
  wa: WaConfig;
  bus: RealtimeBus;
}

type Aviso = "retiro" | "recordatorio" | "novedad";
type OrderRow = typeof orders.$inferSelect;

const LABEL: Record<Aviso, string> = {
  retiro: "llegada a la agencia",
  recordatorio: "recordatorio de retiro",
  novedad: "novedad",
};

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? "";

/** Datos de la agencia (horario) desde el directorio, por el nombre registrado. */
function agencyInfo(registro: string | undefined) {
  if (!registro) return null;
  const [nombreRaw = "", , direccion = ""] = registro.split("---");
  const nombre = nombreRaw.trim().toUpperCase();
  const a = directorio().find((x) => x.nombre.toUpperCase() === nombre);
  return {
    nombre: a?.nombreCorto ?? nombre,
    ciudad: a?.ciudad ?? "",
    direccion: a?.direccion ?? direccion,
    horario: a?.horario ?? "",
    sabados: a?.finDeSemana ?? "",
  };
}

function message(aviso: Aviso, o: OrderRow, nombre: string, producto: string) {
  const ag = agencyInfo(o.customer.agencia);
  const pago =
    o.rateType === "CON RECAUDO" ? ` y el valor a pagar: $${Number(o.total).toFixed(2)}` : "";
  const guia = o.trackingCode ? `\n\nGuía: ${o.trackingCode}` : "";
  const sabados =
    ag?.sabados && !/^(no|-|cerrado)/i.test(ag.sabados) ? ` · sábados ${ag.sabados}` : "";
  const donde = ag
    ? `la agencia Servientrega *${ag.nombre}*${ag.ciudad ? ` (${ag.ciudad.toLowerCase()})` : ""}\n📍 ${ag.direccion}${ag.horario ? `\n🕒 Lunes a viernes ${ag.horario}${sabados}` : ""}`
    : `la oficina de ${o.carrier || "la transportadora"}`;
  const hola = `¡Hola${nombre ? ` ${nombre}` : ""}! 😊`;
  if (aviso === "retiro")
    return `${hola} Tu pedido de ${producto} ya llegó a ${donde}\n\nAcércate con tu cédula${pago}.${guia}`;
  if (aviso === "recordatorio")
    return `${hola} Te recordamos que tu pedido de ${producto} sigue esperándote en ${donde}\n\nRetíralo pronto para que no se devuelva 🙏${guia}`;
  return `${hola} La transportadora nos reporta una novedad con tu pedido de ${producto}${o.dropiStatus ? ` (${o.dropiStatus.toLowerCase()})` : ""}. ¿Nos confirmas tu dirección o cuándo puedes recibirlo para reprogramar la entrega?${guia}`;
}

/** Envía el aviso si no se envió antes. Devuelve si se envió. */
async function send(
  deps: NotifyDeps,
  tenantId: string,
  o: OrderRow,
  aviso: Aviso,
  notices: OrderNotices,
): Promise<boolean> {
  const convId = o.conversationId;
  if (!convId) return false;
  const ctx = await withTenant(deps.db, tenantId, async (tx) => {
    const [done] = await tx
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, o.id), sql`${orderEvents.payload}->>'aviso' = ${aviso}`))
      .limit(1);
    if (done) return null;
    const [c] = await tx
      .select({ lastInboundAt: conversations.lastInboundAt, name: contacts.name })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(eq(conversations.id, convId));
    return c ?? null;
  });
  if (!ctx) return false;

  const nombre = firstName(o.customer.nombre || ctx.name || "");
  const producto = o.items[0]?.name ?? "tu producto";
  const windowOpen = ctx.lastInboundAt && Date.now() - ctx.lastInboundAt.getTime() < WINDOW_MS;
  const plantilla = aviso === "novedad" ? notices.plantillaNovedad : notices.plantillaRetiro;
  const ag = agencyInfo(o.customer.agencia);
  let input: SendInput | null = null;
  if (windowOpen) input = { kind: "text", body: message(aviso, o, nombre, producto) };
  else if (plantilla)
    input = {
      kind: "template",
      name: plantilla,
      language: notices.idioma || "es",
      // Parámetros como las plantillas del bot: retiro {nombre, producto, agencia, ciudad}.
      params:
        aviso === "novedad"
          ? [producto]
          : [
              nombre || "cliente",
              producto,
              ag?.nombre ?? agencyLabel(o.customer.agencia),
              ag?.ciudad || o.customer.ciudad,
            ],
      preview: `[plantilla ${plantilla}] ${LABEL[aviso]} · ${producto}`,
    };

  if (!input) {
    await withTenant(deps.db, tenantId, (tx) =>
      tx.insert(orderEvents).values({
        orderId: o.id,
        source: "sistema",
        stage: o.stage,
        message: `No se avisó la ${LABEL[aviso]}: pasaron más de 24 h desde el último mensaje del cliente y no hay plantilla configurada.`,
        payload: { aviso, enviado: false },
      }),
    );
    return false;
  }
  const toSend = input;
  const msg = await withTenant(deps.db, tenantId, (tx) =>
    sendToConversation(tx, deps.wa, convId, toSend, { kind: "sistema" }),
  );
  if (msg)
    deps.bus.publish(tenantId, { type: "message", conversationId: convId, messageId: msg.id });
  const ok = Boolean(msg) && msg?.status !== "fallido";
  await withTenant(deps.db, tenantId, (tx) =>
    tx.insert(orderEvents).values({
      orderId: o.id,
      source: "sistema",
      stage: o.stage,
      message: ok
        ? `Aviso de ${LABEL[aviso]} enviado por WhatsApp${toSend.kind === "template" ? " (plantilla)" : ""}.`
        : `Falló el aviso de ${LABEL[aviso]} por WhatsApp.`,
      payload: { aviso, enviado: ok },
    }),
  );
  return ok;
}

/** Al cambiar la etapa (webhook o consulta): avisa la llegada a la agencia o una novedad. */
export async function notifyStage(
  deps: NotifyDeps,
  tenantId: string,
  orderId: string,
  stage: OrderStage,
) {
  if (stage !== "en_oficina" && stage !== "novedad") return false;
  const dropi = await loadDropi(deps, tenantId);
  const notices = dropi?.config.options.notices;
  if (!notices) return false;
  if (stage === "en_oficina" ? !notices.retiro : !notices.novedad) return false;
  const [o] = await withTenant(deps.db, tenantId, (tx) =>
    tx.select().from(orders).where(eq(orders.id, orderId)),
  );
  if (!o) return false;
  return send(deps, tenantId, o, stage === "novedad" ? "novedad" : "retiro", notices);
}

/** Pedidos que siguen en la agencia después de N días: un recordatorio por pedido. */
export async function runPickupReminders(deps: NotifyDeps) {
  const tenants = await deps.db.select({ tenantId: dropiRoutes.tenantId }).from(dropiRoutes);
  let sent = 0;
  for (const { tenantId } of tenants) {
    const dropi = await loadDropi(deps, tenantId).catch(() => null);
    const notices = dropi?.config.options.notices;
    if (!notices?.retiro || !notices.recordatorioDias) continue;
    const cutoff = new Date(Date.now() - notices.recordatorioDias * 86400_000);
    const due = await withTenant(deps.db, tenantId, async (tx) => {
      const rows = await tx.select().from(orders).where(eq(orders.stage, "en_oficina")).limit(200);
      const out: OrderRow[] = [];
      for (const o of rows) {
        // Desde cuándo está en la agencia: el último evento que la dejó en esa etapa.
        const [since] = await tx
          .select({ at: orderEvents.createdAt })
          .from(orderEvents)
          .where(
            and(
              eq(orderEvents.orderId, o.id),
              eq(orderEvents.stage, "en_oficina"),
              eq(orderEvents.source, "dropi"),
            ),
          )
          .orderBy(desc(orderEvents.createdAt))
          .limit(1);
        if ((since?.at ?? o.updatedAt) <= cutoff) out.push(o);
      }
      return out;
    });
    for (const o of due) if (await send(deps, tenantId, o, "recordatorio", notices)) sent++;
  }
  return { sent };
}
