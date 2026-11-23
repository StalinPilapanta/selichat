import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withTenant } from "./client.js";
import { aiProviders, organization, TENANT_TABLES, tenantSettings } from "./schema/index.js";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL;

describe.skipIf(!appUrl || !adminUrl)("Row Level Security", () => {
  const admin = createDb(adminUrl ?? "", { max: 1 });
  const app = createDb(appUrl ?? "", { max: 2 });
  const a = `t_${randomUUID()}`;
  const b = `t_${randomUUID()}`;

  beforeAll(async () => {
    await admin.db.insert(organization).values([
      { id: a, name: "Tenant A", slug: a },
      { id: b, name: "Tenant B", slug: b },
    ]);
    for (const id of [a, b]) {
      await withTenant(app.db, id, async (tx) => {
        await tx.insert(tenantSettings).values({});
        await tx
          .insert(aiProviders)
          .values({ kind: "openai", name: `prov-${id}`, apiKeyEnc: "x", apiKeyHint: "••••" });
      });
    }
  });

  afterAll(async () => {
    await admin.db.delete(organization).where(eq(organization.id, a));
    await admin.db.delete(organization).where(eq(organization.id, b));
    await admin.client.end();
    await app.client.end();
  });

  it("cada tenant solo ve sus filas", async () => {
    const rows = await withTenant(app.db, a, (tx) => tx.select().from(aiProviders));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(a);
  });

  it("sin tenant fijado no se ve nada", async () => {
    const rows = await app.db.select().from(aiProviders);
    expect(rows.filter((r) => r.tenantId === a || r.tenantId === b)).toHaveLength(0);
  });

  it("no se puede escribir en otro tenant", async () => {
    await expect(
      withTenant(app.db, a, (tx) =>
        tx.insert(aiProviders).values({
          tenantId: b,
          kind: "openai",
          name: "intruso",
          apiKeyEnc: "x",
          apiKeyHint: "••••",
        }),
      ),
    ).rejects.toThrow();
  });

  it("no se puede modificar filas de otro tenant", async () => {
    await withTenant(app.db, a, (tx) =>
      tx.update(aiProviders).set({ name: "hackeado" }).where(eq(aiProviders.tenantId, b)),
    );
    const rows = await withTenant(app.db, b, (tx) => tx.select().from(aiProviders));
    expect(rows[0]?.name).toBe(`prov-${b}`);
  });

  it("todas las tablas de tenant tienen RLS forzado", async () => {
    const res = await admin.db.execute<{ relname: string; forced: boolean; enabled: boolean }>(
      sql`select relname, relrowsecurity as enabled, relforcerowsecurity as forced
          from pg_class where relname in ${TENANT_TABLES}`,
    );
    expect(res).toHaveLength(TENANT_TABLES.length);
    for (const r of res) expect(r.enabled && r.forced, r.relname).toBe(true);
  });
});
