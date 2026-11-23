import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.js";
import { products } from "./catalog.js";
import { tenantId, timestamps } from "./columns.js";

/** Número de WhatsApp Business conectado por la tienda (Cloud API de Meta). */
export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    kind: text("kind").notNull().default("whatsapp"),
    name: text("name").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    wabaId: text("waba_id").notNull(),
    displayPhone: text("display_phone").notNull().default(""),
    verifiedName: text("verified_name").notNull().default(""),
    accessTokenEnc: text("access_token_enc").notNull(),
    appSecretEnc: text("app_secret_enc").notNull(),
    /** Token que se pega en Meta para verificar el webhook (no es secreto crítico). */
    verifyToken: text("verify_token").notNull(),
    status: text("status").notNull().default("pendiente"), // pendiente | activo | error
    lastError: text("last_error"),
    webhookVerifiedAt: timestamp("webhook_verified_at", { withTimezone: true }),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("channels_tenant_idx").on(t.tenantId)],
);

/**
 * Enrutamiento del webhook SIN RLS: el webhook llega sin sesión y necesita saber
 * a qué tenant pertenece el canal antes de poder leer nada. Solo ids, nada secreto.
 */
export const channelRoutes = pgTable("channel_routes", {
  channelId: uuid("channel_id")
    .primaryKey()
    .references(() => channels.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  phoneNumberId: text("phone_number_id").notNull().unique(),
});

export interface AdReferral {
  sourceType?: string;
  sourceId?: string;
  sourceUrl?: string;
  headline?: string;
  body?: string;
  ctwaClid?: string;
}

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** Teléfono internacional solo dígitos (ej. 593991234567) = wa_id de WhatsApp. */
    phone: text("phone").notNull(),
    name: text("name"),
    profileName: text("profile_name"),
    city: text("city"),
    /** Primer anuncio por el que llegó (Click-to-WhatsApp). */
    sourceAdId: text("source_ad_id"),
    ctwaClid: text("ctwa_clid"),
    referral: jsonb("referral").$type<AdReferral>(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("contacts_tenant_phone_uq").on(t.tenantId, t.phone)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("abierta"), // abierta | cerrada
    assignedUserId: text("assigned_user_id").references(() => user.id, { onDelete: "set null" }),
    botPaused: boolean("bot_paused").notNull().default(false),
    /** Producto activado por disparador (anuncio o palabra clave); lo usa el agente en la Fase 3. */
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    labels: text("labels").array().notNull().default([]),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessagePreview: text("last_message_preview").notNull().default(""),
    /** Último mensaje del cliente: abre la ventana de 24 h para mensajes libres. */
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("conversations_contact_channel_uq").on(t.tenantId, t.contactId, t.channelId),
    index("conversations_tenant_last_idx").on(t.tenantId, t.lastMessageAt),
  ],
);

export interface MessageMedia {
  /** id de media en Meta (entrante) o null si se envió por URL. */
  waMediaId?: string | null;
  url?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  caption?: string | null;
}

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(), // in | out
    author: text("author").notNull(), // cliente | humano | ia | sistema
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    type: text("type").notNull(), // text | image | audio | video | document | sticker | location | template | interactive | button | reaction | contacts | unsupported
    body: text("body").notNull().default(""),
    media: jsonb("media").$type<MessageMedia>(),
    /** Datos extra según el tipo (ubicación, botón pulsado, plantilla enviada…). */
    data: jsonb("data").$type<Record<string, unknown>>(),
    replyToWaId: text("reply_to_wa_id"),
    waMessageId: text("wa_message_id"),
    status: text("status").notNull().default("pendiente"), // pendiente | enviado | entregado | leido | fallido | recibido
    error: jsonb("error").$type<{ code?: number; title?: string; detail?: string }>(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Meta reintenta webhooks: el id de WhatsApp deduplica.
    uniqueIndex("messages_tenant_wa_id_uq").on(t.tenantId, t.waMessageId),
    index("messages_conversation_idx").on(t.conversationId, t.sentAt),
  ],
);

export const conversationNotes = pgTable(
  "conversation_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversation_notes_conv_idx").on(t.conversationId)],
);

/** Plantillas HSM de WhatsApp, sincronizadas con Meta. */
export const messageTemplates = pgTable(
  "message_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    metaId: text("meta_id"),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category").notNull(), // MARKETING | UTILITY | AUTHENTICATION
    status: text("status").notNull(), // APPROVED | PENDING | REJECTED | PAUSED | DISABLED
    rejectedReason: text("rejected_reason"),
    components: jsonb("components").$type<Record<string, unknown>[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("message_templates_channel_name_lang_uq").on(t.channelId, t.name, t.language),
  ],
);
