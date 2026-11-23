import { randomBytes } from "node:crypto";
import { type Database, schema, withTenant } from "@chatea/db";
import { decryptSecret, encryptSecret } from "@chatea/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Auth } from "../auth.js";
import { requireTenant } from "../plugins/tenant.js";
import type { RealtimeBus } from "../realtime.js";
import { GraphError } from "../whatsapp/graph.js";
import { parseWebhook } from "../whatsapp/parse.js";
import { type Channel, graphFor, ingestWebhook, type WaConfig } from "../whatsapp/service.js";
import { verifySignature } from "../whatsapp/signature.js";

const { channels, channelRoutes, messageTemplates, auditLog } = schema;
const isUuid = (v: string) => z.uuid().safeParse(v).success;

const channelBody = z.object({
  name: z.string().trim().min(1).max(80),
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{5,30}$/, "Phone Number ID inválido"),
  wabaId: z
    .string()
    .trim()
    .regex(/^\d{5,30}$/, "WABA ID inválido"),
  accessToken: z.string().trim().min(20).max(2000),
  appSecret: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{32}$/i, "App Secret inválido (32 caracteres hex)"),
});
const channelPatch = channelBody.partial().omit({ phoneNumberId: true });

const templateBody = z.object({
  name: z.string().regex(/^[a-z0-9_]{1,512}$/, "Solo minúsculas, números y guion bajo"),
  language: z.string().min(2).max(10),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  body: z.string().min(1).max(1024),
  /** Ejemplos para {{1}}, {{2}}… (Meta los exige para aprobar). */
  examples: z.array(z.string().min(1)).max(20).default([]),
  footer: z.string().max(60).optional(),
});

export async function whatsappRoutes(
  app: FastifyInstance,
  opts: {
    auth: Auth;
    db: Database;
    bus: RealtimeBus;
    wa: WaConfig;
    publicBaseUrl: string;
    /** Agenda el turno del agente IA cuando escribe el cliente. */
    onInbound?: (tenantId: string, conversationId: string) => void;
  },
) {
  const { auth, db, bus, wa } = opts;
  const anyMember = requireTenant(auth, db);
  const admins = requireTenant(auth, db, ["owner", "admin"]);

  const publicChannel = (c: Channel) => ({
    id: c.id,
    name: c.name,
    phoneNumberId: c.phoneNumberId,
    wabaId: c.wabaId,
    displayPhone: c.displayPhone,
    verifiedName: c.verifiedName,
    status: c.status,
    lastError: c.lastError,
    webhookVerifiedAt: c.webhookVerifiedAt,
    lastEventAt: c.lastEventAt,
    webhookUrl: `${opts.publicBaseUrl}/api/webhooks/whatsapp/${c.id}`,
    verifyToken: c.verifyToken,
  });

  // ---------- Webhook (público, sin sesión) ----------
  await app.register(async (hook) => {
    // Cuerpo crudo: la firma de Meta se calcula sobre los bytes exactos.
    hook.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 3 * 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );

    const loadRoute = async (channelId: string) => {
      if (!isUuid(channelId)) return null;
      const [route] = await db
        .select()
        .from(channelRoutes)
        .where(eq(channelRoutes.channelId, channelId));
      if (!route) return null;
      const [ch] = await withTenant(db, route.tenantId, (tx) =>
        tx.select().from(channels).where(eq(channels.id, channelId)),
      );
      return ch ?? null;
    };

    /** Verificación que hace Meta al configurar el webhook. */
    hook.get<{ Params: { channelId: string }; Querystring: Record<string, string> }>(
      "/api/webhooks/whatsapp/:channelId",
      async (req, reply) => {
        const ch = await loadRoute(req.params.channelId);
        const q = req.query;
        if (!ch || q["hub.mode"] !== "subscribe" || q["hub.verify_token"] !== ch.verifyToken)
          return reply.code(403).send();
        await withTenant(db, ch.tenantId, (tx) =>
          tx.update(channels).set({ webhookVerifiedAt: new Date() }).where(eq(channels.id, ch.id)),
        );
        return reply.type("text/plain").send(q["hub.challenge"] ?? "");
      },
    );

    hook.post<{ Params: { channelId: string } }>(
      "/api/webhooks/whatsapp/:channelId",
      async (req, reply) => {
        const ch = await loadRoute(req.params.channelId);
        if (!ch) return reply.code(404).send();
        const raw = req.body as Buffer;
        const secret = decryptSecret(ch.appSecretEnc, wa.encryptionKey);
        if (
          !Buffer.isBuffer(raw) ||
          !verifySignature(raw, req.headers["x-hub-signature-256"] as string | undefined, secret)
        ) {
          req.log.warn({ channelId: ch.id }, "webhook de WhatsApp con firma inválida");
          // Visible en Integraciones → WhatsApp: casi siempre es un App Secret equivocado.
          await withTenant(db, ch.tenantId, (tx) =>
            tx
              .update(channels)
              .set({
                status: "error",
                lastError: `Meta envió un webhook (${new Date().toISOString()}) pero la firma no coincide: revisa que el App Secret sea el de esta app de Meta.`,
              })
              .where(eq(channels.id, ch.id)),
          );
          return reply.code(401).send();
        }
        let payload: unknown;
        try {
          payload = JSON.parse(raw.toString("utf8"));
        } catch {
          return reply.code(400).send();
        }
        const events = await withTenant(db, ch.tenantId, (tx) =>
          ingestWebhook(tx, ch, parseWebhook(payload)),
        );
        for (const e of events) {
          bus.publish(ch.tenantId, e);
          if (e.type === "message") opts.onInbound?.(ch.tenantId, e.conversationId);
        }
        return reply.code(200).send({ ok: true });
      },
    );
  });

  // ---------- Canales ----------
  app.get("/api/channels", { preHandler: anyMember }, async (req) => {
    const rows = await withTenant(db, req.ctx.tenantId, (tx) => tx.select().from(channels));
    return rows.map(publicChannel);
  });

  app.post("/api/channels", { preHandler: admins }, async (req, reply) => {
    const body = channelBody.safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({ error: "datos_invalidos", issues: body.error.issues });
    const [taken] = await db
      .select()
      .from(channelRoutes)
      .where(eq(channelRoutes.phoneNumberId, body.data.phoneNumberId));
    if (taken) return reply.code(409).send({ error: "numero_ya_conectado" });

    const draft = {
      accessTokenEnc: encryptSecret(body.data.accessToken, wa.encryptionKey),
      appSecretEnc: encryptSecret(body.data.appSecret, wa.encryptionKey),
    } as Channel;
    let info: Awaited<ReturnType<ReturnType<typeof graphFor>["phoneNumber"]>>;
    try {
      info = await graphFor(draft, wa).phoneNumber(body.data.phoneNumberId);
    } catch (e) {
      const g = e as GraphError;
      return reply.code(400).send({
        error: g.tokenInvalid ? "whatsapp_token_invalido" : "whatsapp_meta_error",
        detail: g.message,
      });
    }

    const ch = await withTenant(db, req.ctx.tenantId, async (tx) => {
      const [row] = await tx
        .insert(channels)
        .values({
          name: body.data.name,
          phoneNumberId: body.data.phoneNumberId,
          wabaId: body.data.wabaId,
          displayPhone: info.display_phone_number ?? "",
          verifiedName: info.verified_name ?? "",
          accessTokenEnc: draft.accessTokenEnc,
          appSecretEnc: draft.appSecretEnc,
          verifyToken: randomBytes(18).toString("base64url"),
          status: "activo",
        })
        .returning();
      if (!row) throw new Error("no se creó el canal");
      await tx
        .insert(auditLog)
        .values({ actorUserId: req.ctx.userId, action: "channel.created", target: row.id });
      return row;
    });
    await db
      .insert(channelRoutes)
      .values({ channelId: ch.id, tenantId: ch.tenantId, phoneNumberId: ch.phoneNumberId });
    return reply.code(201).send(publicChannel(ch));
  });

  app.patch<{ Params: { id: string } }>(
    "/api/channels/:id",
    { preHandler: admins },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      const body = channelPatch.safeParse(req.body);
      if (!body.success)
        return reply.code(400).send({ error: "datos_invalidos", issues: body.error.issues });
      const set: Partial<Channel> = {};
      if (body.data.name) set.name = body.data.name;
      if (body.data.wabaId) set.wabaId = body.data.wabaId;
      if (body.data.accessToken)
        set.accessTokenEnc = encryptSecret(body.data.accessToken, wa.encryptionKey);
      if (body.data.appSecret)
        set.appSecretEnc = encryptSecret(body.data.appSecret, wa.encryptionKey);
      const ch = await withTenant(db, req.ctx.tenantId, async (tx) => {
        const [row] = await tx
          .update(channels)
          .set(set)
          .where(eq(channels.id, req.params.id))
          .returning();
        if (row)
          await tx
            .insert(auditLog)
            .values({ actorUserId: req.ctx.userId, action: "channel.updated", target: row.id });
        return row;
      });
      return ch ? publicChannel(ch) : reply.code(404).send();
    },
  );

  /** Prueba el token contra Meta y actualiza el estado del canal. */
  app.post<{ Params: { id: string } }>(
    "/api/channels/:id/test",
    { preHandler: admins },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      return withTenant(db, req.ctx.tenantId, async (tx) => {
        const [ch] = await tx.select().from(channels).where(eq(channels.id, req.params.id));
        if (!ch) return reply.code(404).send();
        try {
          const graph = graphFor(ch, wa);
          const info = await graph.phoneNumber(ch.phoneNumberId);
          await graph.subscribeApp(ch.wabaId);
          const [row] = await tx
            .update(channels)
            .set({
              status: "activo",
              lastError: null,
              displayPhone: info.display_phone_number,
              verifiedName: info.verified_name,
            })
            .where(eq(channels.id, ch.id))
            .returning();
          return {
            ok: true,
            channel: row ? publicChannel(row) : null,
            qualityRating: info.quality_rating ?? null,
          };
        } catch (e) {
          await tx
            .update(channels)
            .set({ status: "error", lastError: (e as Error).message })
            .where(eq(channels.id, ch.id));
          return reply
            .code(400)
            .send({ error: "whatsapp_meta_error", detail: (e as Error).message });
        }
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/channels/:id",
    { preHandler: admins },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      const n = await withTenant(db, req.ctx.tenantId, async (tx) => {
        const rows = await tx
          .delete(channels)
          .where(eq(channels.id, req.params.id))
          .returning({ id: channels.id });
        if (rows.length)
          await tx.insert(auditLog).values({
            actorUserId: req.ctx.userId,
            action: "channel.deleted",
            target: req.params.id,
          });
        return rows.length;
      });
      return reply.code(n ? 204 : 404).send();
    },
  );

  // ---------- Plantillas ----------
  app.get<{ Params: { id: string } }>(
    "/api/channels/:id/templates",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      return withTenant(db, req.ctx.tenantId, (tx) =>
        tx
          .select()
          .from(messageTemplates)
          .where(eq(messageTemplates.channelId, req.params.id))
          .orderBy(messageTemplates.name),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/channels/:id/templates/sync",
    { preHandler: admins },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      return withTenant(db, req.ctx.tenantId, async (tx) => {
        const [ch] = await tx.select().from(channels).where(eq(channels.id, req.params.id));
        if (!ch) return reply.code(404).send();
        let list: Awaited<ReturnType<ReturnType<typeof graphFor>["listTemplates"]>>;
        try {
          list = await graphFor(ch, wa).listTemplates(ch.wabaId);
        } catch (e) {
          return reply
            .code(400)
            .send({ error: "whatsapp_meta_error", detail: (e as Error).message });
        }
        for (const t of list) {
          const values = {
            channelId: ch.id,
            metaId: t.id,
            name: t.name,
            language: t.language,
            category: t.category,
            status: t.status,
            rejectedReason:
              t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
            components: t.components ?? [],
          };
          await tx
            .insert(messageTemplates)
            .values(values)
            .onConflictDoUpdate({
              target: [
                messageTemplates.channelId,
                messageTemplates.name,
                messageTemplates.language,
              ],
              set: values,
            });
        }
        return { synced: list.length };
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/channels/:id/templates",
    { preHandler: admins },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      const body = templateBody.safeParse(req.body);
      if (!body.success)
        return reply.code(400).send({ error: "datos_invalidos", issues: body.error.issues });
      const vars = [...body.data.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      const count = vars.length ? Math.max(...vars) : 0;
      if (body.data.examples.length < count)
        return reply.code(400).send({ error: "faltan_ejemplos", count });

      const components: Record<string, unknown>[] = [
        {
          type: "BODY",
          text: body.data.body,
          ...(count ? { example: { body_text: [body.data.examples.slice(0, count)] } } : {}),
        },
      ];
      if (body.data.footer) components.push({ type: "FOOTER", text: body.data.footer });

      return withTenant(db, req.ctx.tenantId, async (tx) => {
        const [ch] = await tx.select().from(channels).where(eq(channels.id, req.params.id));
        if (!ch) return reply.code(404).send();
        try {
          const r = await graphFor(ch, wa).createTemplate(ch.wabaId, {
            name: body.data.name,
            language: body.data.language,
            category: body.data.category,
            components,
          });
          const [row] = await tx
            .insert(messageTemplates)
            .values({
              channelId: ch.id,
              metaId: r.id,
              name: body.data.name,
              language: body.data.language,
              category: r.category ?? body.data.category,
              status: r.status ?? "PENDING",
              components,
            })
            .onConflictDoUpdate({
              target: [
                messageTemplates.channelId,
                messageTemplates.name,
                messageTemplates.language,
              ],
              set: { metaId: r.id, status: r.status ?? "PENDING", components },
            })
            .returning();
          await tx
            .insert(auditLog)
            .values({ actorUserId: req.ctx.userId, action: "template.created", target: row?.id });
          return reply.code(201).send(row);
        } catch (e) {
          if (e instanceof GraphError)
            return reply.code(400).send({ error: "whatsapp_meta_error", detail: e.message });
          throw e;
        }
      });
    },
  );
}
