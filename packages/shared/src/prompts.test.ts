import { describe, expect, it } from "vitest";
import {
  buildBuiltinVariables,
  type CatalogForPrompt,
  composePrompt,
  extractVariables,
  renderTemplate,
} from "./prompts.js";

const catalog: CatalogForPrompt = {
  tenantName: "VitashopEc",
  country: "EC",
  currency: "USD",
  product: {
    name: "Mega Red",
    description: "Omega-3 de krill",
    price: "27.99",
    initialMessage: "Hola",
    entryQuestion: "¿Desde qué ciudad?",
  },
  offers: [
    { quantity: 1, totalPrice: "27.99", label: "", freeShipping: false },
    { quantity: 2, totalPrice: "37.99", label: "+ regalo sorpresa", freeShipping: true },
  ],
  variants: [],
  faqs: [{ question: "¿Es original?", answer: "Sí, importado de EE.UU." }],
  upsells: [
    { name: "Batana Oil", price: "15.00", description: "para el cabello", active: true },
    { name: "Inactivo", price: null, description: "", active: false },
  ],
  media: [{ kind: "image", url: "https://x/1.png", usage: "inicial", caption: "" }],
};

describe("renderTemplate", () => {
  it("reemplaza variables y tolera espacios", () => {
    expect(renderTemplate("Hola {{ nombre }}!", { nombre: "Ana" }).text).toBe("Hola Ana!");
  });
  it("deja intactas y reporta las faltantes o vacías", () => {
    const r = renderTemplate("{{a}} {{b}} {{a}}", { b: "  " });
    expect(r.text).toBe("{{a}} {{b}} {{a}}");
    expect(r.missing).toEqual(["a", "b"]);
  });
  it("extrae variables sin repetir", () => {
    expect(extractVariables("{{x}} {{y}} {{x}}")).toEqual(["x", "y"]);
  });
});

describe("buildBuiltinVariables", () => {
  const v = buildBuiltinVariables(catalog);
  it("formatea precios y ofertas", () => {
    expect(v.precio).toBe("$27.99");
    expect(v.presentacion_ofertas).toBe(
      "- 1 x $27.99\n- 2 x $37.99 (+ regalo sorpresa, envío gratis)",
    );
  });
  it("solo incluye upsells activos", () => {
    expect(v.upsell).toBe("- Batana Oil $15.00: para el cabello");
  });
  it("usa moneda como sufijo si no es USD", () => {
    expect(buildBuiltinVariables({ ...catalog, currency: "COP" }).precio).toBe("27.99 COP");
  });
});

describe("composePrompt", () => {
  const builtins = buildBuiltinVariables(catalog);
  it("modo libre: ignora el maestro", () => {
    const r = composePrompt({
      platform: "P",
      common: "C",
      master: "M {{nombre_asesor}}",
      product: { mode: "libre", content: "Vende {{nombre_producto}}", sections: {}, variables: {} },
      builtins,
    });
    expect(r.layers.map((l) => l.name)).toEqual([
      "Plataforma",
      "Común de la tienda",
      "Producto (libre)",
    ]);
    expect(r.text).toContain("Vende Mega Red");
    expect(r.missing).toEqual([]);
  });
  it("modo guiado: maestro con variables del producto + secciones", () => {
    const r = composePrompt({
      platform: "P",
      master: "Soy {{nombre_asesor}}, vendo {{nombre_producto}} a {{publico_objetivo}}",
      product: {
        mode: "guiado",
        content: "",
        sections: { ficha_tecnica: "60 cápsulas", reglas: "" },
        variables: { nombre_asesor: "Carlos" },
      },
      builtins,
    });
    expect(r.layers.map((l) => l.name)).toEqual([
      "Plataforma",
      "Prompt maestro",
      "Producto (guiado)",
    ]);
    expect(r.text).toContain("Soy Carlos, vendo Mega Red");
    expect(r.text).toContain("## FICHA TÉCNICA\n60 cápsulas");
    expect(r.text).not.toContain("REGLAS");
    expect(r.missing).toEqual(["publico_objetivo"]);
  });
  it("las variables del catálogo no se pueden pisar con variables propias", () => {
    const r = composePrompt({
      platform: "{{precio}}",
      product: { mode: "libre", content: "", sections: {}, variables: { precio: "$1" } },
      builtins,
    });
    expect(r.text).toBe("$27.99");
  });
});
