/** Utilidades de WhatsApp compartidas por API y web. */

/** Ventana de servicio: se pueden enviar mensajes libres hasta 24 h después del último mensaje del cliente. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function windowOpen(
  lastInboundAt: Date | string | null | undefined,
  now = Date.now(),
): boolean {
  if (!lastInboundAt) return false;
  return now - new Date(lastInboundAt).getTime() < SERVICE_WINDOW_MS;
}

/** Milisegundos que le quedan a la ventana (0 si está cerrada). */
export function windowRemainingMs(
  lastInboundAt: Date | string | null | undefined,
  now = Date.now(),
): number {
  if (!lastInboundAt) return 0;
  return Math.max(0, SERVICE_WINDOW_MS - (now - new Date(lastInboundAt).getTime()));
}

/** Deja solo dígitos (formato wa_id: código de país + número). */
export function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Meta entrega algunos wa_id con un dígito extra que no acepta al responder:
 * Argentina 549XXXXXXXXXX → 54XXXXXXXXXX, México 521XXXXXXXXXX → 52XXXXXXXXXX.
 */
export function normalizeRecipient(waId: string): string {
  const d = digitsOnly(waId);
  if (d.startsWith("549") && d.length === 13) return `54${d.slice(3)}`;
  if (d.startsWith("521") && d.length === 13) return `52${d.slice(3)}`;
  return d;
}

/** Prefijos internacionales de 1 y 2 dígitos; el resto (p. ej. 593, 507) son de 3. */
const ONE_DIGIT = new Set(["1", "7"]);
const TWO_DIGIT = new Set([
  "20",
  "27",
  "30",
  "31",
  "32",
  "33",
  "34",
  "36",
  "39",
  "40",
  "41",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "52",
  "53",
  "54",
  "55",
  "56",
  "57",
  "58",
  "60",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "81",
  "82",
  "84",
  "86",
  "90",
  "91",
  "92",
  "93",
  "94",
  "95",
  "98",
]);

/** wa_id → código de país y número nacional: 593991234567 → {code:"593", number:"991234567"}. */
export function splitPhone(waId: string): { code: string; number: string } {
  const d = digitsOnly(waId);
  if (!d) return { code: "", number: "" };
  const len = ONE_DIGIT.has(d.slice(0, 1)) ? 1 : TWO_DIGIT.has(d.slice(0, 2)) ? 2 : 3;
  if (d.length <= len + 4) return { code: "", number: d };
  return { code: d.slice(0, len), number: d.slice(len) };
}

/** +593 991234567: código de país separado del número. */
export function formatPhone(waId: string): string {
  const { code, number } = splitPhone(waId);
  if (!number) return "";
  return code ? `+${code} ${number}` : `+${number}`;
}

/**
 * Teléfono escrito por el cliente o guardado en un pedido («0991234567», «991234567»,
 * «593991234567») con el código de país separado: «+593 991234567». El código se toma del
 * WhatsApp del contacto (`refPhone`) cuando el número viene sin él.
 */
export function displayPhone(value: string | null | undefined, refPhone?: string | null): string {
  const raw = (value ?? "").trim();
  const d = raw.replace(/\D/g, "");
  if (!d) return raw;
  const dial = refPhone ? splitPhone(refPhone.replace(/\D/g, "")).code : "";
  if (dial && d.startsWith(dial) && d.length > dial.length + 6) return formatPhone(d);
  if (dial && d.length <= 10) return `+${dial} ${d.replace(/^0+/, "")}`;
  if (raw.startsWith("+") || d.length >= 11) return formatPhone(d);
  return raw;
}
