export * from "./auth.js";
export * from "./catalog.js";
export * from "./messaging.js";
export * from "./tenant.js";

/**
 * Tablas con RLS por tenant. Al agregar una, súmala aquí y crea su política
 * en una migración (ver drizzle/0001_rls.sql). rls.test.ts verifica la lista.
 */
export const TENANT_TABLES = [
  "tenant_settings",
  "ai_providers",
  "agent_configs",
  "integrations",
  "audit_log",
  "products",
  "product_variants",
  "product_offers",
  "product_media",
  "product_faqs",
  "product_triggers",
  "product_upsells",
  "prompts",
  "channels",
  "contacts",
  "conversations",
  "messages",
  "conversation_notes",
  "message_templates",
] as const;
