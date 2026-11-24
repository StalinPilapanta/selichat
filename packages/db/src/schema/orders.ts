import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth.js";
import { products } from "./catalog.js";
import { tenantId, timestamps } from "./columns.js";
import { contacts, conversations } from "./messaging.js";

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** Datos de entrega del comprador final (lo que se sube a Dropi). */
export interface OrderCustomer {
  nombre: string;
  apellido: string;
  telefono: string;
  provincia: string;
  ciudad: string;
  direccion: string;
  referencia?: string;
  /** Oficina donde retira (p. ej. agencia Servientrega) en vez de entrega a domicilio. */
  agencia?: string;
  email?: string;
}

export interface OrderItem {
  productId: string | null;
  name: string;
  quantity: number;
  /** Precio unitario de venta (total / cantidad). */
  unitPrice: string;
  dropiProductId: string | null;
  dropiVariationId: string | null;
  variant?: string;
}

/** Resultado de la huella del comprador al momento de subir. */
export interface OrderRisk {
  orders: number;
  delivered: number;
  returned: number;
  cancelled: number;
  deliveryRate: number | null;
  blocked: boolean;
  reason?: string;
  /** tienda = historial de la tienda (token); dropi_global = huella digital de Dropi (MCP). */
  source?: "tienda" | "dropi_global";
  buyerType?: string;
  riskLabel?: string;
  returnRate?: number | null;
}

/**
 * Pedidos de la tienda. `stage` es la etapa canónica (ver ORDER_STAGES en @chatea/shared);
 * `dropiStatus` el estado crudo que manda Dropi.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    stage: text("stage").notNull().default("pendiente_subida"),
    source: text("source").notNull().default("ia"), // ia | humano
    customer: jsonb("customer").$type<OrderCustomer>().notNull(),
    items: jsonb("items").$type<OrderItem[]>().notNull().default([]),
    total: money("total").notNull(),
    currency: text("currency").notNull(),
    rateType: text("rate_type").notNull().default("CON RECAUDO"),
    shippingCost: money("shipping_cost"),
    dropiOrderId: text("dropi_order_id"),
    dropiStatus: text("dropi_status"),
    carrier: text("carrier"),
    trackingCode: text("tracking_code"),
    uploadError: text("upload_error"),
    uploadAttempts: integer("upload_attempts").notNull().default(0),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    risk: jsonb("risk").$type<OrderRisk>(),
    notes: text("notes").notNull().default(""),
    ...timestamps,
  },
  (t) => [
    index("orders_tenant_stage_idx").on(t.tenantId, t.stage, t.createdAt),
    index("orders_tenant_dropi_idx").on(t.tenantId, t.dropiOrderId),
    // Un pedido vivo por conversación: confirmar dos veces no duplica la venta.
    uniqueIndex("orders_conversation_open_uq")
      .on(t.conversationId)
      .where(sql`${t.stage} <> 'cancelado' and ${t.conversationId} is not null`),
  ],
);

/** Historial del pedido: cambios de Dropi, de la IA y de los asesores. */
export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // dropi | ia | humano | sistema
    rawStatus: text("raw_status"),
    stage: text("stage"),
    message: text("message").notNull().default(""),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);

/**
 * Enrutamiento del webhook de Dropi: secreto de la URL → tenant.
 * Sin RLS a propósito (como channel_routes): se consulta antes de conocer el tenant.
 */
export const dropiRoutes = pgTable("dropi_routes", {
  secret: text("secret").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
});

/**
 * Provincias y ciudades de Dropi por país (las mismas para todas las tiendas): se cargan una
 * vez y la IA verifica ciudades sin consultar a Dropi en cada mensaje. Sin RLS: es catálogo
 * geográfico, no datos de una tienda.
 */
export const dropiPlaces = pgTable(
  "dropi_places",
  {
    country: text("country").notNull(),
    kind: text("kind").notNull(), // department | city
    id: integer("id").notNull(),
    name: text("name").notNull(),
    departmentId: integer("department_id"),
    code: text("code").notNull().default(""), // department_code o cod_dane
    zipCode: text("zip_code").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.country, t.kind, t.id] })],
);
