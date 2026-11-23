import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantId, timestamps } from "./columns.js";

/** Precio en la moneda del tenant; numeric para no perder centavos. */
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** Seguimiento automático por producto (recordatorios y remarketing). Se ejecuta en la Fase 7. */
export interface FollowUpStep {
  enabled: boolean;
  /** Minutos desde el último mensaje del cliente. */
  delayMinutes: number;
  /** Mensaje fijo (puede incluir URLs de media) o instrucción para la IA. */
  message: string;
  /** Plantilla HSM de WhatsApp para cuando la ventana de 24 h está cerrada. */
  template?: { name: string; lang: string } | null;
}
export interface ProductFollowUps {
  reminders: FollowUpStep[];
  remarketing: FollowUpStep[];
}

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind").notNull().default("fisico"), // fisico | digital | servicio
    status: text("status").notNull().default("activo"), // activo | inactivo
    price: money("price").notNull(),
    currency: text("currency").notNull(),
    variantType: text("variant_type").notNull().default("SIMPLE"), // SIMPLE | VARIABLE
    imageUrl: text("image_url"),
    dropiProductId: text("dropi_product_id"),
    /** Embudo inicial: lo primero que recibe el cliente al llegar por anuncio/palabra clave. */
    initialMessage: text("initial_message").notNull().default(""),
    entryQuestion: text("entry_question").notNull().default(""),
    followUps: jsonb("follow_ups")
      .$type<ProductFollowUps>()
      .notNull()
      .default({ reminders: [], remarketing: [] }),
    /** Origen de importación (p. ej. {source:"chateapro", slot:"[Producto Ventas Wp] 1"}). */
    externalRef: jsonb("external_ref").$type<Record<string, string>>(),
    ...timestamps,
  },
  (t) => [index("products_tenant_status_idx").on(t.tenantId, t.status)],
);

const productId = () =>
  uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" });

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    productId: productId(),
    name: text("name").notNull(),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    price: money("price"),
    dropiVariationId: text("dropi_variation_id"),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_variants_product_idx").on(t.productId)],
);

/** Ofertas por cantidad: "2 frascos $37.99 + regalo". */
export const productOffers = pgTable(
  "product_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    productId: productId(),
    quantity: integer("quantity").notNull(),
    totalPrice: money("total_price").notNull(),
    label: text("label").notNull().default(""),
    featured: boolean("featured").notNull().default(false),
    freeShipping: boolean("free_shipping").notNull().default(false),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_offers_product_idx").on(t.productId)],
);

export const productMedia = pgTable(
  "product_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    productId: productId(),
    kind: text("kind").notNull(), // image | video | audio | document
    url: text("url").notNull(),
    /** Para qué se usa: inicial (embudo), prueba (fotos de clientes), cierre, faq, recordatorio. */
    usage: text("usage").notNull().default("inicial"),
    caption: text("caption").notNull().default(""),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_media_product_idx").on(t.productId)],
);

export const productFaqs = pgTable(
  "product_faqs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    productId: productId(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_faqs_product_idx").on(t.productId)],
);

/** Qué activa el producto en una conversación nueva: palabra clave o ID de anuncio de Meta. */
export const productTriggers = pgTable(
  "product_triggers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    productId: productId(),
    kind: text("kind").notNull(), // keyword | ad_id
    value: text("value").notNull(),
  },
  // Un mismo disparador no puede apuntar a dos productos del tenant.
  (t) => [uniqueIndex("product_triggers_tenant_kind_value_uq").on(t.tenantId, t.kind, t.value)],
);

export const productUpsells = pgTable(
  "product_upsells",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    productId: productId(),
    /** Producto del catálogo que se ofrece; si es null se usan name/price/dropiProductId. */
    upsellProductId: uuid("upsell_product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull().default(""),
    description: text("description").notNull().default(""),
    price: money("price"),
    dropiProductId: text("dropi_product_id"),
    imageUrl: text("image_url"),
    moment: text("moment").notNull().default("compra_realizada"), // durante_venta | compra_realizada
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_upsells_product_idx").on(t.productId)],
);

/**
 * Prompts versionados por capas:
 * - common: reglas de comportamiento que aplican siempre (estilo WhatsApp, URLs, división de mensajes).
 * - master: plantilla maestra con {{variables}}; se usa cuando el producto está en modo guiado.
 * - product: prompt del producto (libre = texto completo; guiado = secciones + variables).
 * Cada guardado crea una versión nueva; "publicar" la vuelve la activa.
 * Rollback = publicar una versión anterior.
 */
export interface GuidedSections {
  contextualizacion: string;
  ficha_tecnica: string;
  guion_conversacional: string;
  posibles_situaciones: string;
  reglas: string;
}

export const prompts = pgTable(
  "prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    scope: text("scope").notNull(), // common | master | product
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    mode: text("mode").notNull().default("libre"), // libre | guiado
    content: text("content").notNull().default(""),
    sections: jsonb("sections").$type<Partial<GuidedSections>>().notNull().default({}),
    /** Valores de variables propias ({{nombre_asesor}}, {{publico_objetivo}}…) para esta versión. */
    variables: jsonb("variables").$type<Record<string, string>>().notNull().default({}),
    note: text("note").notNull().default(""),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("prompts_scope_version_uq")
      .on(t.tenantId, t.scope, t.productId, t.version)
      .nullsNotDistinct(),
    index("prompts_lookup_idx").on(t.tenantId, t.scope, t.productId),
  ],
);
