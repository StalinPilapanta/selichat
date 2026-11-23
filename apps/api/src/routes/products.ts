import { type Database, schema, withTenant } from "@chatea/db";
import { productInputSchema } from "@chatea/shared";
import { asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Auth } from "../auth.js";
import { requireTenant } from "../plugins/tenant.js";
import { loadProduct, saveProduct, TriggerConflictError } from "../services/catalog.js";

const { products, auditLog } = schema;
const isUuid = (v: string) => z.uuid().safeParse(v).success;

export async function productRoutes(app: FastifyInstance, opts: { auth: Auth; db: Database }) {
  const { auth, db } = opts;
  const anyMember = requireTenant(auth, db);
  const editors = requireTenant(auth, db, ["owner", "admin"]);

  const conflict = (e: unknown) =>
    e instanceof TriggerConflictError
      ? {
          error: "disparador_en_uso",
          detail: `"${e.trigger.value}" ya activa el producto "${e.productName}"`,
        }
      : null;

  app.get("/api/products", { preHandler: anyMember }, async (req) =>
    withTenant(db, req.ctx.tenantId, (tx) =>
      tx
        .select({
          id: products.id,
          name: products.name,
          status: products.status,
          price: products.price,
          currency: products.currency,
          imageUrl: products.imageUrl,
          dropiProductId: products.dropiProductId,
          updatedAt: products.updatedAt,
          // Nombres calificados a mano: dentro de la subconsulta drizzle no prefija las columnas.
          triggers: sql<number>`(select count(*)::int from product_triggers pt where pt.product_id = "products"."id")`,
          offers: sql<number>`(select count(*)::int from product_offers po where po.product_id = "products"."id")`,
        })
        .from(products)
        .orderBy(asc(products.name)),
    ),
  );

  app.get<{ Params: { id: string } }>(
    "/api/products/:id",
    { preHandler: anyMember },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send({ error: "no_existe" });
      const p = await withTenant(db, req.ctx.tenantId, (tx) => loadProduct(tx, req.params.id));
      return p ?? reply.code(404).send({ error: "no_existe" });
    },
  );

  app.post("/api/products", { preHandler: editors }, async (req, reply) => {
    const body = productInputSchema.safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({ error: "datos_invalidos", issues: body.error.issues });
    try {
      const product = await withTenant(db, req.ctx.tenantId, async (tx) => {
        const id = (await saveProduct(tx, body.data)) as string;
        await tx
          .insert(auditLog)
          .values({ actorUserId: req.ctx.userId, action: "product.created", target: id });
        return loadProduct(tx, id);
      });
      return reply.code(201).send(product);
    } catch (e) {
      const c = conflict(e);
      if (c) return reply.code(409).send(c);
      throw e;
    }
  });

  app.put<{ Params: { id: string } }>(
    "/api/products/:id",
    { preHandler: editors },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send({ error: "no_existe" });
      const body = productInputSchema.safeParse(req.body);
      if (!body.success)
        return reply.code(400).send({ error: "datos_invalidos", issues: body.error.issues });
      try {
        const product = await withTenant(db, req.ctx.tenantId, async (tx) => {
          const id = await saveProduct(tx, body.data, { id: req.params.id });
          if (!id) return null;
          await tx
            .insert(auditLog)
            .values({ actorUserId: req.ctx.userId, action: "product.updated", target: id });
          return loadProduct(tx, id);
        });
        return product ?? reply.code(404).send({ error: "no_existe" });
      } catch (e) {
        const c = conflict(e);
        if (c) return reply.code(409).send(c);
        throw e;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/products/:id",
    { preHandler: editors },
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send();
      const n = await withTenant(db, req.ctx.tenantId, async (tx) => {
        const rows = await tx
          .delete(products)
          .where(eq(products.id, req.params.id))
          .returning({ id: products.id });
        if (rows.length)
          await tx.insert(auditLog).values({
            actorUserId: req.ctx.userId,
            action: "product.deleted",
            target: req.params.id,
          });
        return rows.length;
      });
      return reply.code(n ? 204 : 404).send();
    },
  );
}
