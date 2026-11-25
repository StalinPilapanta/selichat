import { schema, type Tx } from "@chatea/db";
import { decryptSecret, normalizeRecipient } from "@chatea/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { InboxEvent } from "../realtime.js";
import { reopenOnInbound } from "../services/leads.js";
import { Graph, type OutgoingPayload } from "./graph.js";
import { type InboundMessage, type ParsedWebhook, previewOf, type StatusUpdate } from "./parse.js";

const { channels, contacts, conversations, messages, messageTemplates, products, productTriggers } =
  schema;

export interface WaConfig {
  encryptionKey: string;
  graphVersion: string;
  fetchImpl?: typeof fetch;
}

export type Channel = typeof channels.$inferSelect;

export function graphFor(ch: Channel, cfg: WaConfig) {
  return new Graph({
    accessToken: decryptSecret(ch.accessTokenEnc, cfg.encryptionKey),
    version: cfg.graphVersion,
    fetchImpl: cfg.fetchImpl,
  });
}

/** Un estado nunca retrocede (leído no vuelve a entregado); fallido siempre gana. */
const RANK: Record<string, number> = {
  pendiente: 0,
  enviado: 1,
  entregado: 2,
  leido: 3,
  fallido: 4,
  recibido: 0,
};

const norm = (t: string) => t.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Producto activo cuyo disparador coincide con el anuncio o con el texto del primer mensaje. */
export async function matchProduct(tx: Tx, msg: InboundMessage): Promise<string | null> {
  if (msg.referral?.sourceId) {
    const [hit] = await tx
      .select({ id: products.id })
      .from(productTriggers)
      .innerJoin(products, eq(products.id, productTriggers.productId))
      .where(
        and(
          eq(productTriggers.kind, "ad_id"),
          eq(productTriggers.value, msg.referral.sourceId),
          eq(products.status, "activo"),
        ),
      );
    if (hit) return hit.id;
  }
  const text = norm(msg.body);
  if (!text) return null;
  const keywords = await tx
    .select({ id: products.id, value: productTriggers.value })
    .from(productTriggers)
    .innerJoin(products, eq(products.id, productTriggers.productId))
    .where(and(eq(productTriggers.kind, "keyword"), eq(products.status, "activo")));
  // La coincidencia más larga gana ("me interesa el Mega Red" antes que "Mega Red").
  const found = keywords
    .map((k) => ({ ...k, v: norm(k.value) }))
    .filter((k) => k.v && (text === k.v || text.includes(k.v)))
    .sort((a, b) => b.v.length - a.v.length)[0];
  return found?.id ?? null;
}

/** Guarda mensajes y estados de un webhook ya verificado (dentro de withTenant). */
export async function ingestWebhook(
  tx: Tx,
  ch: Channel,
  parsed: ParsedWebhook,
): Promise<InboxEvent[]> {
  const events: InboxEvent[] = [];

  for (const m of parsed.messages.filter((x) => x.phoneNumberId === ch.phoneNumberId)) {
    if (!m.waMessageId || !m.from) continue;
    const [contact] = await tx
      .insert(contacts)
      .values({
        phone: m.from,
        profileName: m.profileName,
        lastSeenAt: m.timestamp,
        sourceAdId: m.referral?.sourceId ?? null,
        ctwaClid: m.referral?.ctwaClid ?? null,
        referral: m.referral,
      })
      .onConflictDoUpdate({
        target: [contacts.tenantId, contacts.phone],
        set: {
          profileName: sql`coalesce(excluded.profile_name, ${contacts.profileName})`,
          lastSeenAt: m.timestamp,
          // El anuncio de origen se guarda solo la primera vez.
          sourceAdId: sql`coalesce(${contacts.sourceAdId}, excluded.source_ad_id)`,
          ctwaClid: sql`coalesce(${contacts.ctwaClid}, excluded.ctwa_clid)`,
          referral: sql`coalesce(${contacts.referral}, excluded.referral)`,
        },
      })
      .returning({ id: contacts.id });
    if (!contact) continue;

    const [conv] = await tx
      .insert(conversations)
      .values({ contactId: contact.id, channelId: ch.id })
      .onConflictDoUpdate({
        target: [conversations.tenantId, conversations.contactId, conversations.channelId],
        set: { updatedAt: new Date() },
      })
      .returning({ id: conversations.id, productId: conversations.productId });
    if (!conv) continue;

    const [inserted] = await tx
      .insert(messages)
      .values({
        conversationId: conv.id,
        direction: "in",
        author: "cliente",
        type: m.type,
        body: m.body,
        media: m.media,
        data: m.referral ? { ...(m.data ?? {}), referral: m.referral } : m.data,
        replyToWaId: m.replyToWaId,
        waMessageId: m.waMessageId,
        status: "recibido",
        sentAt: m.timestamp,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    if (!inserted) continue; // reintento de Meta: ya estaba guardado

    const productId = conv.productId ?? (await matchProduct(tx, m));
    await tx
      .update(conversations)
      .set({
        status: "abierta",
        lastMessageAt: m.timestamp,
        lastInboundAt: m.timestamp,
        lastMessagePreview: previewOf(m.type, m.body),
        unreadCount: sql`${conversations.unreadCount} + 1`,
        // El cliente respondió: los recordatorios vuelven a empezar.
        followUpsSent: 0,
        productId,
      })
      .where(eq(conversations.id, conv.id));
    // Volvió a escribir: si se había perdido por no responder (o ya salió del tablero), se reabre.
    await reopenOnInbound(tx, conv.id);
    events.push({ type: "message", conversationId: conv.id, messageId: inserted.id });
  }

  for (const st of parsed.statuses.filter((x) => x.phoneNumberId === ch.phoneNumberId)) {
    const rows = await applyStatus(tx, st);
    for (const r of rows)
      events.push({
        type: "status",
        conversationId: r.conversationId,
        messageId: r.id,
        status: st.status,
      });
  }

  for (const t of parsed.templates) {
    await tx
      .update(messageTemplates)
      .set({ status: t.status, rejectedReason: t.reason })
      .where(and(eq(messageTemplates.channelId, ch.id), eq(messageTemplates.metaId, t.metaId)));
  }

  await tx
    .update(channels)
    .set({ lastEventAt: new Date(), status: "activo", lastError: null })
    .where(eq(channels.id, ch.id));
  return events;
}

async function applyStatus(tx: Tx, st: StatusUpdate) {
  const lower = Object.entries(RANK)
    .filter(([, r]) => r < (RANK[st.status] ?? 0))
    .map(([k]) => k);
  if (!lower.length) return [];
  return tx
    .update(messages)
    .set({ status: st.status, error: st.error })
    .where(and(eq(messages.waMessageId, st.waMessageId), inArray(messages.status, lower)))
    .returning({ id: messages.id, conversationId: messages.conversationId });
}

export type SendInput =
  | { kind: "text"; body: string }
  | {
      kind: "media";
      mediaType: "image" | "video" | "audio" | "document";
      url: string;
      caption?: string;
      filename?: string;
    }
  | { kind: "template"; name: string; language: string; params: string[]; preview: string };

export function toPayload(i: SendInput): OutgoingPayload {
  if (i.kind === "text") return { type: "text", text: { body: i.body, preview_url: true } };
  if (i.kind === "media") {
    const media: Record<string, string> = { link: i.url };
    if (i.caption && i.mediaType !== "audio") media.caption = i.caption;
    if (i.filename && i.mediaType === "document") media.filename = i.filename;
    return { type: i.mediaType, [i.mediaType]: media };
  }
  return {
    type: "template",
    template: {
      name: i.name,
      language: { code: i.language },
      components: i.params.length
        ? [{ type: "body", parameters: i.params.map((text) => ({ type: "text", text })) }]
        : [],
    },
  };
}

/**
 * Registra el mensaje saliente y lo envía a Meta. Si Meta falla, queda como "fallido"
 * con el error, para que la bandeja lo muestre y se pueda reintentar.
 */
/**
 * «Escribiendo…» en el chat del cliente sobre su último mensaje. Nunca falla: si Meta no lo
 * acepta, la respuesta sale igual.
 */
export async function showTyping(tx: Tx, cfg: WaConfig, conversationId: string) {
  const [row] = await tx
    .select({ waId: messages.waMessageId, channel: channels })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "in")))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (!row?.waId) return false;
  try {
    await graphFor(row.channel, cfg).typing(row.channel.phoneNumberId, row.waId);
    return true;
  } catch {
    return false;
  }
}

export async function sendToConversation(
  tx: Tx,
  cfg: WaConfig,
  conversationId: string,
  input: SendInput,
  author: { kind: "humano" | "ia" | "sistema"; userId?: string | null },
) {
  const [row] = await tx
    .select({ conv: conversations, phone: contacts.phone, channel: channels })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(eq(conversations.id, conversationId));
  if (!row) return null;

  const type =
    input.kind === "text" ? "text" : input.kind === "media" ? input.mediaType : "template";
  const body =
    input.kind === "text"
      ? input.body
      : input.kind === "media"
        ? (input.caption ?? "")
        : input.preview;
  const media =
    input.kind === "media"
      ? { url: input.url, caption: input.caption ?? null, filename: input.filename ?? null }
      : null;
  const data =
    input.kind === "template"
      ? { template: { name: input.name, language: input.language, params: input.params } }
      : null;

  const [msg] = await tx
    .insert(messages)
    .values({
      conversationId,
      direction: "out",
      author: author.kind,
      authorUserId: author.userId ?? null,
      type,
      body,
      media,
      data,
    })
    .returning();
  if (!msg) return null;

  let waMessageId: string | null = null;
  let error: { code?: number; title?: string; detail?: string } | null = null;
  try {
    waMessageId = await graphFor(row.channel, cfg).send(
      row.channel.phoneNumberId,
      normalizeRecipient(row.phone),
      toPayload(input),
    );
  } catch (e) {
    const g = e as {
      code?: number;
      message?: string;
      windowClosed?: boolean;
      tokenInvalid?: boolean;
    };
    error = {
      code: g.code,
      title: g.windowClosed
        ? "Ventana de 24 h cerrada"
        : g.tokenInvalid
          ? "Token de WhatsApp inválido"
          : "Meta rechazó el mensaje",
      detail: g.message,
    };
    if (g.tokenInvalid)
      await tx
        .update(channels)
        .set({ status: "error", lastError: "Token inválido o vencido" })
        .where(eq(channels.id, row.channel.id));
  }

  const now = new Date();
  const [saved] = await tx
    .update(messages)
    .set({ waMessageId, status: error ? "fallido" : "enviado", error, sentAt: now })
    .where(eq(messages.id, msg.id))
    .returning();
  await tx
    .update(conversations)
    .set({ lastMessageAt: now, lastMessagePreview: previewOf(type, body), status: "abierta" })
    .where(eq(conversations.id, conversationId));
  return saved ?? null;
}
