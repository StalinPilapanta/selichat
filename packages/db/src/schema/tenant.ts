import {
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantId, timestamps } from "./columns.js";

/**
 * Tablas por tenant. TODAS llevan tenant_id y tienen Row Level Security
 * (ver drizzle/0001_rls.sql). La app solo puede leer/escribir filas del tenant
 * fijado con `withTenant()`.
 */
/** País, moneda, zona horaria y horario de envío de mensajes del tenant. */
export const tenantSettings = pgTable("tenant_settings", {
  tenantId: tenantId().primaryKey(),
  country: text("country").notNull().default("EC"),
  currency: text("currency").notNull().default("USD"),
  timezone: text("timezone").notNull().default("America/Guayaquil"),
  plan: text("plan").notNull().default("trial"),
  messagingWindow: jsonb("messaging_window")
    .$type<{ start: string; end: string }>()
    .notNull()
    .default({ start: "08:00", end: "22:00" }),
  /** Branding: nombre, color (#RRGGBB) y logo de la tienda; null = el de Selichat. */
  brandName: text("brand_name"),
  brandColor: text("brand_color"),
  logoUrl: text("logo_url"),
  ...timestamps,
});

/** Proveedores de IA conectados por el tenant (API key cifrada). */
export const aiProviders = pgTable(
  "ai_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    apiKeyEnc: text("api_key_enc").notNull(),
    apiKeyHint: text("api_key_hint").notNull(),
    baseUrl: text("base_url"),
    ...timestamps,
  },
  (t) => [index("ai_providers_tenant_idx").on(t.tenantId)],
);

/** Qué proveedor y modelo usa cada agente (ventas, confirmación, etc.). */
export const agentConfigs = pgTable(
  "agent_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    agent: text("agent").notNull(),
    providerId: uuid("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
    model: text("model"),
    temperature: doublePrecision("temperature").notNull().default(0.4),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex("agent_configs_tenant_agent_uq").on(t.tenantId, t.agent)],
);

/** Integraciones externas: dropi, meta_capi, pago, tts, sms (config cifrada). */
export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    kind: text("kind").notNull(),
    configEnc: text("config_enc").notNull(),
    status: text("status").notNull().default("inactive"),
    ...timestamps,
  },
  (t) => [uniqueIndex("integrations_tenant_kind_uq").on(t.tenantId, t.kind)],
);

/** Registro de auditoría de acciones sensibles. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    target: text("target"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_tenant_created_idx").on(t.tenantId, t.createdAt)],
);
