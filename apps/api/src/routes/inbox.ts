import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Database, schema, withTenant } from "@chatea/db";
import { digitsOnly, windowOpen } from "@chatea/shared";
import { and, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Auth } from "../auth.js";
import { requireTenant } from "../plugins/tenant.js";
import type { RealtimeBus } from "../realtime.js";
import {
  graphFor,
  type SendInput,
  sendToConversation,
  type WaConfig,
} from "../whatsapp/service.js";

const {
  conversations,
  contacts,
  messages,
  channels,
  conversationNotes,
  messageTemplates,
  member,
  user,
  products,
  auditLog,
} = schema;
const isUuid = (v: string) => z.uuid().safeParse(v).success;

const listQuery = z.object({
  filter: z.enum(["todas", "mias", "sin_asignar", "pausadas", "cerradas"]).default("todas"),
  q: z.string().trim().max(80).optional(),
  before: z.iso.datetime().optional(),
});

const patchBody = z.object({
  assignedUserId: z.string().min(1).nullable().optional(),
  botPaused: z.boolean().optional(),
  status: z.enum(["abierta", "cerrada"]).optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

const sendBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), body: z.string().trim().min(1).max(4096) }),
  z.object({
    kind: z.literal("media"),
    mediaType: z.enum(["image", "video", "audio", "document"]),
    url: z.url(),
    caption: z.string().max(1024).optional(),
    filename: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal("template"),
    templateId: z.uuid(),
    params: z.array(z.string().max(1000)).max(20).default([]),
  }),
]);

const newConversationBody = z.object({
  channelId: z.uuid(),
  phone: z.string().min(8).max(20),
  name: z.string().max(80).optional(),
});

/** Texto de la plantilla con {{n}} reemplazados, para mostrarlo en la bandeja. */
function renderTemplateBody(components: Record<string, unknown>[], params: string[]) {
  const body = components.find((c) => String(c.type).toUpperCase() === "BODY");
  const text = typeof body?.text === "string" ? body.text : "";
  return text.replace(/\{\{(\d+)\}\}/g, (w, n) => params[Number(n) - 1] ?? w);
}

export async function inboxRoutes(
  app: FastifyInstance,
  opts: { auth: Auth; db: Database; bus: RealtimeBus; wa: WaConfig; uploadDir: string },
) {
  const { auth, db, bus, wa } = opts;
  const anyMember = requireTenant(auth, db);
  const admins = requireTenant(auth, db, ["owner", "admin"]);
  const mediaRoot = resolve(opts.uploadDir);

  const convSelect = {
    id: conversations.id,
    status: conversations.status,
    assignedUserId: conversations.assignedUserId,
    botPaused: conversations.botPaused,
    labels: conversations.labels,
    unreadCount: conversations.unreadCount,
    lastMessageAt: conversations.lastMessageAt,
    lastMessagePreview: conversations.lastMessagePreview,
    lastInboundAt: conversations.lastInboundAt,
    productId: conversations.productId,
    channelId: conversations.channelId,
    checkoutState: conversations.checkoutState,
    handoffReason: conversations.handoffReason,
    contact: {
      id: contacts.id,
      phone: contacts.phone,
      name: contacts.name,
      profileName: contacts.profileName,
      city: contacts.city,
      sourceAdId: contacts.sourceAdId,
    },
  };

  app.get("/api/conversations", { preHandler: anyMember }, async (req, reply) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "datos_invalidos" });
    const { filter, q: search, before } = q.data;
    const conds = [
      filter === "cerradas"
        ? eq(conversations.status, "cerrada")
        : eq(conversations.status, "abierta"),
      filter === "mias" ? eq(conversations.assignedUserId, req.ctx.userId) : undefined,
      filter === "sin_asignar" ? isNull(conversations.assignedUserId) : undefined,
      filter === "pausadas" ? eq(conversations.botPaused, true) : undefined,
      before ? lt(conversations.lastMessageAt, new Date(before)) : undefined,
      search
        ? or(
            ilike(contacts.name, `%${search}%`),
            ilike(contacts.profileName, `%${search}%`),
            ilike(contacts.phone, `%${digitsOnly(search) || search}%`),
          )
        : undefined,
    ].filter(Boolean);
    const rows = await withTenant(db, req.ctx.tenantId, (tx) =>
      tx
        .select(convSelect)
        .from(conversations)
        .innerJoin(contacts, eq(contacts.id, conversations.contactId))
        .where(and(...conds))
        .orderBy(desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`))
        .limit(50),
    );
    return rows.map((r) => ({ ...r, windowOpen: windowOpen(r.lastInboundAt) }));
  });

  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      const r = await withTenant(db, req.ctx.tenantId, async (tx) => {
        const [c] = await tx
          .select({
            ...convSelect,
            referral: contacts.referral,
            ctwaClid: contacts.ctwaClid,
            channelName: channels.name,
            displayPhone: channels.displayPhone,
            productName: products.name,
            // Último turno de la IA: si falló o no respondió, la ficha muestra el motivo.
            lastAgentRun: sql<{
              status: string;
              error: string | null;
              reason: string;
              at: string;
            } | null>`(select json_build_object('status', r.status, 'error', r.error, 'reason', r.reply, 'at', r.created_at) from agent_runs r where r.conversation_id = ${conversations.id} and r.agent = 'ventas' order by r.created_at desc limit 1)`,
          })
          .from(conversations)
          .innerJoin(contacts, eq(contacts.id, conversations.contactId))
          .innerJoin(channels, eq(channels.id, conversations.channelId))
          .leftJoin(products, eq(products.id, conversations.productId))
          .where(eq(conversations.id, req.params.id));
        return c;
      });
      return r ? { ...r, windowOpen: windowOpen(r.lastInboundAt) } : reply.code(404).send();
    },
  );

  app.get<{ Params: { id: string }; Querystring: { before?: string } }>(
    "/api/conversations/:id/messages",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      const before =
        req.query.before && !Number.isNaN(Date.parse(req.query.before))
          ? new Date(req.query.before)
          : null;
      const rows = await withTenant(db, req.ctx.tenantId, (tx) =>
        tx
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, req.params.id),
              before ? lt(messages.sentAt, before) : undefined,
            ),
          )
          .orderBy(desc(messages.sentAt))
          .limit(50),
      );
      return rows.reverse();
    },
  );

  /** Marca como leída en chatea y avisa a Meta (doble check azul) del último mensaje del cliente. */
  app.post<{ Params: { id: string } }>(
    "/api/conversations/:id/read",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      const last = await withTenant(db, req.ctx.tenantId, async (tx) => {
        const [c] = await tx
          .update(conversations)
          .set({ unreadCount: 0 })
          .where(eq(conversations.id, req.params.id))
          .returning();
        if (!c) return null;
        const [m] = await tx
          .select({ waId: messages.waMessageId, channel: channels })
          .from(messages)
          .innerJoin(channels, eq(channels.id, c.channelId))
          .where(and(eq(messages.conversationId, c.id), eq(messages.direction, "in")))
          .orderBy(desc(messages.sentAt))
          .limit(1);
        return m ?? { waId: null, channel: null };
      });
      if (!last) return reply.code(404).send();
      if (last.waId && last.channel) {
        graphFor(last.channel, wa)
          .markRead(last.channel.phoneNumberId, last.waId)
          .catch((e) => req.log.debug({ err: (e as Error).message }, "markRead falló"));
      }
      bus.publish(req.ctx.tenantId, { type: "conversation", conversationId: req.params.id });
      return { ok: true };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/conversations/:id",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      const body = patchBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "datos_invalidos" });
      if (body.data.assignedUserId) {
        const [m] = await db
          .select({ id: member.id })
          .from(member)
          .where(
            and(
              eq(member.organizationId, req.ctx.tenantId),
              eq(member.userId, body.data.assignedUserId),
            ),
          );
        if (!m) return reply.code(400).send({ error: "usuario_no_es_miembro" });
      }
      const row = await withTenant(db, req.ctx.tenantId, async (tx) => {
        const [c] = await tx
          .update(conversations)
          // Reanudar la IA borra el motivo del paso a humano.
          .set(body.data.botPaused === false ? { ...body.data, handoffReason: null } : body.data)
          .where(eq(conversations.id, req.params.id))
          .returning();
        if (c && body.data.botPaused !== undefined)
          await tx.insert(auditLog).values({
            actorUserId: req.ctx.userId,
            action: body.data.botPaused ? "conversation.bot_paused" : "conversation.bot_resumed",
            target: c.id,
          });
        return c;
      });
      if (!row) return reply.code(404).send();
      bus.publish(req.ctx.tenantId, { type: "conversation", conversationId: row.id });
      return row;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/conversations/:id/messages",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      const body = sendBody.safeParse(req.body);
      if (!body.success)
        return reply.code(400).send({ error: "datos_invalidos", issues: body.error.issues });

      const result = await withTenant(db, req.ctx.tenantId, async (tx) => {
        const [c] = await tx
          .select()
          .from(conversations)
          .where(eq(conversations.id, req.params.id));
        if (!c) return { status: 404 as const, body: { error: "no_existe" } };

        let input: SendInput;
        if (body.data.kind === "template") {
          const [t] = await tx
            .select()
            .from(messageTemplates)
            .where(
              and(
                eq(messageTemplates.id, body.data.templateId),
                eq(messageTemplates.channelId, c.channelId),
              ),
            );
          if (!t) return { status: 404 as const, body: { error: "plantilla_no_existe" } };
          if (t.status !== "APPROVED")
            return { status: 400 as const, body: { error: "plantilla_no_aprobada" } };
          input = {
            kind: "template",
            name: t.name,
            language: t.language,
            params: body.data.params,
            preview: renderTemplateBody(t.components, body.data.params),
          };
        } else {
          // Fuera de la ventana de 24 h WhatsApp solo acepta plantillas.
          if (!windowOpen(c.lastInboundAt))
            return { status: 409 as const, body: { error: "ventana_cerrada" } };
          input = body.data;
        }
        const msg = await sendToConversation(tx, wa, c.id, input, {
          kind: "humano",
          userId: req.ctx.userId,
        });
        // Responder desde la bandeja = un humano tomó la conversación.
        if (msg)
          await tx
            .update(conversations)
            .set({
              assignedUserId: sql`coalesce(${conversations.assignedUserId}, ${req.ctx.userId})`,
              // Un humano tomó la conversación: la IA deja de responder hasta que se reanude.
              botPaused: true,
            })
            .where(eq(conversations.id, c.id));
        return { status: 201 as const, body: msg };
      });
      if (result.status === 201 && result.body && "id" in result.body) {
        bus.publish(req.ctx.tenantId, {
          type: "message",
          conversationId: req.params.id,
          messageId: result.body.id,
        });
      }
      return reply.code(result.status).send(result.body);
    },
  );

  /** Inicia una conversación con un número nuevo (luego se le escribe con plantilla). */
  app.post("/api/conversations", { preHandler: anyMember }, async (req, reply) => {
    const body = newConversationBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "datos_invalidos" });
    const phone = digitsOnly(body.data.phone);
    if (phone.length < 8) return reply.code(400).send({ error: "telefono_invalido" });
    return withTenant(db, req.ctx.tenantId, async (tx) => {
      const [ch] = await tx
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.id, body.data.channelId));
      if (!ch) return reply.code(404).send({ error: "no_existe" });
      const [ct] = await tx
        .insert(contacts)
        .values({ phone, name: body.data.name ?? null })
        .onConflictDoUpdate({
          target: [contacts.tenantId, contacts.phone],
          set: { updatedAt: new Date() },
        })
        .returning({ id: contacts.id });
      const [conv] = await tx
        .insert(conversations)
        .values({ contactId: ct?.id as string, channelId: ch.id, assignedUserId: req.ctx.userId })
        .onConflictDoUpdate({
          target: [conversations.tenantId, conversations.contactId, conversations.channelId],
          set: { status: "abierta" },
        })
        .returning({ id: conversations.id });
      return reply.code(201).send(conv);
    });
  });

  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id/notes",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      return withTenant(db, req.ctx.tenantId, (tx) =>
        tx
          .select({
            id: conversationNotes.id,
            body: conversationNotes.body,
            createdAt: conversationNotes.createdAt,
            userId: conversationNotes.userId,
          })
          .from(conversationNotes)
          .where(eq(conversationNotes.conversationId, req.params.id))
          .orderBy(desc(conversationNotes.createdAt)),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/conversations/:id/notes",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      const body = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "datos_invalidos" });
      const row = await withTenant(db, req.ctx.tenantId, async (tx) => {
        const [c] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.id, req.params.id));
        if (!c) return null;
        const [n] = await tx
          .insert(conversationNotes)
          .values({ conversationId: c.id, userId: req.ctx.userId, body: body.data.body })
          .returning();
        return n;
      });
      return row ? reply.code(201).send(row) : reply.code(404).send();
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/contacts/:id",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      const body = z
        .object({
          name: z.string().max(80).nullable().optional(),
          city: z.string().max(80).nullable().optional(),
        })
        .safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "datos_invalidos" });
      const [row] = await withTenant(db, req.ctx.tenantId, (tx) =>
        tx.update(contacts).set(body.data).where(eq(contacts.id, req.params.id)).returning(),
      );
      return row ?? reply.code(404).send();
    },
  );

  /**
   * Elimina un contacto con sus conversaciones, mensajes y notas (solo dueño o administrador).
   * Los pedidos se conservan (quedan sin contacto ni conversación) para no perder ventas.
   */
  app.delete<{ Params: { id: string } }>(
    "/api/contacts/:id",
    { preHandler: admins },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      const removed = await withTenant(db, req.ctx.tenantId, async (tx) => {
        const convs = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.contactId, req.params.id));
        const [row] = await tx
          .delete(contacts)
          .where(eq(contacts.id, req.params.id))
          .returning({ id: contacts.id });
        if (!row) return null;
        await tx.insert(auditLog).values({
          actorUserId: req.ctx.userId,
          action: "contacto.eliminar",
          data: { contactId: row.id, conversaciones: convs.length },
        });
        return convs;
      });
      if (!removed) return reply.code(404).send();
      // Las bandejas abiertas recargan la lista (la conversación ya no existe).
      for (const c of removed)
        bus.publish(req.ctx.tenantId, { type: "conversation", conversationId: c.id });
      return { ok: true, conversations: removed.length };
    },
  );

  /** Miembros del equipo, para asignar conversaciones. */
  app.get("/api/team", { preHandler: anyMember }, async (req) =>
    db
      .select({ id: user.id, name: user.name, email: user.email, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, req.ctx.tenantId)),
  );

  /**
   * Media de un mensaje entrante: se descarga de Meta la primera vez (sus URLs vencen)
   * y queda guardada en disco para las siguientes.
   */
  app.get<{ Params: { id: string } }>(
    "/api/messages/:id/media",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      const tenantId = req.ctx.tenantId;
      const row = await withTenant(db, tenantId, async (tx) => {
        const [m] = await tx
          .select({ media: messages.media, channel: channels })
          .from(messages)
          .innerJoin(conversations, eq(conversations.id, messages.conversationId))
          .innerJoin(channels, eq(channels.id, conversations.channelId))
          .where(eq(messages.id, req.params.id));
        return m;
      });
      const mediaId = row?.media?.waMediaId;
      if (!row || !mediaId || !/^[A-Za-z0-9_-]{1,64}$/.test(mediaId)) return reply.code(404).send();

      const dir = join(mediaRoot, tenantId, "wa");
      const file = join(dir, mediaId);
      const cached = await readFile(file).catch(() => null);
      const mime = row.media?.mimeType?.split(";")[0] ?? "application/octet-stream";
      reply.header("cache-control", "private, max-age=86400");
      reply.header("x-content-type-options", "nosniff");
      if (cached) return reply.type(mime).send(cached);
      try {
        const { bytes, mimeType } = await graphFor(row.channel, wa).downloadMedia(mediaId);
        await mkdir(dir, { recursive: true });
        await writeFile(file, bytes);
        return reply.type(mimeType.split(";")[0] ?? mime).send(bytes);
      } catch (e) {
        req.log.warn({ err: (e as Error).message }, "no se pudo descargar media de WhatsApp");
        return reply.code(502).send({ error: "media_no_disponible" });
      }
    },
  );

  /** Server-Sent Events: la bandeja se entera al instante de mensajes y cambios. */
  app.get("/api/inbox/stream", { preHandler: anyMember }, async (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 3000\n\n");
    const off = bus.subscribe(req.ctx.tenantId, (e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.raw.on("close", () => {
      clearInterval(ping);
      off();
    });
  });
}
