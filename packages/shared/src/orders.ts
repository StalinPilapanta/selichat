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

/**
 * Avisos por WhatsApp al cliente según el estado del pedido (agente logístico).
 * Cada aviso tiene texto editable con variables y, para cuando pasaron más de 24 h desde el
 * último mensaje del cliente, una plantilla aprobada de WhatsApp.
 */
export const NOTICE_KINDS = [
  "guia",
  "transito",
  "retiro",
  "recordatorio",
  "entregado",
  "novedad",
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const NOTICE_INFO: Record<
  NoticeKind,
  { label: string; when: string; stage: OrderStage; defaultText: string }
> = {
  guia: {
    label: "Guía generada",
    when: "Cuando Dropi genera la guía",
    stage: "guia_generada",
    defaultText:
      "¡Hola {nombre}! 📦 Tu pedido de {producto} ya tiene guía: {guia} ({transportadora}).\nPuedes seguirlo aquí: {seguimiento}",
  },
  transito: {
    label: "En camino",
    when: "Cuando la transportadora lo despacha",
    stage: "en_transito",
    defaultText: "¡Hola {nombre}! 🚚 Tu pedido de {producto} ya va en camino. Guía: {guia}.",
  },
  retiro: {
    label: "Llegó a la agencia",
    when: "Cuando queda para retiro en la agencia u oficina",
    stage: "en_oficina",
    defaultText:
      "¡Hola {nombre}! 😊 Tu pedido de {producto} ya llegó a {agencia}\n📍 {direccion_agencia}\n🕒 {horario}\n\nAcércate con tu cédula y el valor a pagar: {total}. Guía: {guia}",
  },
  recordatorio: {
    label: "Recordatorio de retiro",
    when: "Si sigue en la agencia sin retirar después de los días indicados",
    stage: "en_oficina",
    defaultText:
      "¡Hola {nombre}! Te recordamos que tu pedido de {producto} sigue esperándote en {agencia}\n📍 {direccion_agencia}\n\nRetíralo pronto para que no se devuelva 🙏",
  },
  entregado: {
    label: "Entregado",
    when: "Cuando Dropi lo marca como entregado",
    stage: "entregado",
    defaultText:
      "¡Hola {nombre}! 🎉 Ya recibiste tu {producto}. ¡Gracias por tu compra en {tienda}! Si tienes dudas sobre cómo usarlo, escríbenos por aquí.",
  },
  novedad: {
    label: "Novedad",
    when: "Cuando la transportadora reporta una novedad",
    stage: "novedad",
    defaultText:
      "Hola {nombre}, la transportadora nos reporta una novedad con tu pedido de {producto} ({estado}). ¿Nos confirmas tu dirección o cuándo puedes recibirlo para reprogramar la entrega?",
  },
};

/** Variables que se pueden usar en el texto de los avisos. */
export const NOTICE_VARIABLES: { key: string; label: string }[] = [
  { key: "nombre", label: "Nombre del cliente" },
  { key: "producto", label: "Producto" },
  { key: "guia", label: "Número de guía" },
  { key: "seguimiento", label: "Enlace de seguimiento" },
  { key: "transportadora", label: "Transportadora" },
  { key: "agencia", label: "Agencia u oficina" },
  { key: "direccion_agencia", label: "Dirección de la agencia" },
  { key: "horario", label: "Horario de la agencia" },
  { key: "total", label: "Valor a pagar" },
  { key: "ciudad", label: "Ciudad" },
  { key: "estado", label: "Estado en Dropi" },
  { key: "tienda", label: "Nombre de la tienda" },
];
/**
 * Orden de las variables de una plantilla de WhatsApp: {{1}} nombre, {{2}} producto,
 * {{3}} guía, {{4}} agencia (o transportadora), {{5}} ciudad, {{6}} enlace de seguimiento.
 * Se envían tantas como pida la plantilla.
 */
export const NOTICE_TEMPLATE_PARAMS = [
  "nombre",
  "producto",
  "guia",
  "agencia",
  "ciudad",
  "seguimiento",
] as const;

/**
 * Plantillas listas para enviar a Meta, una por aviso. Usan las variables en el orden de
 * NOTICE_TEMPLATE_PARAMS y no empiezan ni terminan con variable (Meta las rechaza).
 */
export const SUGGESTED_TEMPLATES: {
  kind: NoticeKind;
  name: string;
  body: string;
  examples: string[];
}[] = [
  {
    kind: "guia",
    name: "pedido_despachado",
    body: "Hola {{1}}, tu pedido de {{2}} ya fue despachado. Guía {{3}} con {{4}} hacia {{5}}. Puedes seguirlo aquí: {{6}} ¡Gracias por tu compra!",
    examples: [
      "Ana",
      "Mega Red",
      "1800456789",
      "Servientrega",
      "Ambato",
      "https://www.servientrega.com.ec/Tracking/?guia=1800456789&tipo=GUIA",
    ],
  },
  {
    kind: "transito",
    name: "pedido_en_camino",
    body: "Hola {{1}}, tu pedido de {{2}} con guía {{3}} ya está en camino. Te avisaremos cuando llegue.",
    examples: ["Ana", "Mega Red", "1800456789"],
  },
  {
    kind: "retiro",
    name: "pedido_en_agencia",
    body: "Hola {{1}}, tu pedido de {{2}} con guía {{3}} ya llegó a {{4}}. Acércate con tu cédula y el valor a pagar para retirarlo.",
    examples: ["Ana", "Mega Red", "1800456789", "Servientrega Ambato Centro"],
  },
  {
    kind: "recordatorio",
    name: "recordatorio_retiro",
    body: "Hola {{1}}, te recordamos que tu pedido de {{2}} con guía {{3}} te espera en {{4}}. Retíralo pronto para que no sea devuelto.",
    examples: ["Ana", "Mega Red", "1800456789", "Servientrega Ambato Centro"],
  },
  {
    kind: "entregado",
    name: "pedido_entregado",
    body: "Hola {{1}}, tu pedido de {{2}} con guía {{3}} fue entregado. ¡Gracias por tu compra! Si tienes alguna duda, responde a este mensaje.",
    examples: ["Ana", "Mega Red", "1800456789"],
  },
  {
    kind: "novedad",
    name: "pedido_novedad",
    body: "Hola {{1}}, tu pedido de {{2}} con guía {{3}} tiene una novedad en la entrega. Responde a este mensaje para ayudarte a solucionarlo.",
    examples: ["Ana", "Mega Red", "1800456789"],
  },
];

export const noticeEventSchema = z.object({
  enabled: z.boolean().default(false),
  /** Texto propio (vacío = el texto sugerido). */
  text: z.string().max(1000).default(""),
  /** Plantilla aprobada para cuando la ventana de 24 h está cerrada. */
  template: z.string().trim().max(120).default(""),
});
export type NoticeEvent = z.infer<typeof noticeEventSchema>;

const OFF: NoticeEvent = { enabled: false, text: "", template: "" };

/** Convierte la configuración anterior (retiro/novedad/plantillas sueltas) a la nueva. */
function migrateNotices(v: unknown) {
  if (!v || typeof v !== "object" || "events" in v) return v;
  const o = v as Record<string, unknown>;
  const retiro = o.retiro === true;
  const tRetiro = typeof o.plantillaRetiro === "string" ? o.plantillaRetiro : "";
  const dias = Number(o.recordatorioDias ?? 2);
  return {
    // Antes 0 = «no recordar»; ahora el recordatorio tiene su propio interruptor.
    recordatorioDias: dias >= 1 ? dias : 2,
    idioma: o.idioma,
    events: {
      retiro: { enabled: retiro, text: "", template: tRetiro },
      recordatorio: {
        enabled: retiro && dias > 0,
        text: "",
        template: tRetiro,
      },
      novedad: {
        enabled: o.novedad === true,
        text: "",
        template: typeof o.plantillaNovedad === "string" ? o.plantillaNovedad : "",
      },
    },
  };
}

export const orderNoticesSchema = z.preprocess(
  migrateNotices,
  z.object({
    events: z
      .object({
        guia: noticeEventSchema.default(OFF),
        transito: noticeEventSchema.default(OFF),
        retiro: noticeEventSchema.default(OFF),
        recordatorio: noticeEventSchema.default(OFF),
        entregado: noticeEventSchema.default(OFF),
        novedad: noticeEventSchema.default(OFF),
      })
      .default({
        guia: OFF,
        transito: OFF,
        retiro: OFF,
        recordatorio: OFF,
        entregado: OFF,
        novedad: OFF,
      }),
    /** Días en la agencia sin retirar para el recordatorio. */
    recordatorioDias: z.number().int().min(1).max(15).default(2),
    idioma: z.string().trim().max(10).default("es"),
    /**
     * Enlace de seguimiento con {guia} (por defecto el de Servientrega Ecuador). Vacío = no se
     * comparte enlace.
     */
    trackingUrl: z
      .string()
      .trim()
      .max(300)
      .default("https://www.servientrega.com.ec/Tracking/?guia={guia}&tipo=GUIA"),
  }),
);
export type OrderNotices = z.infer<typeof orderNoticesSchema>;

/** Variables como {nombre} → valor; las líneas que quedan vacías se quitan. */
export function renderNotice(text: string, vars: Record<string, string>) {
  return text
    .split("\n")
    .map((line) => {
      let empty = false;
      const out = line.replace(/\{([a-z_]+)\}/g, (m, k: string) => {
        if (!(k in vars)) return m;
        const v = (vars[k] ?? "").trim();
        if (!v) empty = true;
        return v;
      });
      // Línea que solo tenía una variable sin valor (p. ej. «📍 {direccion_agencia}»).
      return empty && !/[\p{L}\p{N}]{3,}/u.test(out.replace(/^[^\p{L}\p{N}]+/u, "")) ? null : out;
    })
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const dropiOptionsSchema = z.object({
  /** Subir a Dropi apenas el cliente confirma con la IA. */
  autoUpload: z.boolean().default(true),
  rateType: z.enum(["CON RECAUDO", "SIN RECAUDO"]).default("CON RECAUDO"),
  /** Estado con el que se crea la orden en Dropi. */
  initialStatus: z.enum(["PENDIENTE CONFIRMACION", "PENDIENTE"]).default("PENDIENTE CONFIRMACION"),
  risk: riskRulesSchema.default({ enabled: false, minDeliveryRate: 50, minOrders: 2 }),
  /** No subir si ya hay en Dropi un pedido activo con ese teléfono en estos días (0 = no revisar). */
  duplicateDays: z.number().int().min(0).max(30).default(3),
  /** Cotizar el envío antes de subir (cuenta conectada por MCP); sin cobertura no se sube. */
  quoteBeforeUpload: z.boolean().default(true),
  /** Revisar stock y costo de proveedor en Dropi antes de subir (MCP). */
  checkStock: z.boolean().default(true),
  notices: orderNoticesSchema.prefault({}),
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

/**
 * Teléfono nacional como lo guarda Dropi: sin indicativo ni 0 inicial (EC: 991234567). Así
 * coinciden la huella, los duplicados y lo que envía el bot de ventas.
 */
export function nationalPhone(phone: string, country: DropiCountry): string {
  const c = DROPI_COUNTRIES[country];
  let d = phone.replace(/\D/g, "");
  if (d.startsWith(c.dial) && d.length > c.dial.length + 6) d = d.slice(c.dial.length);
  if (c.trunk && d.startsWith(c.trunk) && d.length > 8) d = d.slice(c.trunk.length);
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
