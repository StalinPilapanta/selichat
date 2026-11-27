import { describe, expect, it } from "vitest";
import { BRAND_PRESETS, brandCssVars, brandingSchema, brandScale, contrast } from "./branding.js";

describe("branding", () => {
  it("escala completa a partir de un color (el color queda como 600)", () => {
    const s = brandScale("#2563EB");
    expect(s["600"]).toBe("#2563eb");
    expect(Object.keys(s).sort()).toEqual(
      ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950", "ink"].sort(),
    );
    // Más claro hacia 50 y más oscuro hacia 950.
    expect(contrast(s["50"] as string, "#ffffff")).toBeLessThan(1.2);
    expect(contrast(s["950"] as string, "#000000")).toBeLessThan(2.5);
  });

  it("texto sobre la marca: blanco en colores oscuros, oscuro en colores claros", () => {
    expect(brandScale("#059669").ink).toBe("#ffffff");
    expect(brandScale("#facc15").ink).not.toBe("#ffffff"); // amarillo → texto oscuro
    // Color inválido o vacío: el verde de Selichat.
    expect(brandScale("verde")["600"]).toBe("#568100");
    expect(brandScale(null)["600"]).toBe("#568100");
    expect(brandScale(null)["400"]).toBe("#8fc531");
  });

  it("los botones siempre se leen (texto en negrita: contraste ≥ 3)", () => {
    for (const p of BRAND_PRESETS) {
      const s = brandScale(p.color);
      expect(contrast(s["600"] as string, s.ink as string), p.name).toBeGreaterThanOrEqual(3);
    }
    // Un color claro elegido a mano también: pasa a texto oscuro.
    for (const c of ["#facc15", "#a3e635", "#67e8f9", "#ffffff"]) {
      const s = brandScale(c);
      expect(contrast(s["600"] as string, s.ink as string), c).toBeGreaterThanOrEqual(3);
    }
  });

  it("variables CSS y validación", () => {
    expect(brandCssVars("#9333ea")["--brand-600"]).toBe("#9333ea");
    expect(brandingSchema.safeParse({ name: "X", color: "#12345", logoUrl: null }).success).toBe(
      false,
    );
    const long = "Una marca larguísima de más de 30 letras";
    expect(brandingSchema.safeParse({ name: long, color: null, logoUrl: null }).success).toBe(
      false,
    );
  });
});
