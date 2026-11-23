import { z } from "zod";
import { CURRENCY_CODES } from "./currencies.js";
import { GUIDED_SECTIONS } from "./prompts.js";

const price = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Precio inválido (usa punto decimal, ej. 27.99)");
const optionalPrice = price
  .nullable()
  .optional()
  .transform((v) => v ?? null);
const url = z.string().trim().url("URL inválida");

export const PRODUCT_KINDS = ["fisico", "digital", "servicio"] as const;
export const PRODUCT_STATUSES = ["activo", "inactivo"] as const;
export const MEDIA_KINDS = ["image", "video", "audio", "document"] as const;
export const MEDIA_USAGES = ["inicial", "prueba", "cierre", "faq", "recordatorio"] as const;
export const TRIGGER_KINDS = ["keyword", "ad_id"] as const;
export const UPSELL_MOMENTS = ["durante_venta", "compra_realizada"] as const;

export const MEDIA_USAGE_LABELS: Record<(typeof MEDIA_USAGES)[number], string> = {
  inicial: "Embudo inicial",
  prueba: "Prueba social",
  cierre: "Cierre",
  faq: "Preguntas frecuentes",
  recordatorio: "Recordatorio",
};

const followUpStep = z.object({
  enabled: z.boolean(),
  delayMinutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 30),
  message: z.string().max(4000),
  template: z.object({ name: z.string(), lang: z.string() }).nullable().optional(),
});

export type FollowUpStepInput = z.input<typeof followUpStep>;

export const productInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(4000).default(""),
  kind: z.enum(PRODUCT_KINDS).default("fisico"),
  status: z.enum(PRODUCT_STATUSES).default("activo"),
  price,
  currency: z.string().toUpperCase().pipe(z.enum(CURRENCY_CODES, "Moneda no soportada")),
  variantType: z.enum(["SIMPLE", "VARIABLE"]).default("SIMPLE"),
  imageUrl: url
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  dropiProductId: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .optional()
    .transform((v) => v || null),
  initialMessage: z.string().max(4000).default(""),
  entryQuestion: z.string().max(1000).default(""),
  followUps: z
    .object({ reminders: z.array(followUpStep).max(5), remarketing: z.array(followUpStep).max(5) })
    .default({ reminders: [], remarketing: [] }),
  offers: z
    .array(
      z.object({
        quantity: z.number().int().min(1).max(1000),
        totalPrice: price,
        label: z.string().max(120).default(""),
        featured: z.boolean().default(false),
        freeShipping: z.boolean().default(false),
      }),
    )
    .max(20)
    .default([]),
  variants: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        attributes: z.record(z.string(), z.string()).default({}),
        price: optionalPrice,
        dropiVariationId: z
          .string()
          .max(40)
          .nullable()
          .optional()
          .transform((v) => v || null),
      }),
    )
    .max(100)
    .default([]),
  media: z
    .array(
      z.object({
        kind: z.enum(MEDIA_KINDS),
        url,
        usage: z.enum(MEDIA_USAGES).default("inicial"),
        caption: z.string().max(500).default(""),
      }),
    )
    .max(30)
    .default([]),
  faqs: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(500),
        answer: z.string().trim().min(1).max(2000),
      }),
    )
    .max(50)
    .default([]),
  triggers: z
    .array(z.object({ kind: z.enum(TRIGGER_KINDS), value: z.string().trim().min(1).max(300) }))
    .max(50)
    .default([]),
  upsells: z
    .array(
      z.object({
        upsellProductId: z
          .uuid()
          .nullable()
          .optional()
          .transform((v) => v ?? null),
        name: z.string().max(120).default(""),
        description: z.string().max(1000).default(""),
        price: optionalPrice,
        dropiProductId: z
          .string()
          .max(40)
          .nullable()
          .optional()
          .transform((v) => v || null),
        imageUrl: url
          .nullable()
          .optional()
          .transform((v) => v ?? null),
        moment: z.enum(UPSELL_MOMENTS).default("compra_realizada"),
        active: z.boolean().default(true),
      }),
    )
    .max(10)
    .default([]),
});
export type ProductInput = z.input<typeof productInputSchema>;
export type ProductData = z.output<typeof productInputSchema>;

const sectionsShape = Object.fromEntries(
  GUIDED_SECTIONS.map((s) => [s.key, z.string().max(20000).optional()]),
) as Record<(typeof GUIDED_SECTIONS)[number]["key"], z.ZodOptional<z.ZodString>>;

export const PROMPT_SCOPES = ["common", "master", "product"] as const;
export type PromptScope = (typeof PROMPT_SCOPES)[number];

export const promptVersionInputSchema = z
  .object({
    scope: z.enum(PROMPT_SCOPES),
    productId: z
      .uuid()
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    mode: z.enum(["libre", "guiado"]).default("libre"),
    content: z.string().max(60000).default(""),
    sections: z.object(sectionsShape).default({}),
    variables: z.record(z.string().regex(/^[a-z0-9_]+$/), z.string().max(4000)).default({}),
    note: z.string().max(200).default(""),
    publish: z.boolean().default(false),
  })
  .refine((v) => (v.scope === "product") === Boolean(v.productId), {
    message: "productId es obligatorio solo para prompts de producto",
    path: ["productId"],
  });
export type PromptVersionInputBody = z.input<typeof promptVersionInputSchema>;

/** Deduce el tipo de media por la extensión de la URL. */
export function mediaKindFromUrl(u: string): (typeof MEDIA_KINDS)[number] {
  const ext = u.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image";
  if (["mp4", "mov", "3gp", "webm"].includes(ext)) return "video";
  if (["mp3", "ogg", "opus", "m4a", "aac", "wav", "amr"].includes(ext)) return "audio";
  return "document";
}
