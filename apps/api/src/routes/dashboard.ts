/**
 * Inicio del panel: cómo va la tienda (ventas, entregas, envíos en curso), qué requiere
 * atención y qué falta configurar. Una sola consulta por bloque, todo bajo RLS.
 */
import { type Database, schema, withTenant } from "@chatea/db";
import { ORDER_STAGE_KEYS, type OrderStage } from "@chatea/shared";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Auth } from "../auth.js";
import { readDropiConfig } from "../orders/service.js";
import { requireTenant } from "../plugins/tenant.js";

const {
  orders,
  conversations,
  channels,
  products,
  aiProviders,
  integrations,
  tenantSettings,
  member,
} = schema;

/** Días en la agencia sin retirar a partir de los cuales hay que llamar al cliente. */
export const AGENCY_ALERT_DAYS = 2;

const num = (v: unknown) => Number(v ?? 0) || 0;

/** En agencia hace N días o más sin retirar (según el aviso de Dropi). */
const agencyOverdue = sql`${orders.stage} = 'en_oficina' and coalesce((select max(e.created_at) from order_events e where e.order_id = ${orders.id} and e.stage = 'en_oficina' and e.source = 'dropi'), ${orders.updatedAt}) < now() - make_interval(days => ${AGENCY_ALERT_DAYS})`;

export async function dashboardRoutes(
  app: FastifyInstance,
  opts: { auth: Auth; db: Database; encryptionKey: string },
) {
  const { auth, db } = opts;
  const anyMember = requireTenant(auth, db);

  /**
   * Lo que muestra el marco del panel en cada pantalla (menú, campana y estado de las
   * conexiones). Una sola consulta liviana: no llama a Meta, Dropi ni a la IA.
   */
  app.get("/api/nav", { preHandler: anyMember }, async (req) =>
    withTenant(db, req.ctx.tenantId, async (tx) => {
      const [[unread], [att], chans, dropiRow, [ai]] = await Promise.all([
        tx
          .select({ n: count() })
          .from(conversations)
          .where(and(eq(conversations.status, "abierta"), sql`${conversations.unreadCount} > 0`)),
        tx
          .select({
            novedad: sql<number>`count(*) filter (where ${orders.stage} = 'novedad')::int`,
            uploadErrors: sql<number>`count(*) filter (where ${orders.stage} = 'error_subida')::int`,
            revision: sql<number>`count(*) filter (where ${orders.stage} = 'revision')::int`,
            agencyOverdue: sql<number>`count(*) filter (where ${agencyOverdue})::int`,
          })
          .from(orders)
          .where(inArray(orders.stage, ["novedad", "error_subida", "revision", "en_oficina"])),
        tx.select({ status: channels.status, lastError: channels.lastError }).from(channels),
        tx
          .select({ status: integrations.status, configEnc: integrations.configEnc })
          .from(integrations)
          .where(eq(integrations.kind, "dropi")),
        tx.select({ n: count() }).from(aiProviders),
      ]);

      type Conn = { state: "ok" | "error" | "off"; detail?: string };
      const whatsapp: Conn = !chans.length
        ? { state: "off" }
        : chans.some((c) => c.status === "error")
          ? { state: "error", detail: chans.find((c) => c.lastError)?.lastError ?? undefined }
          : { state: "ok" };
      let dropi: Conn = { state: "off" };
      const d = dropiRow[0];
      if (d?.status === "active") {
        let authError: string | undefined;
        try {
          authError = readDropiConfig(d.configEnc, opts.encryptionKey).authError;
        } catch {
          authError = "No se pudo leer la conexión.";
        }
        dropi = authError ? { state: "error", detail: authError } : { state: "ok" };
      }
      const attention = {
        novedad: num(att?.novedad),
        agencyOverdue: num(att?.agencyOverdue),
        uploadErrors: num(att?.uploadErrors),
        revision: num(att?.revision),
      };
      return {
        unread: num(unread?.n),
        attention,
        /** Pedidos que necesitan a alguien: el contador rojo de «Pedidos». */
        ordersAttention: Object.values(attention).reduce((a, b) => a + b, 0),
        status: { whatsapp, dropi, ai: { state: num(ai?.n) > 0 ? "ok" : "off" } as Conn },
      };
    }),
  );

  app.get("/api/dashboard", { preHandler: anyMember }, async (req) => {
    const { tenantId } = req.ctx;
    const team = await db
      .select({ n: count() })
      .from(member)
      .where(eq(member.organizationId, tenantId));

    return withTenant(db, tenantId, async (tx) => {
      const [settings] = await tx.select().from(tenantSettings);
      const tz = settings?.timezone || "America/Guayaquil";
      // Inicio del día en la zona horaria de la tienda.
      const today = sql`(date_trunc('day', now() at time zone ${tz}) at time zone ${tz})`;
      const since30 = sql`now() - interval '30 days'`;

      const [byStage, periods, agency, leads, recent, setup] = await Promise.all([
        tx
          .select({
            stage: orders.stage,
            n: count(),
            amount: sql<string>`coalesce(sum(${orders.total}), 0)`,
          })
          .from(orders)
          .groupBy(orders.stage),
        tx
          .select({
            todayOrders: sql<number>`count(*) filter (where ${orders.createdAt} >= ${today})::int`,
            todayAmount: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.createdAt} >= ${today}), 0)`,
            orders30: sql<number>`count(*) filter (where ${orders.createdAt} >= ${since30} and ${orders.stage} <> 'cancelado')::int`,
            amount30: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.createdAt} >= ${since30} and ${orders.stage} <> 'cancelado'), 0)`,
            delivered30: sql<number>`count(*) filter (where ${orders.stage} = 'entregado' and ${orders.updatedAt} >= ${since30})::int`,
            deliveredAmount30: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.stage} = 'entregado' and ${orders.updatedAt} >= ${since30}), 0)`,
            returned30: sql<number>`count(*) filter (where ${orders.stage} = 'devolucion' and ${orders.updatedAt} >= ${since30})::int`,
          })
          .from(orders),
        // En agencia hace N días o más: Dropi registró la llegada y el cliente no retira.
        tx.select({ n: count() }).from(orders).where(agencyOverdue),
        tx
          .select({ n: count() })
          .from(conversations)
          .where(inArray(conversations.leadStage, ["interesado", "datos"])),
        tx
          .select({
            id: orders.id,
            stage: orders.stage,
            customer: orders.customer,
            items: orders.items,
            total: orders.total,
            currency: orders.currency,
            source: orders.source,
            createdAt: orders.createdAt,
          })
          .from(orders)
          .orderBy(desc(orders.createdAt))
          .limit(6),
        Promise.all([
          tx.select({ n: count() }).from(channels),
          tx.select({ n: count() }).from(products),
          tx.select({ n: count() }).from(aiProviders),
          tx.select({ n: count() }).from(integrations).where(eq(integrations.kind, "dropi")),
        ]),
      ]);

      const stages = Object.fromEntries(
        ORDER_STAGE_KEYS.map((k) => [k, { count: 0, amount: 0 }]),
      ) as Record<OrderStage, { count: number; amount: number }>;
      for (const r of byStage)
        if (r.stage in stages)
          stages[r.stage as OrderStage] = { count: num(r.n), amount: num(r.amount) };

      const p = periods[0];
      const delivered = num(p?.delivered30);
      const returned = num(p?.returned30);
      const [ch, prod, ai, dropi] = setup;

      return {
        currency: settings?.currency || "USD",
        today: { orders: num(p?.todayOrders), amount: num(p?.todayAmount) },
        last30: {
          orders: num(p?.orders30),
          amount: num(p?.amount30),
          delivered,
          deliveredAmount: num(p?.deliveredAmount30),
          returned,
          /** Entregados sobre los que ya terminaron (entregados + devueltos); null sin datos. */
          deliveryRate: delivered + returned ? delivered / (delivered + returned) : null,
        },
        stages,
        attention: {
          novedad: stages.novedad.count,
          agencyOverdue: num(agency[0]?.n),
          revision: stages.revision.count,
          uploadErrors: stages.error_subida.count,
          toUpload: stages.pendiente_subida.count,
        },
        leads: { open: num(leads[0]?.n) },
        recent,
        setup: {
          team: num(team[0]?.n) > 1,
          ai: num(ai[0]?.n) > 0,
          // Los ajustes nacen con la tienda: cuentan como hechos cuando alguien los guardó.
          settings: Boolean(
            settings && settings.updatedAt.getTime() - settings.createdAt.getTime() > 1000,
          ),
          products: num(prod[0]?.n) > 0,
          whatsapp: num(ch[0]?.n) > 0,
          dropi: num(dropi[0]?.n) > 0,
        },
      };
    });
  });
}
