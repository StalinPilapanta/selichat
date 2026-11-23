import type { AdReferral, MessageMedia } from "@chatea/db/schema";

/** Mensaje entrante ya normalizado desde el payload de Meta. */
export interface InboundMessage {
  waMessageId: string;
  from: string;
  profileName: string | null;
  timestamp: Date;
  type: string;
  body: string;
  media: MessageMedia | null;
  data: Record<string, unknown> | null;
  replyToWaId: string | null;
  referral: AdReferral | null;
}

export interface StatusUpdate {
  waMessageId: string;
  status: "enviado" | "entregado" | "leido" | "fallido";
  timestamp: Date;
  error: { code?: number; title?: string; detail?: string } | null;
}

export interface TemplateStatusUpdate {
  metaId: string;
  name: string;
  language: string;
  status: string;
  reason: string | null;
}

export interface ParsedWebhook {
  phoneNumberIds: string[];
  messages: (InboundMessage & { phoneNumberId: string })[];
  statuses: (StatusUpdate & { phoneNumberId: string })[];
  templates: TemplateStatusUpdate[];
}

type J = Record<string, unknown>;
const o = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const s = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const ts = (v: unknown) => new Date(Number(s(v)) * 1000 || Date.now());

const STATUS_MAP: Record<string, StatusUpdate["status"]> = {
  sent: "enviado",
  delivered: "entregado",
  read: "leido",
  failed: "fallido",
};

function media(m: J): MessageMedia {
  return {
    waMediaId: s(m.id) || null,
    mimeType: s(m.mime_type) || null,
    caption: s(m.caption) || null,
    filename: s(m.filename) || null,
  };
}

/** Convierte un mensaje de Meta al formato interno. Tipos desconocidos quedan como "unsupported". */
export function parseMessage(m: J, profileName: string | null): InboundMessage {
  const type = s(m.type) || "unsupported";
  let body = "";
  let med: MessageMedia | null = null;
  let data: J | null = null;

  switch (type) {
    case "text":
      body = s(o(m.text).body);
      break;
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker":
      med = media(o(m[type]));
      body = med.caption ?? "";
      if (type === "audio") data = { voice: Boolean(o(m.audio).voice) };
      break;
    case "location": {
      const l = o(m.location);
      data = {
        latitude: l.latitude,
        longitude: l.longitude,
        name: s(l.name),
        address: s(l.address),
      };
      body = [s(l.name), s(l.address)].filter(Boolean).join(" — ") || "📍 Ubicación";
      break;
    }
    case "button":
      body = s(o(m.button).text);
      data = { payload: s(o(m.button).payload) };
      break;
    case "interactive": {
      const i = o(m.interactive);
      const reply = o(i.button_reply ?? i.list_reply ?? i.nfm_reply);
      body = s(reply.title) || s(reply.body);
      data = { kind: s(i.type), id: s(reply.id), description: s(reply.description) };
      break;
    }
    case "reaction":
      body = s(o(m.reaction).emoji);
      data = { messageId: s(o(m.reaction).message_id) };
      break;
    case "contacts":
      data = { contacts: arr(m.contacts) };
      body = arr(m.contacts)
        .map((c) => s(o(o(c).name).formatted_name))
        .filter(Boolean)
        .join(", ");
      break;
    case "order":
      data = { order: o(m.order) };
      body = "🛒 Pedido desde catálogo";
      break;
    default:
      data = { raw: m };
  }

  const ref = o(m.referral);
  const referral: AdReferral | null = Object.keys(ref).length
    ? {
        sourceType: s(ref.source_type) || undefined,
        sourceId: s(ref.source_id) || undefined,
        sourceUrl: s(ref.source_url) || undefined,
        headline: s(ref.headline) || undefined,
        body: s(ref.body) || undefined,
        ctwaClid: s(ref.ctwa_clid) || undefined,
      }
    : null;

  return {
    waMessageId: s(m.id),
    from: s(m.from),
    profileName,
    timestamp: ts(m.timestamp),
    type: [
      "text",
      "image",
      "video",
      "audio",
      "document",
      "sticker",
      "location",
      "button",
      "interactive",
      "reaction",
      "contacts",
      "order",
    ].includes(type)
      ? type
      : "unsupported",
    body,
    media: med,
    data,
    replyToWaId: s(o(m.context).id) || null,
    referral,
  };
}

export function parseWebhook(payload: unknown): ParsedWebhook {
  const out: ParsedWebhook = { phoneNumberIds: [], messages: [], statuses: [], templates: [] };
  for (const entry of arr(o(payload).entry)) {
    for (const change of arr(o(entry).changes)) {
      const c = o(change);
      const value = o(c.value);
      if (s(c.field) === "message_template_status_update") {
        out.templates.push({
          metaId: s(value.message_template_id),
          name: s(value.message_template_name),
          language: s(value.message_template_language),
          status: s(value.event),
          reason: s(value.reason) || null,
        });
        continue;
      }
      if (s(c.field) !== "messages") continue;
      const pnid = s(o(value.metadata).phone_number_id);
      if (!pnid) continue;
      if (!out.phoneNumberIds.includes(pnid)) out.phoneNumberIds.push(pnid);
      const names = new Map(
        arr(value.contacts).map((x) => [s(o(x).wa_id), s(o(o(x).profile).name) || null]),
      );
      for (const m of arr(value.messages)) {
        const msg = o(m);
        out.messages.push({
          ...parseMessage(msg, names.get(s(msg.from)) ?? null),
          phoneNumberId: pnid,
        });
      }
      for (const st of arr(value.statuses)) {
        const x = o(st);
        const status = STATUS_MAP[s(x.status)];
        if (!status) continue;
        const err = o(arr(x.errors)[0]);
        out.statuses.push({
          phoneNumberId: pnid,
          waMessageId: s(x.id),
          status,
          timestamp: ts(x.timestamp),
          error: Object.keys(err).length
            ? {
                code: Number(err.code) || undefined,
                title: s(err.title),
                detail: s(o(err.error_data).details) || s(err.message),
              }
            : null,
        });
      }
    }
  }
  return out;
}

/** Texto corto para la lista de conversaciones. */
export function previewOf(type: string, body: string): string {
  const icons: Record<string, string> = {
    image: "📷 Imagen",
    video: "🎥 Video",
    audio: "🎤 Audio",
    document: "📄 Documento",
    sticker: "Sticker",
    location: "📍 Ubicación",
    template: "📋 Plantilla",
    unsupported: "Mensaje no soportado",
  };
  const text = body.trim() || icons[type] || "";
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}
