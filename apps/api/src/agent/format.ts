/**
 * Utilidades puras del agente: historial → mensajes del modelo y respuesta → burbujas de WhatsApp.
 */
import type { ModelMessage } from "ai";

export interface HistoryMessage {
  direction: string; // in | out
  author: string; // cliente | humano | ia | sistema
  type: string;
  body: string;
}

const TYPE_LABEL: Record<string, string> = {
  image: "imagen",
  audio: "audio",
  video: "video",
  document: "documento",
  sticker: "sticker",
  location: "ubicación",
  contacts: "contacto",
  reaction: "reacción",
};

function textOf(m: HistoryMessage): string {
  const body = m.body.trim();
  if (["text", "button", "interactive", "template"].includes(m.type)) return body;
  const label = TYPE_LABEL[m.type] ?? m.type;
  // El agente aún no ve imágenes ni oye audios (Fase 3b): se le indica qué llegó.
  return body ? `[${label}] ${body}` : `[${label} sin texto]`;
}

/**
 * Convierte el historial en turnos user/assistant, fusionando mensajes seguidos del mismo
 * lado (el cliente suele escribir en ráfagas). Lo que escribió un asesor humano se marca
 * para que el modelo mantenga la coherencia sin atribuírselo.
 */
export function toModelMessages(history: HistoryMessage[]): ModelMessage[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of history) {
    let text = textOf(m);
    if (!text) continue;
    const role = m.direction === "in" ? "user" : "assistant";
    if (role === "assistant" && m.author === "humano") text = `(asesor humano) ${text}`;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n${text}`;
    else out.push({ role, content: text });
  }
  // La conversación que ve el modelo debe empezar con el cliente.
  while (out.length && out[0]?.role === "assistant") out.shift();
  return out;
}

/**
 * Parte la respuesta en burbujas: párrafos separados por línea en blanco, como escribe
 * una persona en WhatsApp. Máximo `max` burbujas; el resto se une a la última.
 */
export function splitReply(text: string, max = 4): string[] {
  const parts = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= max) return parts;
  return [...parts.slice(0, max - 1), parts.slice(max - 1).join("\n\n")];
}

/** Normaliza para detectar respuestas repetidas (anti-bucle). */
export const sameReply = (a: string, b: string) => {
  const n = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return n(a) === n(b);
};
