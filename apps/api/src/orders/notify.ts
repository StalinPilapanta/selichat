/**
 * Agente logístico: avisos por WhatsApp al cliente según el estado del pedido en Dropi
 * (guía generada, en camino, llegó a la agencia, recordatorio de retiro, entregado, novedad).
 *
 * - Texto editable por aviso con variables ({nombre}, {guia}, {agencia}…). Dentro de las 24 h
 *   del último mensaje del cliente se envía ese texto; después, solo la plantilla aprobada (si no
 *   hay, queda anotado en el historial del pedido).
 * - Respeta el horario de envío de la tienda: fuera de horario no se envía al momento y la tarea
 *   periódica lo manda cuando abre el horario (solo cambios de las últimas 72 h).
 * - Cada aviso sale una sola vez por pedido (order_events.payload.aviso).
 */
import { schema, withTenant } from "@chatea/db";
import {
  agencyLabel,
  NOTICE_INFO,
  NOTICE_TEMPLATE_PARAMS,
  type NoticeKind,
  type OrderNotices,
  type OrderStage,
  renderNotice,
} from "@chatea/shared";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { inSendingHours } from "../agent/followups.js";
import { directorio } from "../carriers/agencias-geo.js";
import type { RealtimeBus } from "../realtime.js";
import { type SendInput, sendToConversation, type WaConfig } from "../whatsapp/service.js";
import { type DropiDeps, loadDropi } from "./service.js";

const {
  orders,
  orderEvents,
  conversations,
  contacts,
  dropiRoutes,
  tenantSettings,
  messageTemplates,
  organization,
} = schema;
const WINDOW_MS = 24 * 3600_000;
/** Solo se avisa de cambios recientes: al activar un aviso no se escribe a pedidos viejos. */
const RECENT_MS = 72 * 3600_000;

export interface NotifyDeps extends DropiDeps {
  wa: WaConfig;
  bus: RealtimeBus;
  /** false en pruebas: no depender de la hora a la que corren. */
  respectHours?: boolean;
}

type OrderRow = typeof orders.$inferSelect;

/** Etapa del pedido → aviso que le corresponde. */
const STAGE_NOTICE: Partial<Record<OrderStage, NoticeKind>> = {
  guia_generada: "guia",
  en_transito: "transito",
  en_oficina: "retiro",
  entregado: "entregado",
  novedad: "novedad",
};

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? "";

/** Agencia registrada (NOMBRE---SECTOR---DIRECCIÓN) con su horario del directorio. */
function agencyInfo(registro: string | undefined) {
  if (!registro) return null;
  const [nombreRaw = "", , direccion = ""] = registro.split("---");
  const nombre = nombreRaw.trim().toUpperCase();
  const a = directorio().find((x) => x.nombre.toUpperCase() === nombre);
  const sabados =
    a?.finDeSemana && !/^(no|-|cerrado)/i.test(a.finDeSemana) ? ` · sábados ${a.finDeSemana}` : "";
  return {
    nombre: a ? `la agencia Servientrega *${a.nombreCorto}*` : agencyLabel(registro),
    ciudad: a?.ciudad ?? "",
    direccion: a?.direccion ?? direccion,
    horario: a?.horario ? `Lunes a viernes ${a.horario}${sabados}` : "",
  };
}

/** Valores de las variables del aviso para este pedido. */
export function noticeVars(
  o: OrderRow,
  ctx: { nombre: string; tienda: string; trackingUrl: string },
): Record<string, string> {
  const ag = agencyInfo(o.customer.agencia);
  const carrier = o.carrier || (o.customer.agencia ? "Servientrega" : "");
  const guia = o.trackingCode ?? "";
  return {
    nombre: ctx.nombre,
    producto: o.items[0]?.name ?? "tu producto",
    guia,
    seguimiento:
      ctx.trackingUrl && guia ? ctx.trackingUrl.replaceAll("{guia}", encodeURIComponent(guia)) : "",
    transportadora: carrier,
    agencia:
      ag?.nombre ?? (carrier ? `la oficina de ${carrier}` : "la oficina de la transportadora"),
    direccion_agencia: ag?.direccion ?? "",
    horario: ag?.horario ?? "",
    total: o.rateType === "CON RECAUDO" ? `$${Number(o.total).toFixed(2)}` : "",
    ciudad: (ag?.ciudad || o.customer.ciudad || "").toString(),
    estado: (o.dropiStatus ?? "").toLowerCase(),
    tienda: ctx.tienda,
  };
}

/** Cuántas variables ({{n}}) pide el cuerpo de la plantilla. */
function templateVarCount(components: Record<string, unknown>[]) {
  const body = components.find((c) => String(c.type).toUpperCase() === "BODY");
  const text = typeof body?.text === "string" ? body.text : "";
  return Math.max(0, ...[...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
}

type TenantCtx = { notices: OrderNotices; tienda: string; inHours: boolean };

async function tenantCtx(deps: NotifyDeps, tenantId: string, now: Date): Promise<TenantCtx | null> {
  const dropi = await loadDropi(deps, tenantId).catch(() => null);
  const notices = dropi?.config.options.notices;
  if (!notices || !Object.values(notices.events).some((e) => e.enabled)) return null;
  const [s] = await withTenant(deps.db, tenantId, (tx) => tx.select().from(tenantSettings));
  const [org] = await deps.db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, tenantId));
  const inHours =
    deps.respectHours === false ||
    inSendingHours(
      s?.messagingWindow ?? { start: "08:00", end: "22:00" },
      s?.timezone ?? "America/Guayaquil",
      now,
    );
  return { notices, tienda: s?.brandName?.trim() || org?.name || "", inHours };
}

/** Envía un aviso si está activo y no se envió antes. Devuelve si se envió. */
async function send(
  deps: NotifyDeps,
  tenantId: string,
  o: OrderRow,
  kind: NoticeKind,
  ctx: TenantCtx,
): Promise<boolean> {
  const ev = ctx.notices.events[kind];
  const convId = o.conversationId;
  if (!ev.enabled || !convId) return false;
  const info = NOTICE_INFO[kind];
  const pre = await withTenant(deps.db, tenantId, async (tx) => {
    const [done] = await tx
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, o.id), sql`${orderEvents.payload}->>'aviso' = ${kind}`))
      .limit(1);
    if (done) return null;
    const [c] = await tx
      .select({
        lastInboundAt: conversations.lastInboundAt,
        channelId: conversations.channelId,
        name: contacts.name,
        profileName: contacts.profileName,
      })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(eq(conversations.id, convId));
    if (!c) return null;
    const [tpl] = ev.template
      ? await tx
          .select({ language: messageTemplates.language, components: messageTemplates.components })
          .from(messageTemplates)
          .where(
            and(
              eq(messageTemplates.channelId, c.channelId),
              eq(messageTemplates.name, ev.template),
              eq(messageTemplates.status, "APPROVED"),
            ),
          )
          .limit(1)
      : [];
    return { c, tpl };
  });
  if (!pre) return false;

  const vars = noticeVars(o, {
    nombre: firstName(o.customer.nombre || pre.c.name || pre.c.profileName || ""),
    tienda: ctx.tienda,
    trackingUrl: ctx.notices.trackingUrl,
  });
  const windowOpen = pre.c.lastInboundAt && Date.now() - pre.c.lastInboundAt.getTime() < WINDOW_MS;
  let input: SendInput | null = null;
  if (windowOpen) {
    const body = renderNotice(ev.text.trim() || info.defaultText, vars);
    if (body) input = { kind: "text", body };
  } else if (ev.template) {
    // Plantilla sincronizada: tantas variables como pida; si no está, las 4 primeras.
    const n = pre.tpl ? templateVarCount(pre.tpl.components) : 4;
    input = {
      kind: "template",
      name: ev.template,
      language: pre.tpl?.language || ctx.notices.idioma || "es",
      params: NOTICE_TEMPLATE_PARAMS.slice(0, n).map((k) => vars[k] || "-"),
      preview: `[plantilla ${ev.template}] ${info.label} · ${vars.producto}`,
    };
  }

  if (!input) {
    await withTenant(deps.db, tenantId, (tx) =>
      tx.insert(orderEvents).values({
        orderId: o.id,
        source: "sistema",
        stage: o.stage,
        message: `No se envió el aviso «${info.label}»: pasaron más de 24 h desde el último mensaje del cliente y no hay plantilla configurada.`,
        payload: { aviso: kind, enviado: false },
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
        ? `Aviso «${info.label}» enviado por WhatsApp${toSend.kind === "template" ? " (plantilla)" : ""}.`
        : `Falló el aviso «${info.label}» por WhatsApp.`,
      payload: { aviso: kind, enviado: ok },
    }),
  );
  return ok;
}

/** Desde cuándo está el pedido en su etapa actual (último evento de Dropi con esa etapa). */
async function stageSince(deps: NotifyDeps, tenantId: string, o: OrderRow) {
  const [e] = await withTenant(deps.db, tenantId, (tx) =>
    tx
      .select({ at: orderEvents.createdAt })
      .from(orderEvents)
      .where(
        and(
          eq(orderEvents.orderId, o.id),
          eq(orderEvents.stage, o.stage),
          eq(orderEvents.source, "dropi"),
        ),
      )
      .orderBy(desc(orderEvents.createdAt))
      .limit(1),
  );
  return e?.at ?? o.updatedAt;
}

/** Cambio de etapa (webhook o consulta): avisa al momento si está dentro del horario. */
export async function notifyStage(
  deps: NotifyDeps,
  tenantId: string,
  orderId: string,
  stage: OrderStage,
) {
  const kind = STAGE_NOTICE[stage];
  if (!kind) return false;
  const ctx = await tenantCtx(deps, tenantId, new Date());
  if (!ctx?.inHours) return false; // fuera de horario: lo envía la tarea periódica
  const [o] = await withTenant(deps.db, tenantId, (tx) =>
    tx.select().from(orders).where(eq(orders.id, orderId)),
  );
  return o ? send(deps, tenantId, o, kind, ctx) : false;
}

/**
 * Tarea periódica: avisos pendientes (los que cayeron fuera de horario) y recordatorios de
 * retiro cuando el pedido sigue en la agencia después de los días indicados.
 */
export async function runOrderNotices(deps: NotifyDeps, now = new Date()) {
  const tenants = await deps.db.select({ tenantId: dropiRoutes.tenantId }).from(dropiRoutes);
  let sent = 0;
  for (const { tenantId } of tenants) {
    const ctx = await tenantCtx(deps, tenantId, now);
    if (!ctx?.inHours) continue;
    const stages = Object.keys(STAGE_NOTICE) as OrderStage[];
    const list = await withTenant(deps.db, tenantId, (tx) =>
      tx
        .select()
        .from(orders)
        .where(and(inArray(orders.stage, stages), isNotNull(orders.conversationId)))
        .orderBy(desc(orders.updatedAt))
        .limit(300),
    );
    for (const o of list) {
      const kind = STAGE_NOTICE[o.stage as OrderStage];
      if (!kind) continue;
      const since = await stageSince(deps, tenantId, o);
      const age = now.getTime() - since.getTime();
      if (age <= RECENT_MS && (await send(deps, tenantId, o, kind, ctx))) sent++;
      if (
        kind === "retiro" &&
        ctx.notices.events.recordatorio.enabled &&
        age >= ctx.notices.recordatorioDias * 86400_000 &&
        (await send(deps, tenantId, o, "recordatorio", ctx))
      )
        sent++;
    }
  }
  return { sent };
}
