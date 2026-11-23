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
          return { model: m, temperature: 0.3, label: "mock/test" };
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
