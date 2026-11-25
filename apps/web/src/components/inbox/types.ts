import { formatPhone } from "@chatea/shared";
export type ConversationRow = {
  id: string;
  status: string;
  assignedUserId: string | null;
  botPaused: boolean;
  labels: string[];
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  lastInboundAt: string | null;
  productId: string | null;
  channelId: string;
  windowOpen: boolean;
  /** Datos del pedido que registró el agente IA. */
  checkoutState: Record<string, string>;
  /** Motivo por el que la IA pasó la conversación a un humano. */
  handoffReason: string | null;
  /** Etapa del lead (embudo). */
  leadStage?: string;
  contact: {
    id: string;
    phone: string;
    name: string | null;
    profileName: string | null;
    city: string | null;
    sourceAdId: string | null;
  };
};

export type ConversationDetail = ConversationRow & {
  referral: { sourceId?: string; headline?: string; body?: string; sourceUrl?: string } | null;
  ctwaClid: string | null;
  channelName: string;
  displayPhone: string;
  productName: string | null;
  /** Último turno de la IA (para ver por qué no respondió). */
  lastAgentRun?: { status: string; error: string | null; reason: string; at: string } | null;
};

export type Message = {
  id: string;
  direction: "in" | "out";
  author: "cliente" | "humano" | "ia" | "sistema";
  authorUserId: string | null;
  type: string;
  body: string;
  media: {
    waMediaId?: string | null;
    url?: string | null;
    mimeType?: string | null;
    filename?: string | null;
  } | null;
  data: Record<string, unknown> | null;
  status: string;
  error: { code?: number; title?: string; detail?: string } | null;
  sentAt: string;
};

export type TeamMember = { id: string; name: string; email: string; role: string };
export type Template = {
  id: string;
  name: string;
  language: string;
  status: string;
  components: { type: string; text?: string }[];
};

export type Note = { id: string; body: string; createdAt: string; userId: string | null };
export type QuickReply = { id: string; shortcut: string; body: string };

export const displayName = (c: ConversationRow["contact"]) =>
  c.name || c.profileName || formatPhone(c.phone);

/** Iniciales del cliente para el avatar («Ana Pérez» → «AP»; un teléfono → sus 2 últimos). */
export function initialsOf(c: ConversationRow["contact"]) {
  const n = (c.name || c.profileName || "").trim();
  if (!n) return c.phone.slice(-2);
  const w = n.split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w.length > 1 ? (w[w.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

/** Color fijo por cliente (mismo teléfono → mismo color), legible en claro y oscuro. */
const AVATAR = [
  "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100",
  "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100",
  "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100",
  "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-100",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100",
  "bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-100",
  "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100",
];
export function avatarClass(key: string) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}
