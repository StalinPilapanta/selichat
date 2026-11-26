import { randomBytes } from "node:crypto";
import { type Database, schema, withTenant } from "@chatea/db";
import {
  DROPI_COUNTRIES,
  type DropiCountry,
  decryptSecret,
  dropiOptionsSchema,
  encryptSecret,
  LOCAL_STAGES,
  maskSecret,
  ORDER_STAGE_KEYS,
  type OrderStage,
} from "@chatea/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Auth } from "../auth.js";
import {
  AGENCY_MODES,
  type AgencyMode,
  agencyMode,
  setAgencyMode,
} from "../carriers/servientrega.js";
import { DropiClient, DropiError } from "../dropi/client.js";
import { authorizeUrl, exchangeCode, pkce, registerClient } from "../dropi/mcp.js";
import {
  applyDropiWebhook,
  buyerHistory,
  createManualOrder,
  createOrderFromConversation,
  type DropiConfig,
  type DropiDeps,
  dropiClient,
  forgetDropiClient,
  loadDropi,
  type OnStage,
  OrderError,
  readDropiConfig,
  uploadOrder,
  writeDropiConfig,
} from "../orders/service.js";
import { requireTenant } from "../plugins/tenant.js";
import { advanceLead } from "../services/leads.js";

const { integrations, dropiRoutes, orders, orderEvents, contacts, conversations, auditLog } =
  schema;
const isUuid = (v: string) => z.uuid().safeParse(v).success;
const countryEnum = z.enum(Object.keys(DROPI_COUNTRIES) as [DropiCountry, ...DropiCountry[]]);
/** Vigencia del enlace de autorización de Dropi. */
const OAUTH_TTL = 15 * 60_000;

const dropiBody = z.object({
  /** Vacío = mantener el token guardado. */
  token: z.string().trim().max(4000).optional(),
  country: countryEnum,
  options: dropiOptionsSchema,
});

const oauthStart = z.object({ country: countryEnum, options: dropiOptionsSchema });

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

const manualOrder = z.object({
  customer: z.object({
    nombre: z.string().trim().min(1, "Falta el nombre").max(120),
    apellido: z.string().trim().max(120).default(""),
    telefono: z.string().trim().min(7, "Falta el teléfono").max(30),
    provincia: z.string().trim().max(80).default(""),
    ciudad: z.string().trim().min(2, "Falta la ciudad").max(80),
    direccion: z.string().trim().min(3, "Falta la dirección").max(300),
    referencia: z.string().trim().max(300).default(""),
    email: z.string().trim().max(120).optional(),
  }),
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: z.number().int().min(1).max(99),
        variant: z.string().trim().max(120).optional(),
      }),
    )
    .min(1, "Agrega al menos un producto")
    .max(10),
  total: z.number().positive().max(100_000).optional(),
  rateType: z.enum(["CON RECAUDO", "SIN RECAUDO"]).default("CON RECAUDO"),
  notes: z.string().trim().max(1000).default(""),
  /** Subirlo a Dropi apenas se guarda. */
  upload: z.boolean().default(false),
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
    /** Avisos al cliente cuando Dropi cambia la etapa. */
    onStage?: OnStage;
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
      mode: cfg.mode,
      authError: cfg.mode === "mcp" ? (cfg.authError ?? null) : null,
      country: cfg.country,
      options: cfg.options,
      tokenHint: cfg.mode === "token" ? maskSecret(cfg.token) : undefined,
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
    const newToken = parsed.data.token || "";
    // Conectado por cuenta Dropi (MCP) y sin token nuevo: solo cambian las opciones.
    const keepMcp = prev?.mode === "mcp" && !newToken && prev.mcp;
    const token = newToken || (prev?.mode === "token" ? prev.token : "");
    if (!keepMcp && !token)
      return reply.code(400).send({ error: "falta_token", message: "Pega el token de Dropi." });

    // Se valida contra Dropi si cambia el token o el país.
    if (!keepMcp && (!prev || token !== prev.token || parsed.data.country !== prev.country)) {
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

    const cfg: DropiConfig = keepMcp
      ? { ...prev, country: parsed.data.country, options: parsed.data.options }
      : { mode: "token", token, country: parsed.data.country, options: parsed.data.options };
    const configEnc = writeDropiConfig(cfg, deps.encryptionKey);
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

  // ---------- Conectar con la cuenta de Dropi (MCP + OAuth) ----------

  const redirectUri = `${opts.publicBaseUrl}/api/integrations/dropi/oauth/callback`;
  const backToPanel = (q: Record<string, string>) =>
    `${opts.publicBaseUrl}/panel/integraciones/dropi?${new URLSearchParams(q)}`;

  app.post("/api/integrations/dropi/oauth/start", { preHandler: admins }, async (req, reply) => {
    const b = oauthStart.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "datos_invalidos" });
    try {
      const clientId = await registerClient(redirectUri, deps.fetchImpl);
      const { verifier, challenge } = pkce();
      // El estado va cifrado: lleva el verificador PKCE y a quién pertenece la autorización.
      const state = encryptSecret(
        JSON.stringify({
          t: req.ctx.tenantId,
          u: req.ctx.userId,
          v: verifier,
          c: clientId,
          country: b.data.country,
          options: b.data.options,
          exp: Date.now() + OAUTH_TTL,
        }),
        deps.encryptionKey,
      );
      return { url: authorizeUrl({ clientId, redirectUri, state, challenge }) };
    } catch (e) {
      if (e instanceof DropiError)
        return reply.code(502).send({ error: "dropi_rechazo", message: e.message });
      throw e;
    }
  });

  // Dropi vuelve aquí tras iniciar sesión. Se exige la misma sesión que inició la conexión,
  // así nadie puede colgar su cuenta de Dropi en otra tienda (ni al revés).
  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/api/integrations/dropi/oauth/callback",
    { preHandler: admins },
    async (req, reply) => {
      const q = req.query;
      if (q.error)
        return reply.redirect(
          backToPanel({ dropi_error: q.error_description || "Dropi no autorizó la conexión." }),
        );
      let st: {
        t: string;
        u: string;
        v: string;
        c: string;
        country: DropiCountry;
        options: unknown;
        exp: number;
      };
      try {
        st = JSON.parse(decryptSecret(q.state ?? "", deps.encryptionKey));
      } catch {
        return reply.redirect(backToPanel({ dropi_error: "Enlace de autorización inválido." }));
      }
      const { tenantId, userId } = req.ctx;
      if (st.exp < Date.now() || !q.code)
        return reply.redirect(
          backToPanel({ dropi_error: "La autorización venció; inténtalo de nuevo." }),
        );
      if (st.t !== tenantId || st.u !== userId)
        return reply.redirect(
          backToPanel({ dropi_error: "La autorización era para otra tienda o usuario." }),
        );
      try {
        const mcp = await exchangeCode(
          { code: q.code, verifier: st.v, redirectUri, clientId: st.c },
          deps.fetchImpl,
        );
        const cfg: DropiConfig = {
          mode: "mcp",
          token: "",
          mcp,
          country: countryEnum.parse(st.country),
          options: dropiOptionsSchema.parse(st.options ?? {}),
        };
        forgetDropiClient(tenantId); // la sesión anterior (revocada) no se reutiliza
        // Prueba real: la cuenta responde (y deja los tokens renovados si hiciera falta).
        const provinces = await dropiClient(deps, tenantId, cfg).departments();
        if (!provinces.length) throw new DropiError("Dropi respondió sin provincias.");
        const configEnc = writeDropiConfig(cfg, deps.encryptionKey);
        await withTenant(db, tenantId, async (tx) => {
          const [row] = await tx
            .select({ id: integrations.id })
            .from(integrations)
            .where(eq(integrations.kind, "dropi"));
          if (row)
            await tx
              .update(integrations)
              .set({ configEnc, status: "active" })
              .where(eq(integrations.id, row.id));
          else await tx.insert(integrations).values({ kind: "dropi", configEnc, status: "active" });
          await tx
            .insert(auditLog)
            .values({ actorUserId: userId, action: "dropi.conectar_cuenta" });
        });
        await db
          .insert(dropiRoutes)
          .values({ tenantId, secret: randomBytes(24).toString("base64url") })
          .onConflictDoNothing();
        return reply.redirect(backToPanel({ dropi: "conectado" }));
      } catch (e) {
        if (e instanceof DropiError) return reply.redirect(backToPanel({ dropi_error: e.message }));
        throw e;
      }
    },
  );

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

  app.get("/api/integrations/servientrega", { preHandler: admins }, async (req) => {
    const mode = await agencyMode(db, req.ctx.tenantId, deps.encryptionKey);
    return { available: Boolean(opts.agencyUrl), mode, enabled: mode !== "off" };
  });

  app.put("/api/integrations/servientrega", { preHandler: admins }, async (req, reply) => {
    const b = z
      .object({
        mode: z.enum(AGENCY_MODES as [AgencyMode, ...AgencyMode[]]).optional(),
        /** Forma anterior: true = «opcion». */
        enabled: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!b.success || (!b.data.mode && b.data.enabled === undefined))
      return reply.code(400).send({ error: "datos_invalidos" });
    const mode: AgencyMode = b.data.mode ?? (b.data.enabled ? "opcion" : "off");
    if (mode !== "off" && !opts.agencyUrl)
      return reply.code(409).send({ error: "no_disponible", message: "Falta SERVIENTREGA_URL." });
    await setAgencyMode(db, req.ctx.tenantId, mode, deps.encryptionKey);
    await withTenant(db, req.ctx.tenantId, (tx) =>
      tx.insert(auditLog).values({ actorUserId: req.ctx.userId, action: `agencias.${mode}` }),
    );
    return { ok: true, mode, enabled: mode !== "off" };
  });

  // ---------- Webhook de Dropi (público; la URL lleva un secreto por tienda) ----------

  app.post<{ Params: { secret: string } }>("/api/webhooks/dropi/:secret", async (req, reply) => {
    const secret = req.params.secret;
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(secret)) return reply.code(404).send();
    const [route] = await db.select().from(dropiRoutes).where(eq(dropiRoutes.secret, secret));
    if (!route) return reply.code(404).send();
    const r = await applyDropiWebhook(db, route.tenantId, req.body, opts.onStage);
    if (!r.matched)
      req.log.info({ tenantId: route.tenantId }, "webhook de Dropi sin pedido conocido");
    // 200 siempre: si no es un pedido nuestro, que Dropi reintente no sirve de nada.
    return { ok: true };
  });

  // ---------- Pedidos ----------

  const selectOrder = {
    id: orders.id,
    stage: orders.stage,
    // Desde cuándo está en la etapa actual según Dropi (p. ej. días en la agencia sin retirar).
    stageSince: sql<
      string | null
    >`(select max(e.created_at) from order_events e where e.order_id = ${orders.id} and e.stage = ${orders.stage} and e.source = 'dropi')`,
    source: orders.source,
    customer: orders.customer,
    items: orders.items,
    total: orders.total,
    currency: orders.currency,
    shippingCost: orders.shippingCost,
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

  /** Pedido ingresado a mano (llamada, local, otra red social). */
  app.post("/api/orders", { preHandler: anyMember }, async (req, reply) => {
    const body = manualOrder.safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({
        error: "datos_invalidos",
        detail: body.error.issues[0]?.message,
        issues: body.error.issues,
      });
    const { upload, ...input } = body.data;
    try {
      const order = await createManualOrder(db, req.ctx.tenantId, input);
      const result = upload
        ? await uploadOrder(deps, req.ctx.tenantId, order.id, { actor: "humano" })
        : null;
      return reply.code(201).send({ result, order: await loadOrder(req.ctx.tenantId, order.id) });
    } catch (e) {
      if (e instanceof OrderError)
        return reply.code(409).send({ error: "no_se_puede", message: e.message });
      throw e;
    }
  });

  /** Último pedido creado: el panel lo consulta para avisar en el escritorio. */
  app.get("/api/orders/latest", { preHandler: anyMember }, async (req) => {
    const [o] = await withTenant(db, req.ctx.tenantId, (tx) =>
      tx
        .select({
          id: orders.id,
          customer: orders.customer,
          total: orders.total,
          currency: orders.currency,
          source: orders.source,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .orderBy(desc(orders.createdAt))
        .limit(1),
    );
    return { order: o ?? null };
  });

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
        // Cancelado y sin otro pedido vivo: el lead queda perdido.
        if (p.cancel && o.conversationId) {
          const [other] = await tx
            .select({ id: orders.id })
            .from(orders)
            .where(
              and(
                eq(orders.conversationId, o.conversationId),
                sql`${orders.stage} <> 'cancelado'`,
                sql`${orders.id} <> ${o.id}`,
              ),
            )
            .limit(1);
          if (!other)
            await advanceLead(tx, o.conversationId, "perdido", {
              force: true,
              lostReason: "cancelo",
            });
        }
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
            items: orders.items,
            total: orders.total,
            currency: orders.currency,
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
        if (dropi.client.fingerprint)
          return {
            local,
            dropi: null,
            global: await dropi.client.fingerprint(row.phone),
            dropiConnected: true,
          };
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
