import { type Database, schema, withTenant } from "@chatea/db";
import {
  AGENT_KINDS,
  type AiProviderKind,
  aiProviderInputSchema,
  brandingSchema,
  CURRENCY_CODES,
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "@chatea/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { assertPublicHttpsUrl, listProviderModels, ProviderError } from "../ai/provider-models.js";
import type { Auth } from "../auth.js";
import { requireTenant } from "../plugins/tenant.js";

const settingsSchema = z.object({
  country: z.string().length(2).toUpperCase(),
  currency: z.string().toUpperCase().pipe(z.enum(CURRENCY_CODES)),
  timezone: z.string().min(1),
  messagingWindow: z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  }),
});

const agentConfigSchema = z.object({
  providerId: z.uuid().nullable(),
  model: z.string().min(1).max(120).nullable(),
  temperature: z.number().min(0).max(2),
});

export async function tenantRoutes(
  app: FastifyInstance,
  opts: { auth: Auth; db: Database; encryptionKey: string; fetchImpl?: typeof fetch },
) {
  const { auth, db, encryptionKey } = opts;
  const anyMember = requireTenant(auth, db);
  const admins = requireTenant(auth, db, ["owner", "admin"]);

  const audit = (
    tx: Parameters<Parameters<typeof withTenant>[2]>[0],
    userId: string,
    action: string,
    target?: string,
  ) => tx.insert(schema.auditLog).values({ actorUserId: userId, action, target });

  app.get("/api/me", { preHandler: anyMember }, async (req) => req.ctx);

  // --- Configuración del tenant ---
  app.get("/api/settings", { preHandler: anyMember }, async (req) => {
    const [row] = await withTenant(db, req.ctx.tenantId, (tx) =>
      tx.select().from(schema.tenantSettings).limit(1),
    );
    return row ?? null;
  });

  app.put("/api/settings", { preHandler: admins }, async (req, reply) => {
    const body = settingsSchema.safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({ error: "datos_invalidos", issues: body.error.issues });
    return withTenant(db, req.ctx.tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.tenantSettings)
        .values(body.data)
        .onConflictDoUpdate({ target: schema.tenantSettings.tenantId, set: body.data })
        .returning();
      await audit(tx, req.ctx.userId, "settings.updated");
      return row;
    });
  });

  // --- Branding (nombre, color y logo de la tienda) ---
  app.put("/api/settings/branding", { preHandler: admins }, async (req, reply) => {
    const body = brandingSchema.safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({
        error: "datos_invalidos",
        message: body.error.issues[0]?.message,
      });
    const { name, color, logoUrl } = body.data;
    // El logo tiene que ser un archivo subido a esta tienda (no una URL cualquiera).
    if (logoUrl && !new URL(logoUrl).pathname.startsWith(`/api/files/${req.ctx.tenantId}/`))
      return reply
        .code(400)
        .send({ error: "datos_invalidos", message: "Sube el logo desde aquí." });
    const values = {
      brandName: name?.trim() || null,
      brandColor: color?.toLowerCase() ?? null,
      logoUrl: logoUrl || null,
    };
    return withTenant(db, req.ctx.tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.tenantSettings)
        .values(values)
        .onConflictDoUpdate({ target: schema.tenantSettings.tenantId, set: values })
        .returning();
      await audit(tx, req.ctx.userId, "branding.updated");
      return row;
    });
  });

  // --- Proveedores de IA (la API key nunca sale del servidor) ---
  const publicProvider = {
    id: schema.aiProviders.id,
    kind: schema.aiProviders.kind,
    name: schema.aiProviders.name,
    apiKeyHint: schema.aiProviders.apiKeyHint,
    baseUrl: schema.aiProviders.baseUrl,
    createdAt: schema.aiProviders.createdAt,
  };

  app.get("/api/ai-providers", { preHandler: anyMember }, async (req) =>
    withTenant(db, req.ctx.tenantId, (tx) => tx.select(publicProvider).from(schema.aiProviders)),
  );

  app.post("/api/ai-providers", { preHandler: admins }, async (req, reply) => {
    const body = aiProviderInputSchema.safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({ error: "datos_invalidos", issues: body.error.issues });
    if (body.data.kind === "openai_compatible") {
      if (!body.data.baseUrl) return reply.code(400).send({ error: "base_url_requerida" });
      try {
        await assertPublicHttpsUrl(body.data.baseUrl);
      } catch (e) {
        if (e instanceof ProviderError) return reply.code(400).send({ error: e.message });
        throw e;
      }
    }
    const created = await withTenant(db, req.ctx.tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.aiProviders)
        .values({
          kind: body.data.kind,
          name: body.data.name,
          baseUrl: body.data.baseUrl,
          apiKeyEnc: encryptSecret(body.data.apiKey, encryptionKey),
          apiKeyHint: maskSecret(body.data.apiKey),
        })
        .returning(publicProvider);
      await audit(tx, req.ctx.userId, "ai_provider.created", row?.id);
      return row;
    });
    return reply.code(201).send(created);
  });

  /** Modelos disponibles en la cuenta del tenant, consultados en vivo al proveedor. */
  app.get<{ Params: { id: string } }>(
    "/api/ai-providers/:id/models",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!z.uuid().safeParse(req.params.id).success)
        return reply.code(404).send({ error: "no_existe" });
      const [p] = await withTenant(db, req.ctx.tenantId, (tx) =>
        tx.select().from(schema.aiProviders).where(eq(schema.aiProviders.id, req.params.id)),
      );
      if (!p) return reply.code(404).send({ error: "no_existe" });
      try {
        const models = await listProviderModels(
          p.kind as AiProviderKind,
          decryptSecret(p.apiKeyEnc, encryptionKey),
          p.baseUrl,
          opts.fetchImpl,
        );
        return { models };
      } catch (e) {
        if (e instanceof ProviderError) return reply.code(502).send({ error: e.message });
        throw e;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/ai-providers/:id",
    { preHandler: admins },
    async (req, reply) => {
      if (!z.uuid().safeParse(req.params.id).success) return reply.code(404).send();
      const deleted = await withTenant(db, req.ctx.tenantId, async (tx) => {
        const rows = await tx
          .delete(schema.aiProviders)
          .where(eq(schema.aiProviders.id, req.params.id))
          .returning({ id: schema.aiProviders.id });
        if (rows.length) await audit(tx, req.ctx.userId, "ai_provider.deleted", req.params.id);
        return rows.length;
      });
      return reply.code(deleted ? 204 : 404).send();
    },
  );

  // --- Modelo por agente ---
  app.get("/api/agent-configs", { preHandler: anyMember }, async (req) => {
    const rows = await withTenant(db, req.ctx.tenantId, (tx) =>
      tx.select().from(schema.agentConfigs),
    );
    return AGENT_KINDS.map(
      (agent) =>
        rows.find((r) => r.agent === agent) ?? {
          agent,
          providerId: null,
          model: null,
          temperature: 0.4,
        },
    );
  });

  app.put<{ Params: { agent: string } }>(
    "/api/agent-configs/:agent",
    { preHandler: admins },
    async (req, reply) => {
      const agent = z.enum(AGENT_KINDS).safeParse(req.params.agent);
      const body = agentConfigSchema.safeParse(req.body);
      if (!agent.success || !body.success)
        return reply.code(400).send({ error: "datos_invalidos" });

      return withTenant(db, req.ctx.tenantId, async (tx) => {
        if (body.data.providerId) {
          // RLS ya impide ver proveedores ajenos; esto da un error claro en vez de un FK genérico.
          const [p] = await tx
            .select({ id: schema.aiProviders.id })
            .from(schema.aiProviders)
            .where(and(eq(schema.aiProviders.id, body.data.providerId)));
          if (!p) return reply.code(400).send({ error: "proveedor_no_existe" });
        }
        const [row] = await tx
          .insert(schema.agentConfigs)
          .values({ agent: agent.data, ...body.data })
          .onConflictDoUpdate({
            target: [schema.agentConfigs.tenantId, schema.agentConfigs.agent],
            set: body.data,
          })
          .returning();
        await audit(tx, req.ctx.userId, "agent_config.updated", agent.data);
        return row;
      });
    },
  );
}
