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

export const displayName = (c: ConversationRow["contact"]) =>
  c.name || c.profileName || formatPhone(c.phone);
