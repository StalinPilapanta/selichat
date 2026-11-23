import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("Falta MIGRATION_DATABASE_URL");

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
const client = postgres(url, { max: 1 });
await migrate(drizzle(client), { migrationsFolder });
await client.end();
console.log("Migraciones aplicadas");
