import { createDb } from "@chatea/db";
import { MockLanguageModelV4 } from "ai/test";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiNotConfiguredError, createModelResolver } from "./ai/models.js";
import { client, hasDb, testApp } from "./test-helpers.js";

const draft = {
  name: "Mega Red",
  description: "Omega-3 de krill.",
  price: "27.99",
  offers: [{ quantity: 2, totalPrice: "37.99", label: "+ regalo" }],
  faqs: [{ question: "¿Es original?", answer: "Sí" }],
  initialMessage: "Hola, soy Carlos",
  entryQuestion: "¿Es para ti o un familiar?",
  sections: {
    contextualizacion: "c",
    ficha_tecnica: "f",
    guion_conversacional: "g",
    posibles_situaciones: "p",
    reglas: "r",
  },
  variables: {
    nombre_asesor: "Carlos",
    rol: "asesor",
    publico_objetivo: "hombres 35+",
    angulo_venta: "vitalidad",
    metodos_pago: "contra entrega",
    lenguaje_expresiones: "cercano",
    incluye_empaque: "60 cápsulas",
    reglas_personalizadas: "",
  },
};

const mockModel = (text: string) =>
  new MockLanguageModelV4({
    // «Acepta» URLs de imágenes: el SDK no las descarga en las pruebas.
    supportedUrls: { "image/*": [/^https:\/\//] },
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 300, text: 300, reasoning: 0 },
      },
      warnings: [],
    },
  });

describe.skipIf(!hasDb)("Generador de producto con IA", () => {
  let app: FastifyInstance;
  let h: ReturnType<typeof client>;
  let reply = JSON.stringify(draft);
  let seenPrompt = "";
  /** Proveedor del modelo de prueba: con uno que ve imágenes se le envían las fotos. */
  let kind: "anthropic" | undefined;

  beforeAll(async () => {
    app = await testApp(
      {},
      {
        resolveModel: async (_tenant, agent) => {
          if (agent !== "utilidad") throw new Error("agente inesperado");
          const m = mockModel(reply);
          const orig = m.doGenerate;
          m.doGenerate = async (o) => {
            seenPrompt = JSON.stringify(o.prompt);
            return orig(o);
          };
          return { model: m, temperature: 0.3, label: "mock/test", ...(kind ? { kind } : {}) };
        },
      },
    );
    h = client(app);
  });
  afterAll(async () => app.close());

  it("devuelve el borrador validado", async () => {
    const o = await h.owner("gen");
    const res = await h.call(o.cookie, "POST", "/api/ai/generate-product", {
      source: "MegaRed Omega-3 aceite de krill, 60 cápsulas, precio 27.99, 2 por 37.99",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual(draft);
    expect(seenPrompt).toContain("60 cápsulas");
  });

  it("502 si la IA devuelve algo inválido; 400 si la ficha es muy corta", async () => {
    const o = await h.owner("gen2");
    reply = '{"name": 1}';
    const bad = await h.call(o.cookie, "POST", "/api/ai/generate-product", {
      source: "x".repeat(40),
    });
    expect(bad.statusCode).toBe(502);
    expect(bad.json()).toMatchObject({ error: "ia_fallo", model: "mock/test" });
    expect(
      (await h.call(o.cookie, "POST", "/api/ai/generate-product", { source: "corto" })).statusCode,
    ).toBe(400);
    reply = JSON.stringify(draft);
  });

  it("detalle del producto leído de sus fotos (Dropi no da la descripción)", async () => {
    const o = await h.owner("describe");
    const body = {
      name: "X2 Drenaje Linfatico Mayaberra",
      categories: ["Belleza"],
      imageUrls: ["https://d39ru7awumhhs2.cloudfront.net/ecuador/products/197094/foto.jpeg"],
    };
    // Un modelo que no ve imágenes no puede.
    kind = undefined;
    const noVision = await h.call(o.cookie, "POST", "/api/ai/describe-product", body);
    expect(noVision.statusCode).toBe(409);
    expect(noVision.json().error).toBe("ia_sin_vision");
    // Con uno que sí: recibe la foto y devuelve el detalle.
    kind = "anthropic";
    reply =
      "Crema reductora de 250 ml con cafeína y centella asiática. Modo de uso: aplicar con masaje.";
    const ok = await h.call(o.cookie, "POST", "/api/ai/describe-product", body);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().description).toContain("250 ml");
    expect(seenPrompt).toContain("cloudfront.net");
    // Fotos fuera de Dropi: no.
    const bad = await h.call(o.cookie, "POST", "/api/ai/describe-product", {
      ...body,
      imageUrls: ["https://ejemplo.com/a.jpg"],
    });
    expect(bad.statusCode).toBe(400);
    kind = undefined;
    reply = JSON.stringify(draft);
  });

  it("fotos del producto: solo del CDN de Dropi", async () => {
    const o = await h.owner("gen3");
    const source = "Producto: X2 Drenaje Linfatico Mayaberra\nCategorías: Belleza";
    const ok = await h.call(o.cookie, "POST", "/api/ai/generate-product", {
      source,
      imageUrls: ["https://d39ru7awumhhs2.cloudfront.net/ecuador/products/197094/foto.jpeg"],
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const bad = await h.call(o.cookie, "POST", "/api/ai/generate-product", {
      source,
      imageUrls: ["http://169.254.169.254/latest/meta-data"],
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe.skipIf(!hasDb)("Resolutor de modelos", () => {
  let app: FastifyInstance;
  let h: ReturnType<typeof client>;
  const { db, client: pg } = createDb(process.env.DATABASE_URL ?? "", { max: 2 });
  beforeAll(async () => {
    app = await testApp();
    h = client(app);
  });
  afterAll(async () => {
    await app.close();
    await pg.end();
  });

  it("usa el proveedor y modelo del tenant; error claro si no hay", async () => {
    const o = await h.owner("res");
    const resolve = createModelResolver(db, process.env.ENCRYPTION_KEY ?? "");
    await expect(resolve(o.org.id, "utilidad")).rejects.toBeInstanceOf(AiNotConfiguredError);

    // Sin modelo configurado, el endpoint responde 409
    const r409 = await h.call(o.cookie, "POST", "/api/ai/generate-product", {
      source: "y".repeat(40),
    });
    expect(r409.json()).toEqual({ error: "ia_no_configurada", agent: "utilidad" });

    const prov = (
      await h.call(o.cookie, "POST", "/api/ai-providers", {
        kind: "openai",
        name: "OAI",
        apiKey: "sk-test-123456",
      })
    ).json();
    await h.call(o.cookie, "PUT", "/api/agent-configs/utilidad", {
      providerId: prov.id,
      model: "gpt-4o-mini",
      temperature: 0.2,
    });
    const m = await resolve(o.org.id, "utilidad");
    expect(m.label).toBe("openai/gpt-4o-mini");
    expect(m.temperature).toBe(0.2);
    expect(typeof m.model).toBe("object");
  });
});
