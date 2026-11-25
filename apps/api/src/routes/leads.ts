/**
 * Leads (como Kommo): las conversaciones como embudo de ventas por etapa.
 * GET   /api/leads       → tarjetas del tablero (cerrados 72 h y perdidos 48 h; luego se ocultan)
 * PATCH /api/leads/:id   → mover a mano (perdido exige motivo)
 */
import { type Database, schema, withTenant } from "@chatea/db";
import { LEAD_HIDE_HOURS, LEAD_STAGE_KEYS, type LeadStage, LOST_REASON_KEYS } from "@chatea/shared";
import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Auth } from "../auth.js";
import { requireTenant } from "../plugins/tenant.js";
import type { RealtimeBus } from "../realtime.js";
import { advanceLead } from "../services/leads.js";

const { conversations, contacts, products, user } = schema;
const isUuid = (v: string) => z.uuid().safeParse(v).success;

const stageEnum = z.enum(LEAD_STAGE_KEYS as [LeadStage, ...LeadStage[]]);
const movePatch = z
  .object({
    stage: stageEnum,
    lostReason: z.enum(LOST_REASON_KEYS as [string, ...string[]]).optional(),
  })
  .refine((v) => v.stage !== "perdido" || v.lostReason, {
    message: "Indica el motivo de la pérdida.",
    path: ["lostReason"],
  });

export async function leadRoutes(
  app: FastifyInstance,
  opts: { auth: Auth; db: Database; bus: RealtimeBus },
) {
  const { auth, db, bus } = opts;
  const anyMember = requireTenant(auth, db);

  app.get<{ Querystring: { q?: string } }>("/api/leads", { preHandler: anyMember }, async (req) => {
    const q = (req.query.q ?? "").trim();
    const hideBefore = (stage: "cerrado" | "perdido") =>
      new Date(Date.now() - (LEAD_HIDE_HOURS[stage] ?? 0) * 3600_000);
    const digits = q.replace(/\D/g, "");
    return withTenant(db, req.ctx.tenantId, (tx) =>
      tx
        .select({
          id: conversations.id,
          stage: conversations.leadStage,
          stageAt: conversations.leadStageAt,
          lostReason: conversations.lostReason,
          name: contacts.name,
          profileName: contacts.profileName,
          phone: contacts.phone,
          productName: products.name,
          // Valor: el pedido vivo; si no hay, el precio del producto (estimado).
          orderTotal: sql<
            string | null
          >`(select o.total from orders o where o.conversation_id = ${conversations.id} and o.stage <> 'cancelado' order by o.created_at desc limit 1)`,
          // Estado logístico del pedido (para las etapas de venta).
          order: sql<{
            stage: string;
            dropiStatus: string | null;
            dropiOrderId: string | null;
            trackingCode: string | null;
          } | null>`(select json_build_object('stage', o.stage, 'dropiStatus', o.dropi_status, 'dropiOrderId', o.dropi_order_id, 'trackingCode', o.tracking_code) from orders o where o.conversation_id = ${conversations.id} and o.stage <> 'cancelado' order by o.created_at desc limit 1)`,
          price: products.price,
          currency: sql<string>`coalesce(${products.currency}, 'USD')`,
          assignedUserId: conversations.assignedUserId,
          assignedName: user.name,
          fromAd: sql<boolean>`${contacts.sourceAdId} is not null`,
          adHeadline: sql<string | null>`${contacts.referral}->>'headline'`,
          lastMessageAt: conversations.lastMessageAt,
          lastMessagePreview: conversations.lastMessagePreview,
          botPaused: conversations.botPaused,
          unreadCount: conversations.unreadCount,
        })
        .from(conversations)
        .innerJoin(contacts, eq(contacts.id, conversations.contactId))
        .leftJoin(products, eq(products.id, conversations.productId))
        .leftJoin(user, eq(user.id, conversations.assignedUserId))
        .where(
          and(
            or(
              inArray(conversations.leadStage, ["interesado", "datos", "ganado", "en_agencia"]),
              and(
                eq(conversations.leadStage, "cerrado"),
                gte(conversations.leadStageAt, hideBefore("cerrado")),
              ),
              and(
                eq(conversations.leadStage, "perdido"),
                gte(conversations.leadStageAt, hideBefore("perdido")),
              ),
            ),
            q
              ? or(
                  ilike(contacts.name, `%${q}%`),
                  ilike(contacts.profileName, `%${q}%`),
                  ilike(products.name, `%${q}%`),
                  ...(digits.length >= 3 ? [ilike(contacts.phone, `%${digits}%`)] : []),
                )
              : undefined,
          ),
        )
        .orderBy(desc(conversations.leadStageAt))
        .limit(800),
    );
  });

  app.patch<{ Params: { id: string } }>(
    "/api/leads/:id",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send({ error: "no_existe" });
      const b = movePatch.safeParse(req.body);
      if (!b.success)
        return reply.code(400).send({
          error: "datos_invalidos",
          message: b.error.issues[0]?.message,
        });
      const found = await withTenant(db, req.ctx.tenantId, async (tx) => {
        const [c] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.id, req.params.id));
        if (!c) return false;
        // A mano decide el asesor: puede mover a cualquier etapa (también reabrir).
        await advanceLead(tx, c.id, b.data.stage, { force: true, lostReason: b.data.lostReason });
        return true;
      });
      if (!found) return reply.code(404).send({ error: "no_existe" });
      bus.publish(req.ctx.tenantId, { type: "conversation", conversationId: req.params.id });
      return { ok: true };
    },
  );
}
