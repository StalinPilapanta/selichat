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

/** +593 99 123 4567 → presentación legible (agrupa de a 3-4). */
export function formatPhone(waId: string): string {
  const d = digitsOnly(waId);
  return d ? `+${d}` : "";
}
