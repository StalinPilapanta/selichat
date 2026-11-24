import { z } from "zod";

/**
 * Datos del pedido que el agente de ventas va completando en la conversación.
 * Se guardan en conversations.checkout_state y se muestran al asesor en la bandeja.
 */
export const CHECKOUT_FIELDS = {
  nombre: "Nombre completo",
  telefono: "Teléfono de contacto",
  provincia: "Provincia / departamento",
  ciudad: "Ciudad",
  direccion: "Dirección de entrega",
  referencia: "Referencia de la dirección",
  agencia: "Retiro en agencia",
  cantidad: "Cantidad / oferta elegida",
  variante: "Variante",
  notas: "Notas del pedido",
} as const;
export type CheckoutField = keyof typeof CHECKOUT_FIELDS;

export const CHECKOUT_STAGES = ["descubrimiento", "datos", "confirmado", "cancelado"] as const;
export type CheckoutStage = (typeof CHECKOUT_STAGES)[number];

export const checkoutUpdateSchema = z.object({
  nombre: z.string().max(120).optional(),
  telefono: z.string().max(30).optional(),
  provincia: z.string().max(80).optional(),
  ciudad: z.string().max(80).optional(),
  direccion: z.string().max(300).optional(),
  referencia: z.string().max(300).optional(),
  /** Oficina de la transportadora donde retira el cliente (en vez de entrega a domicilio). */
  agencia: z.string().max(300).optional(),
  cantidad: z.string().max(120).optional(),
  variante: z.string().max(120).optional(),
  notas: z.string().max(500).optional(),
  etapa: z.enum(CHECKOUT_STAGES).optional(),
});
export type CheckoutState = z.infer<typeof checkoutUpdateSchema>;

/** Campos obligatorios para dar el pedido por confirmado. */
export const CHECKOUT_REQUIRED: CheckoutField[] = ["nombre", "ciudad", "direccion", "cantidad"];

export function missingCheckoutFields(s: CheckoutState): CheckoutField[] {
  // Si retira en agencia, la agencia reemplaza a la dirección de entrega.
  return CHECKOUT_REQUIRED.filter(
    (k) => !s[k]?.trim() && !(k === "direccion" && s.agencia?.trim()),
  );
}

/** Resumen legible para el prompt del agente. */
export function describeCheckout(s: CheckoutState): string {
  const lines = (Object.keys(CHECKOUT_FIELDS) as CheckoutField[])
    .filter((k) => s[k]?.trim())
    .map((k) => `- ${CHECKOUT_FIELDS[k]}: ${s[k]}`);
  const missing = missingCheckoutFields(s).map((k) => CHECKOUT_FIELDS[k]);
  return [
    `Etapa: ${s.etapa ?? "descubrimiento"}`,
    lines.length
      ? `Datos ya registrados (NO los vuelvas a pedir):\n${lines.join("\n")}`
      : "Aún no hay datos registrados.",
    missing.length
      ? `Faltan para confirmar: ${missing.join(", ")}`
      : "Ya están todos los datos obligatorios.",
  ].join("\n");
}
