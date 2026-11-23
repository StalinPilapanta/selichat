import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workspaceFields } from "./__fixtures__/chateapro.js";
import { ImportError, parseWorkspace } from "./services/chateapro-import.js";
import { client, hasDb, testApp } from "./test-helpers.js";

describe.skipIf(!hasDb)("Importación desde Chatea Pro", () => {
  let app: FastifyInstance;
  let h: ReturnType<typeof client>;
  beforeAll(async () => {
    app = await testApp(
      {},
      {
        loadWorkspace: async (token) => {
          if (token !== "token-valido-123") throw new ImportError("token_invalido");
          return parseWorkspace(workspaceFields);
        },
      },
    );
    h = client(app);
  });
  afterAll(async () => app.close());

  it("preview, importación, re-importación idempotente y conflicto de disparadores", async () => {
    const o = await h.owner("imp");
    const bad = await h.call(o.cookie, "POST", "/api/import/chateapro/preview", {
      token: "token-malo-000",
    });
    expect(bad.json()).toEqual({ error: "token_invalido" });

    const prev = (
      await h.call(o.cookie, "POST", "/api/import/chateapro/preview", { token: "token-valido-123" })
    ).json();
    expect(prev).toMatchObject({ hasCommon: true, hasMaster: true });
    expect(
      prev.products.map((p: { name: string; alreadyImported: boolean }) => [
        p.name,
        p.alreadyImported,
      ]),
    ).toEqual([
      ["Mega Red", false],
      ["BioKids Moringa", false],
    ]);

    // Un producto propio ya usa la palabra "MegaRed"
    await h.call(o.cookie, "POST", "/api/products", {
      name: "Propio",
      price: "1.00",
      currency: "USD",
      triggers: [{ kind: "keyword", value: "MegaRed" }],
    });

    const run = await h.call(o.cookie, "POST", "/api/import/chateapro", {
      token: "token-valido-123",
      slots: ["[Producto Ventas Wp] 1", "[Producto Ventas Wp] 2"],
    });
    expect(run.statusCode, run.body).toBe(200);
    const r = run.json();
    expect(r).toMatchObject({ commonUpdated: true, masterUpdated: true });
    expect(r.products.map((p: { action: string }) => p.action)).toEqual(["creado", "creado"]);
    expect(r.products[0].warnings).toContain(
      'Disparador omitido (ya lo usa otro producto): "MegaRed"',
    );

    const list = (await h.call(o.cookie, "GET", "/api/products")).json();
    const mega = list.find((p: { name: string }) => p.name === "Mega Red");
    expect(mega.triggers).toBe(5);

    const preview = (
      await h.call(o.cookie, "POST", "/api/prompts/preview", { productId: mega.id })
    ).json();
    expect(preview.layers.map((l: { name: string }) => l.name)).toEqual([
      "Plataforma",
      "Común de la tienda",
      "Producto (libre)",
    ]);

    // Re-importar: actualiza (no duplica) y no crea versiones de prompt si nada cambió
    const again = (
      await h.call(o.cookie, "POST", "/api/import/chateapro", {
        token: "token-valido-123",
        slots: ["[Producto Ventas Wp] 1"],
        includeCommon: true,
      })
    ).json();
    expect(again).toMatchObject({ commonUpdated: false, masterUpdated: false });
    expect(again.products[0].action).toBe("actualizado");
    expect((await h.call(o.cookie, "GET", "/api/products")).json()).toHaveLength(3);
    const hist = (
      await h.call(o.cookie, "GET", `/api/prompts?scope=product&productId=${mega.id}`)
    ).json();
    expect(hist).toHaveLength(1);

    const prev2 = (
      await h.call(o.cookie, "POST", "/api/import/chateapro/preview", { token: "token-valido-123" })
    ).json();
    expect(prev2.products[0].alreadyImported).toBe(true);
  });
});
