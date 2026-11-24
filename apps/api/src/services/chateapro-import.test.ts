import { describe, expect, it } from "vitest";
import { workspaceFields } from "../__fixtures__/chateapro.js";
import { parseDelay, parseWorkspace } from "./chateapro-import.js";

describe("parseDelay", () => {
  it.each([
    ["1 horas", 60],
    ["5 horas", 300],
    ["3 dias", 4320],
    ["2 días", 2880],
    ["30 minutos", 30],
    ["1,5 horas", 90],
    ["", null],
    ["pronto", null],
  ])("%s → %s", (input, expected) => expect(parseDelay(input)).toBe(expected));
});

describe("parseWorkspace", () => {
  const ws = parseWorkspace(workspaceFields);

  it("ignora slots vacíos y ordena por número", () => {
    expect(ws.products.map((p) => p.slot)).toEqual([
      "[Producto Ventas Wp] 1",
      "[Producto Ventas Wp] 2",
    ]);
  });

  it("mapea el producto con su embudo, media y disparadores", () => {
    const mega = ws.products[0];
    expect(mega?.data).toMatchObject({
      name: "Mega Red",
      price: "27.99",
      currency: "USD",
      kind: "fisico",
      status: "activo",
      dropiProductId: "148700",
      entryQuestion: "📍 ¿Desde qué ciudad nos escribes?",
    });
    expect(mega?.data.media?.map((m) => m.kind)).toEqual(["image", "video", "audio"]);
    // Une activadores del producto + índice extendido, sin vacíos ni duplicados
    expect(mega?.data.triggers).toEqual([
      { kind: "keyword", value: "Hola 👋 me interesa el Mega Red 💪" },
      { kind: "keyword", value: "Mega Red" },
      { kind: "keyword", value: "MegaRed" },
      { kind: "ad_id", value: "120250514665380388" },
      { kind: "ad_id", value: "120250514665360388" },
      { kind: "ad_id", value: "120250514665370388" },
    ]);
  });

  it("convierte recordatorios, remarketing y upsells", () => {
    const d = ws.products[0]?.data;
    expect(d?.followUps?.reminders).toEqual([
      {
        enabled: true,
        delayMinutes: 60,
        message: "💪Iniciemos el tratamiento hoy mismo!",
        mode: "mensaje",
        template: null,
      },
      {
        enabled: true,
        delayMinutes: 300,
        message: "👉 Confirma ahora tu pedido",
        mode: "mensaje",
        template: null,
      },
    ]);
    // remarketing 1 no tiene mensaje ni plantilla real → se descarta
    expect(d?.followUps?.remarketing).toEqual([
      {
        enabled: true,
        delayMinutes: 7200,
        message: "",
        mode: "ia",
        template: { name: "remarketing_megared", lang: "es" },
      },
    ]);
    expect(d?.upsells).toEqual([
      expect.objectContaining({
        name: "Batana Oil",
        price: "15.00",
        active: true,
        moment: "compra_realizada",
      }),
    ]);
  });

  it("prompt libre y guiado", () => {
    expect(ws.products[0]?.prompt).toEqual({
      mode: "libre",
      content: "ROL: Carlos, asesor de ventas de MegaRed en Ecuador.",
      sections: {},
    });
    expect(ws.products[1]?.prompt).toEqual({
      mode: "guiado",
      content: "",
      sections: { ficha_tecnica: "Gomitas de moringa", reglas: "No prometas curas" },
    });
  });

  it("normaliza precio con coma, estado inactivo y multimedia como objeto", () => {
    const bio = ws.products[1]?.data;
    expect(bio).toMatchObject({ price: "24.90", status: "inactivo" });
    expect(bio?.media).toEqual([{ kind: "image", url: "https://x/a.webp", usage: "inicial" }]);
  });

  it("arma la capa común y el maestro; no toca credenciales", () => {
    expect(ws.common).toBe(
      "Sé humano.\n\nRESTRICCIONES\n1. No repitas datos.\n\nDivide cada respuesta en máximo 5 mensajes cortos.",
    );
    expect(ws.master).toBe("Asesor: {{nombre_asesor}}");
    expect(JSON.stringify(ws)).not.toContain("secreto");
  });
});
