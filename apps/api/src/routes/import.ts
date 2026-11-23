import { type Database, schema, type Tx, withTenant } from "@chatea/db";
import { type ProductData, type PromptScope, productInputSchema } from "@chatea/shared";
import { and, eq, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Auth } from "../auth.js";
import { requireTenant } from "../plugins/tenant.js";
import { activePrompt, latestPrompt, saveProduct } from "../services/catalog.js";
import {
  fetchBotFields,
  ImportError,
  type ParsedWorkspace,
  parseWorkspace,
} from "../services/chateapro-import.js";

const { products, productTriggers, prompts, auditLog } = schema;

const tokenBody = z.object({ token: z.string().trim().min(10).max(4000) });
const runBody = tokenBody.extend({
  slots: z.array(z.string()).max(100),
  includeCommon: z.boolean().default(true),
  includeMaster: z.boolean().default(true),
});

export interface ImportDeps {
  /** Inyectable para pruebas. */
  loadWorkspace?: (token: string) => Promise<ParsedWorkspace>;
}

/** Guarda una versión publicada solo si cambia respecto de la activa. */
async function publishIfChanged(
  tx: Tx,
  userId: string,
  scope: PromptScope,
  productId: string | null,
  v: { mode: "libre" | "guiado"; content: string; sections: Record<string, string> },
) {
  const active = await activePrompt(tx, scope, productId);
  if (
    active &&
    active.mode === v.mode &&
    active.content === v.content &&
    JSON.stringify(active.sections) === JSON.stringify(v.sections)
  )
    return false;
  const last = await latestPrompt(tx, scope, productId);
  await tx.insert(prompts).values({
    scope,
    productId,
    mode: v.mode,
    content: v.content,
    sections: v.sections,
    version: (last?.version ?? 0) + 1,
    note: "Importado desde Chatea Pro",
    createdBy: userId,
    publishedAt: new Date(),
  });
  return true;
}

export async function importRoutes(
  app: FastifyInstance,
  opts: { auth: Auth; db: Database } & ImportDeps,
) {
  const { auth, db } = opts;
  const admins = requireTenant(auth, db, ["owner", "admin"]);
  const load =
    opts.loadWorkspace ?? (async (token: string) => parseWorkspace(await fetchBotFields(token)));

  const fail = (e: unknown) => {
    if (e instanceof ImportError) return { status: 400, body: { error: e.message } };
    return null;
  };

  /** Qué se va a importar, sin escribir nada. */
  app.post("/api/import/chateapro/preview", { preHandler: admins }, async (req, reply) => {
    const body = tokenBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "datos_invalidos" });
    try {
      const ws = await load(body.data.token);
      const existing = await withTenant(db, req.ctx.tenantId, (tx) =>
        tx
          .select({ slot: sql<string>`${products.externalRef}->>'slot'` })
          .from(products)
          .where(sql`${products.externalRef}->>'source' = 'chateapro'`),
      );
      const known = new Set(existing.map((e) => e.slot));
      return {
        hasCommon: Boolean(ws.common),
        hasMaster: Boolean(ws.master),
        products: ws.products.map((p) => ({
          slot: p.slot,
          name: p.data.name,
          price: p.data.price,
          currency: p.data.currency,
          status: p.data.status,
          triggers: p.data.triggers?.length ?? 0,
          media: p.data.media?.length ?? 0,
          promptMode: p.prompt?.mode ?? null,
          alreadyImported: known.has(p.slot),
          warnings: p.warnings,
        })),
      };
    } catch (e) {
      const f = fail(e);
      if (f) return reply.code(f.status).send(f.body);
      throw e;
    }
  });

  app.post("/api/import/chateapro", { preHandler: admins }, async (req, reply) => {
    const body = runBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "datos_invalidos" });
    let ws: ParsedWorkspace;
    try {
      ws = await load(body.data.token);
    } catch (e) {
      const f = fail(e);
      if (f) return reply.code(f.status).send(f.body);
      throw e;
    }
    const wanted = new Set(body.data.slots);
    const { userId, tenantId } = req.ctx;

    return withTenant(db, tenantId, async (tx) => {
      const result: {
        slot: string;
        name: string;
        action: "creado" | "actualizado";
        warnings: string[];
      }[] = [];

      for (const item of ws.products.filter((p) => wanted.has(p.slot))) {
        const warnings = [...item.warnings];
        const [existing] = await tx
          .select({ id: products.id })
          .from(products)
          .where(
            sql`${products.externalRef}->>'source' = 'chateapro' and ${products.externalRef}->>'slot' = ${item.slot}`,
          );

        // Disparadores ya usados por OTRO producto del tenant: se omiten con aviso.
        const parsed = productInputSchema.parse(item.data) as ProductData;
        const free: ProductData["triggers"] = [];
        for (const t of parsed.triggers) {
          const [hit] = await tx
            .select({ productId: productTriggers.productId })
            .from(productTriggers)
            .where(
              and(
                eq(productTriggers.kind, t.kind),
                eq(productTriggers.value, t.value),
                existing ? ne(productTriggers.productId, existing.id) : sql`true`,
              ),
            );
          if (hit) warnings.push(`Disparador omitido (ya lo usa otro producto): "${t.value}"`);
          else free.push(t);
        }
        const id = (await saveProduct(
          tx,
          { ...parsed, triggers: free },
          { id: existing?.id, externalRef: { source: "chateapro", slot: item.slot } },
        )) as string;
        if (item.prompt) await publishIfChanged(tx, userId, "product", id, item.prompt);
        result.push({
          slot: item.slot,
          name: item.data.name,
          action: existing ? "actualizado" : "creado",
          warnings,
        });
      }

      const commonUpdated =
        body.data.includeCommon && ws.common
          ? await publishIfChanged(tx, userId, "common", null, {
              mode: "libre",
              content: ws.common,
              sections: {},
            })
          : false;
      const masterUpdated =
        body.data.includeMaster && ws.master
          ? await publishIfChanged(tx, userId, "master", null, {
              mode: "libre",
              content: ws.master,
              sections: {},
            })
          : false;

      await tx.insert(auditLog).values({
        actorUserId: userId,
        action: "import.chateapro",
        data: { products: result.length, commonUpdated, masterUpdated },
      });
      return { products: result, commonUpdated, masterUpdated };
    });
  });
}
