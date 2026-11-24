import { randomBytes } from "node:crypto";
import { type Database, schema, withTenant } from "@chatea/db";
import {
  DROPI_COUNTRIES,
  type DropiCountry,
  dropiOptionsSchema,
  encryptSecret,
  LOCAL_STAGES,
  maskSecret,
  ORDER_STAGE_KEYS,
  type OrderStage,
} from "@chatea/shared";
import { desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Auth } from "../auth.js";
import { agenciesEnabled, setAgenciesEnabled } from "../carriers/servientrega.js";
import { DropiClient, DropiError } from "../dropi/client.js";
import {
  applyDropiWebhook,
  buyerHistory,
  createOrderFromConversation,
  type DropiDeps,
  loadDropi,
  OrderError,
  readDropiConfig,
  uploadOrder,
} from "../orders/service.js";
import { requireTenant } from "../plugins/tenant.js";

const { integrations, dropiRoutes, orders, orderEvents, contacts, conversations, auditLog } =
  schema;
const isUuid = (v: string) => z.uuid().safeParse(v).success;

const dropiBody = z.object({
  /** Vacío = mantener el token guardado. */
  token: z.string().trim().max(4000).optional(),
  country: z.enum(Object.keys(DROPI_COUNTRIES) as [DropiCountry, ...DropiCountry[]]),
  options: dropiOptionsSchema,
});

const customerPatch = z
  .object({
    nombre: z.string().trim().max(120),
    apellido: z.string().trim().max(120),
    telefono: z.string().trim().max(30),
    provincia: z.string().trim().max(80),
    ciudad: z.string().trim().max(80),
    direccion: z.string().trim().max(300),
    referencia: z.string().trim().max(300),
    email: z.string().trim().max(120),
  })
  .partial();

const orderPatch = z.object({
  customer: customerPatch.optional(),
  notes: z.string().max(1000).optional(),
  rateType: z.enum(["CON RECAUDO", "SIN RECAUDO"]).optional(),
  cancel: z.boolean().optional(),
});

export async function orderRoutes(
  app: FastifyInstance,
  opts: {
    auth: Auth;
    db: Database;
    dropi: Omit<DropiDeps, "db">;
    publicBaseUrl: string;
    /** URL del buscador de agencias Servientrega (vacía = no disponible). */
    agencyUrl?: string;
  },
) {
  const { auth, db } = opts;
  const deps: DropiDeps = { db, ...opts.dropi };
  const anyMember = requireTenant(auth, db);
  const admins = requireTenant(auth, db, ["owner", "admin"]);

  // ---------- Integración Dropi ----------

  const webhookUrl = async (tenantId: string) => {
    const [r] = await db.select().from(dropiRoutes).where(eq(dropiRoutes.tenantId, tenantId));
    return r ? `${opts.publicBaseUrl}/api/webhooks/dropi/${r.secret}` : null;
  };

  app.get("/api/integrations/dropi", { preHandler: admins }, async (req) => {
    const [row] = await withTenant(db, req.ctx.tenantId, (tx) =>
      tx.select().from(integrations).where(eq(integrations.kind, "dropi")),
    );
    if (!row) return { connected: false, options: dropiOptionsSchema.parse({}) };
    const cfg = readDropiConfig(row.configEnc, deps.encryptionKey);
    return {
      connected: row.status === "active",
      country: cfg.country,
      options: cfg.options,
      tokenHint: maskSecret(cfg.token),
      webhookUrl: await webhookUrl(req.ctx.tenantId),
      updatedAt: row.updatedAt,
    };
  });

  app.put("/api/integrations/dropi", { preHandler: admins }, async (req, reply) => {
    const parsed = dropiBody.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "datos_invalidos", issues: parsed.error.issues });
    const { tenantId, userId } = req.ctx;
    const [row] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(integrations).where(eq(integrations.kind, "dropi")),
    );
    const prev = row ? readDropiConfig(row.configEnc, deps.encryptionKey) : null;
    const token = parsed.data.token || prev?.token;
    if (!token)
      return reply.code(400).send({ error: "falta_token", message: "Pega el token de Dropi." });

    // Se valida contra Dropi si cambia el token o el país.
    if (!prev || token !== prev.token || parsed.data.country !== prev.country) {
      try {
        const provinces = await new DropiClient(
          token,
          parsed.data.country,
          deps.fetchImpl,
        ).departments();
        if (!provinces.length)
          throw new DropiError("Dropi respondió sin provincias para ese país.");
      } catch (e) {
        if (e instanceof DropiError)
          return reply.code(422).send({ error: "dropi_rechazo", message: e.message });
        throw e;
      }
    }

    const configEnc = encryptSecret(
      JSON.stringify({ token, country: parsed.data.country, options: parsed.data.options }),
      deps.encryptionKey,
    );
    await withTenant(db, tenantId, async (tx) => {
      if (row)
        await tx
          .update(integrations)
          .set({ configEnc, status: "active" })
          .where(eq(integrations.id, row.id));
      else await tx.insert(integrations).values({ kind: "dropi", configEnc, status: "active" });
      await tx.insert(auditLog).values({ actorUserId: userId, action: "dropi.guardar" });
    });
    await db
      .insert(dropiRoutes)
      .values({ tenantId, secret: randomBytes(24).toString("base64url") })
      .onConflictDoNothing();
    return { ok: true, webhookUrl: await webhookUrl(tenantId) };
  });

  app.delete("/api/integrations/dropi", { preHandler: admins }, async (req) => {
    await withTenant(db, req.ctx.tenantId, async (tx) => {
      await tx.delete(integrations).where(eq(integrations.kind, "dropi"));
      await tx
        .insert(auditLog)
        .values({ actorUserId: req.ctx.userId, action: "dropi.desconectar" });
    });
    await db.delete(dropiRoutes).where(eq(dropiRoutes.tenantId, req.ctx.tenantId));
    return { ok: true };
  });

  // ---------- Buscador de agencias Servientrega ----------

  app.get("/api/integrations/servientrega", { preHandler: admins }, async (req) => ({
    available: Boolean(opts.agencyUrl),
    enabled: await agenciesEnabled(db, req.ctx.tenantId),
  }));

  app.put("/api/integrations/servientrega", { preHandler: admins }, async (req, reply) => {
    const b = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "datos_invalidos" });
    if (b.data.enabled && !opts.agencyUrl)
      return reply.code(409).send({ error: "no_disponible", message: "Falta SERVIENTREGA_URL." });
    await setAgenciesEnabled(db, req.ctx.tenantId, b.data.enabled, deps.encryptionKey);
    return { ok: true, enabled: b.data.enabled };
  });

  // ---------- Webhook de Dropi (público; la URL lleva un secreto por tienda) ----------

  app.post<{ Params: { secret: string } }>("/api/webhooks/dropi/:secret", async (req, reply) => {
    const secret = req.params.secret;
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(secret)) return reply.code(404).send();
    const [route] = await db.select().from(dropiRoutes).where(eq(dropiRoutes.secret, secret));
    if (!route) return reply.code(404).send();
    const r = await applyDropiWebhook(db, route.tenantId, req.body);
    if (!r.matched)
      req.log.info({ tenantId: route.tenantId }, "webhook de Dropi sin pedido conocido");
    // 200 siempre: si no es un pedido nuestro, que Dropi reintente no sirve de nada.
    return { ok: true };
  });

  // ---------- Pedidos ----------

  const selectOrder = {
    id: orders.id,
    stage: orders.stage,
    source: orders.source,
    customer: orders.customer,
    items: orders.items,
    total: orders.total,
    currency: orders.currency,
    rateType: orders.rateType,
    dropiOrderId: orders.dropiOrderId,
    dropiStatus: orders.dropiStatus,
    carrier: orders.carrier,
    trackingCode: orders.trackingCode,
    uploadError: orders.uploadError,
    uploadAttempts: orders.uploadAttempts,
    uploadedAt: orders.uploadedAt,
    risk: orders.risk,
    notes: orders.notes,
    conversationId: orders.conversationId,
    contactName: contacts.name,
    contactPhone: contacts.phone,
    createdAt: orders.createdAt,
    updatedAt: orders.updatedAt,
  };

  app.get<{ Querystring: { stage?: string } }>(
    "/api/orders",
    { preHandler: anyMember },
    async (req) => {
      const stages = (req.query.stage ?? "")
        .split(",")
        .filter((s): s is OrderStage => ORDER_STAGE_KEYS.includes(s as OrderStage));
      return withTenant(db, req.ctx.tenantId, (tx) =>
        tx
          .select(selectOrder)
          .from(orders)
          .leftJoin(contacts, eq(contacts.id, orders.contactId))
          .where(stages.length ? inArray(orders.stage, stages) : undefined)
          .orderBy(desc(orders.createdAt))
          .limit(500),
      );
    },
  );

  const loadOrder = (tenantId: string, id: string) =>
    withTenant(db, tenantId, async (tx) => {
      const [order] = await tx
        .select(selectOrder)
        .from(orders)
        .leftJoin(contacts, eq(contacts.id, orders.contactId))
        .where(eq(orders.id, id));
      if (!order) return null;
      const events = await tx
        .select()
        .from(orderEvents)
        .where(eq(orderEvents.orderId, id))
        .orderBy(desc(orderEvents.createdAt))
        .limit(100);
      return { ...order, events };
    });

  app.get<{ Params: { id: string } }>(
    "/api/orders/:id",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send({ error: "no_existe" });
      const o = await loadOrder(req.ctx.tenantId, req.params.id);
      return o ?? reply.code(404).send({ error: "no_existe" });
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/orders/:id",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send({ error: "no_existe" });
      const parsed = orderPatch.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "datos_invalidos", issues: parsed.error.issues });
      const p = parsed.data;
      const res = await withTenant(db, req.ctx.tenantId, async (tx) => {
        const [o] = await tx.select().from(orders).where(eq(orders.id, req.params.id));
        if (!o) return { code: 404, error: "no_existe" } as const;
        const local = LOCAL_STAGES.includes(o.stage as OrderStage);
        if (!local && (p.customer || p.rateType || p.cancel))
          return {
            code: 409,
            error: "ya_en_dropi",
            message: "El pedido ya está en Dropi: cámbialo o cancélalo desde Dropi.",
          } as const;
        await tx
          .update(orders)
          .set({
            ...(p.customer ? { customer: { ...o.customer, ...p.customer } } : {}),
            ...(p.notes !== undefined ? { notes: p.notes } : {}),
            ...(p.rateType ? { rateType: p.rateType } : {}),
            ...(p.cancel ? { stage: "cancelado" } : {}),
          })
          .where(eq(orders.id, o.id));
        await tx.insert(orderEvents).values({
          orderId: o.id,
          source: "humano",
          stage: p.cancel ? "cancelado" : o.stage,
          message: p.cancel ? "Pedido cancelado por un asesor." : "Datos del pedido editados.",
          payload: { by: req.ctx.userId, ...p },
        });
        return { code: 200 } as const;
      });
      if (res.code !== 200) return reply.code(res.code).send(res);
      return loadOrder(req.ctx.tenantId, req.params.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/orders/:id/upload",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send({ error: "no_existe" });
      const body = z.object({ force: z.boolean().optional() }).safeParse(req.body ?? {});
      const force = body.success && body.data.force === true;
      // Saltar la regla de riesgo es decisión de dueños/administradores.
      if (force && !["owner", "admin"].includes(req.ctx.role))
        return reply.code(403).send({ error: "rol_insuficiente" });
      const result = await uploadOrder(deps, req.ctx.tenantId, req.params.id, {
        force,
        actor: "humano",
      });
      const order = await loadOrder(req.ctx.tenantId, req.params.id);
      if (!order) return reply.code(404).send({ error: "no_existe" });
      return { result, order };
    },
  );

  /** Pedido creado por un asesor con los datos que juntó la conversación. */
  app.post<{ Params: { id: string } }>(
    "/api/conversations/:id/order",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send({ error: "no_existe" });
      try {
        const { order, created } = await createOrderFromConversation(
          db,
          req.ctx.tenantId,
          req.params.id,
          { source: "humano" },
        );
        return reply.code(created ? 201 : 200).send(await loadOrder(req.ctx.tenantId, order.id));
      } catch (e) {
        if (e instanceof OrderError)
          return reply.code(409).send({ error: "no_se_puede", message: e.message });
        throw e;
      }
    },
  );

  /** Último pedido de una conversación (para la bandeja). */
  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id/order",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send({ error: "no_existe" });
      const [o] = await withTenant(db, req.ctx.tenantId, (tx) =>
        tx
          .select({
            id: orders.id,
            stage: orders.stage,
            dropiOrderId: orders.dropiOrderId,
            uploadError: orders.uploadError,
          })
          .from(orders)
          .where(eq(orders.conversationId, req.params.id))
          .orderBy(desc(orders.createdAt))
          .limit(1),
      );
      return { order: o ?? null };
    },
  );

  /** Huella del cliente para la ficha: sus pedidos en esta tienda y en Dropi. */
  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id/fingerprint",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send({ error: "no_existe" });
      const { tenantId } = req.ctx;
      const row = await withTenant(db, tenantId, async (tx) => {
        const [c] = await tx
          .select({ contactId: conversations.contactId, phone: contacts.phone })
          .from(conversations)
          .innerJoin(contacts, eq(contacts.id, conversations.contactId))
          .where(eq(conversations.id, req.params.id));
        if (!c) return null;
        const mine = await tx
          .select({ stage: orders.stage })
          .from(orders)
          .where(eq(orders.contactId, c.contactId));
        return { phone: c.phone, stages: mine.map((m) => m.stage) };
      });
      if (!row) return reply.code(404).send({ error: "no_existe" });
      const count = (st: string) => row.stages.filter((x) => x === st).length;
      const local = {
        orders: row.stages.length,
        delivered: count("entregado"),
        returned: count("devolucion"),
        cancelled: count("cancelado"),
      };
      const dropi = await loadDropi(deps, tenantId);
      if (!dropi) return { local, dropi: null, dropiConnected: false };
      try {
        return { local, dropi: await buyerHistory(dropi.client, row.phone), dropiConnected: true };
      } catch (e) {
        return {
          local,
          dropi: null,
          dropiConnected: true,
          dropiError: e instanceof DropiError ? e.message : "No se pudo consultar Dropi.",
        };
      }
    },
  );
}
