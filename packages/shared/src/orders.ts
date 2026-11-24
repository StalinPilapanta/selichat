import { z } from "zod";

/** Etapas canónicas del pedido (columnas del tablero de Pedidos). */
export const ORDER_STAGES = {
  pendiente_subida: "Por subir a Dropi",
  revision: "Revisar (riesgo)",
  error_subida: "Error al subir",
  por_confirmar: "Pendiente confirmación",
  confirmado: "Confirmado",
  guia_generada: "Guía generada",
  en_transito: "En tránsito",
  en_oficina: "En oficina",
  novedad: "Novedad",
  entregado: "Entregado",
  devolucion: "Devolución",
  cancelado: "Cancelado",
} as const;
export type OrderStage = keyof typeof ORDER_STAGES;
export const ORDER_STAGE_KEYS = Object.keys(ORDER_STAGES) as OrderStage[];

/** Etapas en las que el pedido todavía no está en Dropi (se puede editar y subir). */
export const LOCAL_STAGES: OrderStage[] = ["pendiente_subida", "revision", "error_subida"];

const normStatus = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Estado crudo de Dropi (≈105 entre genéricos y de cada transportadora) → etapa canónica.
 * Por palabras clave, del más específico al más general. null = no se reconoce (se guarda
 * el estado crudo y la etapa no cambia).
 */
export function stageFromDropi(raw: string | null | undefined): OrderStage | null {
  if (!raw) return null;
  const s = normStatus(raw);
  if (!s) return null;
  if (/CANCELAD|ANULAD|RECHAZADO POR (EL )?CLIENTE/.test(s)) return "cancelado";
  if (/DEVOLUCION|DEVUELT|RETORNO|EN DEVOL|DEVOLVIENDO/.test(s)) return "devolucion";
  if (/NO ENTREGAD|NOVEDAD|SINIESTR|INCIDENCIA|RECHAZ|DIRECCION ERRADA|NO CONTESTA/.test(s))
    return "novedad";
  if (/ENTREGAD/.test(s)) return "entregado";
  if (/OFICINA|RETIRO EN|RECLAME EN|DISPONIBLE PARA RETIRO/.test(s)) return "en_oficina";
  if (/REPARTO|TRANSITO|DESPACHAD|EN CAMINO|RECOGID|EN RUTA|EN DISTRIBUCION|ADMITID|BODEGA/.test(s))
    return "en_transito";
  if (/GUIA/.test(s)) return "guia_generada";
  if (/PENDIENTE CONFIRMACION|POR CONFIRMAR|BORRADOR/.test(s)) return "por_confirmar";
  if (/PENDIENTE|CONFIRMAD|PREPARAD|EN PREPARACION|EN PROCESO/.test(s)) return "confirmado";
  return null;
}

/** Países de Dropi y la URL base de su API de integraciones. */
export const DROPI_COUNTRIES = {
  EC: { name: "Ecuador", base: "https://api.dropi.ec/integrations/", dial: "593", trunk: "0" },
  CO: { name: "Colombia", base: "https://api.dropi.co/integrations/", dial: "57", trunk: "" },
  MX: { name: "México", base: "https://api.dropi.mx/integrations/", dial: "52", trunk: "" },
  PE: { name: "Perú", base: "https://api.dropi.pe/integrations/", dial: "51", trunk: "" },
  CL: { name: "Chile", base: "https://api.dropi.cl/integrations/", dial: "56", trunk: "" },
  PA: { name: "Panamá", base: "https://api.dropi.pa/integrations/", dial: "507", trunk: "" },
  PY: { name: "Paraguay", base: "https://api.dropi.com.py/integrations/", dial: "595", trunk: "0" },
  AR: { name: "Argentina", base: "https://api.dropi.ar/integrations/", dial: "54", trunk: "0" },
  CR: { name: "Costa Rica", base: "https://api.dropi.cr/integrations/", dial: "506", trunk: "" },
  ES: { name: "España", base: "https://api.dropi.com.es/integrations/", dial: "34", trunk: "" },
} as const;
export type DropiCountry = keyof typeof DROPI_COUNTRIES;

/** Reglas antifraude antes de subir (huella del comprador con los pedidos de la tienda). */
export const riskRulesSchema = z.object({
  enabled: z.boolean().default(false),
  /** % mínimo de entregas (entregados / finalizados). */
  minDeliveryRate: z.number().int().min(0).max(100).default(50),
  /** Solo se aplica si el comprador ya tiene al menos este nº de pedidos finalizados. */
  minOrders: z.number().int().min(1).max(50).default(2),
});
export type RiskRules = z.infer<typeof riskRulesSchema>;

export const dropiOptionsSchema = z.object({
  /** Subir a Dropi apenas el cliente confirma con la IA. */
  autoUpload: z.boolean().default(true),
  rateType: z.enum(["CON RECAUDO", "SIN RECAUDO"]).default("CON RECAUDO"),
  /** Estado con el que se crea la orden en Dropi. */
  initialStatus: z.enum(["PENDIENTE CONFIRMACION", "PENDIENTE"]).default("PENDIENTE CONFIRMACION"),
  risk: riskRulesSchema.default({ enabled: false, minDeliveryRate: 50, minOrders: 2 }),
});
export type DropiOptions = z.infer<typeof dropiOptionsSchema>;

/** Cantidad a partir del texto del pedido ("2 frascos", "la promo de 3", "dos"). */
export function parseQuantity(text: string | undefined): number {
  const t = (text ?? "").toLowerCase();
  const n = t.match(/\d+/);
  if (n) return Math.max(1, Math.min(99, Number(n[0])));
  const words: Record<string, number> = {
    un: 1,
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
  };
  for (const [w, v] of Object.entries(words)) if (new RegExp(`\\b${w}\\b`).test(t)) return v;
  return 1;
}

/** "Ana María Pérez Gómez" → nombre "Ana María", apellido "Pérez Gómez". */
export function splitName(full: string): { nombre: string; apellido: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { nombre: parts[0] ?? "", apellido: "" };
  if (parts.length === 2) return { nombre: parts[0] ?? "", apellido: parts[1] ?? "" };
  const half = Math.floor(parts.length / 2);
  return { nombre: parts.slice(0, half).join(" "), apellido: parts.slice(half).join(" ") };
}

/** Teléfono en formato nacional, como lo espera Dropi (EC: 0991234567). */
export function nationalPhone(phone: string, country: DropiCountry): string {
  const c = DROPI_COUNTRIES[country];
  let d = phone.replace(/\D/g, "");
  if (d.startsWith(c.dial) && d.length > c.dial.length + 6) d = d.slice(c.dial.length);
  if (c.trunk && !d.startsWith(c.trunk) && d.length <= 9) d = c.trunk + d;
  return d;
}

/** Texto sin tildes ni mayúsculas para comparar nombres de ciudades y provincias. */
export function normPlace(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(provincia|departamento|ciudad|canton|cantón)\s+(de(l)?\s+)?/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
