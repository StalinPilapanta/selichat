import { sql } from "drizzle-orm";
import { text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth.js";

/** tenant_id con FK a organization y default tomado de la sesión RLS (withTenant). */
export const tenantId = () =>
  text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" })
    .default(sql`current_setting('app.tenant_id', true)`);

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
