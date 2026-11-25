/**
 * Branding de la tienda: nombre, color de la marca y logo.
 * Con un solo color se calcula toda la escala (50…950) que usa la app (`brand-*`), y el color
 * del texto sobre la marca (blanco o casi negro) según el contraste WCAG.
 */
import { z } from "zod";

export const DEFAULT_BRAND_COLOR = "#059669";
export const DEFAULT_BRAND_NAME = "Selichat";

/** Colores sugeridos (todos con buen contraste para botones). */
export const BRAND_PRESETS: { name: string; color: string }[] = [
  { name: "Verde Selichat", color: "#059669" },
  { name: "Esmeralda natural", color: "#15803d" },
  { name: "Turquesa", color: "#0d9488" },
  { name: "Azul", color: "#2563eb" },
  { name: "Índigo", color: "#4f46e5" },
  { name: "Ciruela", color: "#9333ea" },
  { name: "Frambuesa", color: "#db2777" },
  { name: "Coral", color: "#e11d48" },
  { name: "Naranja", color: "#ea580c" },
  { name: "Grafito", color: "#3f3f46" },
];

const HEX = /^#[0-9a-f]{6}$/i;

export const brandingSchema = z.object({
  /** Nombre que se ve en el menú y en la pestaña (vacío = «Selichat»). */
  name: z.string().trim().max(30).nullable(),
  color: z.string().trim().regex(HEX, "Color inválido (usa #RRGGBB)").nullable(),
  /** Logo subido a la tienda (JPG, PNG o WebP). */
  logoUrl: z.string().trim().url().max(500).nullable(),
});
export type Branding = z.infer<typeof brandingSchema>;

type RGB = [number, number, number];
const toRgb = (hex: string): RGB => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c: RGB) =>
  `#${c
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Luminancia relativa (WCAG 2). */
export function luminance(hex: string) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const WHITE: RGB = [255, 255, 255];
/** Contraste mínimo para usar texto blanco sobre la marca. */
export const MIN_WHITE_CONTRAST = 3;
const INK_DARK = "#0b0f0d";
/** Cuánto se acerca al blanco (50…500) o al negro (700…950) cada tono; 600 es el color. */
const STEPS: [number, "w" | "k", number][] = [
  [50, "w", 0.93],
  [100, "w", 0.85],
  [200, "w", 0.7],
  [300, "w", 0.5],
  [400, "w", 0.3],
  [500, "w", 0.14],
  [700, "k", 0.16],
  [800, "k", 0.32],
  [900, "k", 0.48],
  [950, "k", 0.68],
];

/** Escala completa de la marca a partir del color (el color queda como tono 600). */
export function brandScale(color: string | null | undefined): Record<string, string> {
  const base = HEX.test(color ?? "") ? (color as string).toLowerCase() : DEFAULT_BRAND_COLOR;
  const rgb = toRgb(base);
  const out: Record<string, string> = { "600": base };
  for (const [step, toward, t] of STEPS)
    out[String(step)] = toHex(mix(rgb, toward === "w" ? WHITE : [0, 0, 0], t));
  // Texto sobre la marca (botones en negrita): blanco si llega a 3:1 (WCAG para texto grande o
  // en negrita); en colores claros (amarillo, verde limón…), texto casi negro.
  out.ink = contrast(base, "#ffffff") >= MIN_WHITE_CONTRAST ? "#ffffff" : INK_DARK;
  return out;
}

/** Variables CSS (`--brand-50` … `--brand-950`, `--brand-ink`) para aplicar la marca. */
export function brandCssVars(color: string | null | undefined): Record<string, string> {
  const scale = brandScale(color);
  return Object.fromEntries(Object.entries(scale).map(([k, v]) => [`--brand-${k}`, v]));
}
