import { describe, expect, it } from "vitest";
import {
  dropiOptionsSchema,
  NOTICE_INFO,
  NOTICE_KINDS,
  renderNotice,
  SUGGESTED_TEMPLATES,
} from "./orders.js";

describe("avisos logísticos", () => {
  it("convierte la configuración anterior (retiro/novedad/plantillas sueltas)", () => {
    const o = dropiOptionsSchema.parse({
      notices: {
        retiro: true,
        recordatorioDias: 3,
        novedad: true,
        plantillaRetiro: "retiro_v2",
        plantillaNovedad: "novedad_v1",
        idioma: "es",
      },
    });
    expect(o.notices.recordatorioDias).toBe(3);
    expect(o.notices.events.retiro).toEqual({ enabled: true, text: "", template: "retiro_v2" });
    expect(o.notices.events.recordatorio).toMatchObject({ enabled: true, template: "retiro_v2" });
    expect(o.notices.events.novedad).toMatchObject({ enabled: true, template: "novedad_v1" });
    expect(o.notices.events.guia.enabled).toBe(false);
    // Sin recordatorio (0 días) en la configuración anterior: queda apagado.
    const sinRecordar = dropiOptionsSchema.parse({
      notices: { retiro: true, recordatorioDias: 0 },
    });
    expect(sinRecordar.notices.events.recordatorio.enabled).toBe(false);
  });

  it("por defecto todos los avisos están apagados y el seguimiento es el de Servientrega", () => {
    const { notices } = dropiOptionsSchema.parse({});
    expect(Object.values(notices.events).every((e) => !e.enabled)).toBe(true);
    expect(notices.trackingUrl).toContain("{guia}");
    // Lo guardado en el formato nuevo se respeta tal cual.
    expect(dropiOptionsSchema.parse({ notices }).notices).toEqual(notices);
  });

  it("reemplaza variables y quita las líneas que quedan vacías", () => {
    const out = renderNotice(NOTICE_INFO.retiro.defaultText, {
      nombre: "Ana",
      producto: "Mega Red",
      agencia: "la oficina de Servientrega",
      direccion_agencia: "",
      horario: "",
      total: "$49.99",
      guia: "1800",
    });
    expect(out).toContain("¡Hola Ana!");
    expect(out).toContain("ya llegó a la oficina de Servientrega");
    expect(out).toContain("Guía: 1800");
    expect(out).not.toContain("📍");
    expect(out).not.toContain("🕒");
    expect(out).not.toMatch(/\{\w+\}/);
    // Variables desconocidas se dejan como están (para que el usuario note el error).
    expect(renderNotice("Hola {nombre} {otra}", { nombre: "Ana" })).toBe("Hola Ana {otra}");
  });

  it("las plantillas sugeridas cumplen las reglas de Meta", () => {
    expect(SUGGESTED_TEMPLATES.map((t) => t.kind).sort()).toEqual([...NOTICE_KINDS].sort());
    for (const t of SUGGESTED_TEMPLATES) {
      expect(t.name).toMatch(/^[a-z0-9_]+$/);
      const nums = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      // Variables seguidas desde {{1}} y un ejemplo por cada una.
      expect(nums).toEqual(nums.map((_, i) => i + 1));
      expect(t.examples).toHaveLength(nums.length);
      expect(t.body).not.toMatch(/^\s*\{\{|\}\}\s*$/);
      expect(t.body.length).toBeLessThanOrEqual(1024);
    }
  });
});
