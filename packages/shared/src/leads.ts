/**
 * Embudo de leads (como Kommo): cada conversación es un lead que avanza por etapas.
 *
 * interesado → datos → ganado → en_agencia → cerrado
 *   - interesado: escribió (por anuncio, palabra clave o sin producto todavía).
 *   - datos: está dando sus datos de compra.
 *   - ganado: ya hay pedido (guía, en camino, novedades).
 *   - en_agencia: el pedido llegó a la agencia («PARA RETIRO EN AGENCIA SERVIENTREGA»).
 *   - cerrado: el pedido se entregó (se borra a las 72 h).
 *   - perdido: no respondió, canceló o se devolvió (se borra a las 48 h).
 */
export const LEAD_STAGES = {
  interesado: "Interesado",
  datos: "Datos",
  ganado: "Ganado",
  en_agencia: "En agencia",
  cerrado: "Cerrado",
  perdido: "Perdido",
} as const;
export type LeadStage = keyof typeof LEAD_STAGES;
export const LEAD_STAGE_KEYS = Object.keys(LEAD_STAGES) as LeadStage[];

/** Avance automático por la conversación (antes de la venta). */
export const LEAD_FLOW: LeadStage[] = ["interesado", "datos", "ganado"];
/** Etapas después de la venta: las mueve el estado del pedido en Dropi. */
export const LEAD_SOLD: LeadStage[] = ["ganado", "en_agencia", "cerrado"];

/** Horas en el tablero antes de borrarse (se borra la conversación; el pedido se conserva). */
export const LEAD_HIDE_HOURS: Partial<Record<LeadStage, number>> = { cerrado: 72, perdido: 48 };
/**
 * Interesado sin respuesta: pasada la ventana de 24 h y 24 h más sin escribir → perdido
 * («No responde»). Si vuelve a escribir, regresa a Interesado.
 */
export const LEAD_NO_REPLY_HOURS = 48;

export const LOST_REASONS = {
  no_responde: "No responde",
  precio: "Precio",
  sin_cobertura: "Sin cobertura de envío",
  compro_otro: "Compró en otro lado",
  no_interesa: "Ya no le interesa",
  cancelo: "Canceló el pedido",
  devuelto: "Pedido devuelto",
  otro: "Otro",
} as const;
export type LostReason = keyof typeof LOST_REASONS;
export const LOST_REASON_KEYS = Object.keys(LOST_REASONS) as LostReason[];
