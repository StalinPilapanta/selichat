import { type Database, schema, withTenant } from "@chatea/db";
import {
  buildBuiltinVariables,
  composePrompt,
  PLATFORM_PROMPT,
  PROMPT_SCOPES,
  promptVersionInputSchema,
} from "@chatea/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Auth } from "../auth.js";
import { requireTenant } from "../plugins/tenant.js";
import { activePrompt, catalogForPrompt, latestPrompt, loadProduct } from "../services/catalog.js";

const { prompts, products, organization, tenantSettings, auditLog } = schema;

const listQuery = z.object({
  scope: z.enum(PROMPT_SCOPES),
  productId: z.uuid().optional(),
});

const previewBody = z.object({
  productId: z.uuid(),
  /** Borrador sin guardar; si falta se usa la versión activa (o la última). */
  draft: z
    .object({
      mode: z.enum(["libre", "guiado"]),
      content: z.string(),
      sections: z.record(z.string(), z.string()),
      variables: z.record(z.string(), z.string()),
    })
    .optional(),
});

export async function promptRoutes(app: FastifyInstance, opts: { auth: Auth; db: Database }) {
  const { auth, db } = opts;
  const anyMember = requireTenant(auth, db);
  const editors = requireTenant(auth, db, ["owner", "admin"]);

  /** Historial de versiones, de la más nueva a la más vieja; marca la activa. */
  app.get("/api/prompts", { preHandler: anyMember }, async (req, reply) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success || (q.data.scope === "product") !== Boolean(q.data.productId))
      return reply.code(400).send({ error: "datos_invalidos" });
    const productId = q.data.productId ?? null;
    return withTenant(db, req.ctx.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(prompts)
        .where(
          and(
            eq(prompts.scope, q.data.scope),
            productId ? eq(prompts.productId, productId) : isNull(prompts.productId),
          ),
        )
        .orderBy(desc(prompts.version))
        .limit(50);
      const active = await activePrompt(tx, q.data.scope, productId);
      return rows.map((r) => ({ ...r, active: r.id === active?.id }));
    });
  });

  /** Guarda una versión nueva (y opcionalmente la publica). */
  app.post("/api/prompts", { preHandler: editors }, async (req, reply) => {
    const body = promptVersionInputSchema.safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({ error: "datos_invalidos", issues: body.error.issues });
    const { publish, ...v } = body.data;
    return withTenant(db, req.ctx.tenantId, async (tx) => {
      if (v.productId) {
        const [p] = await tx
          .select({ id: products.id })
          .from(products)
          .where(eq(products.id, v.productId));
        if (!p) return reply.code(404).send({ error: "no_existe" });
      }
      // Serializa versiones concurrentes del mismo prompt.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${req.ctx.tenantId}:${v.scope}:${v.productId}`}))`,
      );
      const last = await latestPrompt(tx, v.scope, v.productId);
      const [row] = await tx
        .insert(prompts)
        .values({
          ...v,
          version: (last?.version ?? 0) + 1,
          createdBy: req.ctx.userId,
          publishedAt: publish ? new Date() : null,
        })
        .returning();
      await tx.insert(auditLog).values({
        actorUserId: req.ctx.userId,
        action: publish ? "prompt.published" : "prompt.saved",
        target: row?.id,
        data: { scope: v.scope, productId: v.productId, version: row?.version },
      });
      return reply.code(201).send(row);
    });
  });

  /** Publica una versión existente (también sirve para volver a una anterior). */
  app.post<{ Params: { id: string } }>(
    "/api/prompts/:id/publish",
    { preHandler: editors },
    async (req, reply) => {
      if (!z.uuid().safeParse(req.params.id).success) return reply.code(404).send();
      return withTenant(db, req.ctx.tenantId, async (tx) => {
        const [row] = await tx
          .update(prompts)
          .set({ publishedAt: new Date() })
          .where(eq(prompts.id, req.params.id))
          .returning();
        if (!row) return reply.code(404).send({ error: "no_existe" });
        await tx.insert(auditLog).values({
          actorUserId: req.ctx.userId,
          action: "prompt.published",
          target: row.id,
          data: { scope: row.scope, productId: row.productId, version: row.version },
        });
        return row;
      });
    },
  );

  /** Prompt final que verá el agente para un producto, capa por capa. */
  app.post("/api/prompts/preview", { preHandler: anyMember }, async (req, reply) => {
    const body = previewBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "datos_invalidos" });
    const [org] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, req.ctx.tenantId));
    return withTenant(db, req.ctx.tenantId, async (tx) => {
      const product = await loadProduct(tx, body.data.productId);
      if (!product) return reply.code(404).send({ error: "no_existe" });
      const [settings] = await tx.select({ country: tenantSettings.country }).from(tenantSettings);
      const [common, master, productPrompt] = await Promise.all([
        activePrompt(tx, "common", null),
        activePrompt(tx, "master", null),
        body.data.draft
          ? null
          : activePrompt(tx, "product", product.id).then(
              (a) => a ?? latestPrompt(tx, "product", product.id),
            ),
      ]);
      const version = body.data.draft ?? {
        mode: (productPrompt?.mode ?? "libre") as "libre" | "guiado",
        content: productPrompt?.content ?? "",
        sections: productPrompt?.sections ?? {},
        variables: productPrompt?.variables ?? {},
      };
      return composePrompt({
        platform: PLATFORM_PROMPT,
        common: common?.content,
        master: master?.content,
        product: version,
        builtins: buildBuiltinVariables(
          catalogForPrompt(product, { name: org?.name ?? "", country: settings?.country ?? "" }),
        ),
      });
    });
  });
}
