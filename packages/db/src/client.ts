import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDb>["db"];
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 10 });
  const db = drizzle(client, { schema });
  return { db, client };
}

/**
 * Ejecuta `fn` dentro de una transacción con `app.tenant_id` fijado.
 * Las políticas RLS solo dejan ver/escribir filas de ese tenant.
 * Toda consulta a tablas de tenant DEBE pasar por aquí.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!tenantId) throw new Error("withTenant: tenantId vacío");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
