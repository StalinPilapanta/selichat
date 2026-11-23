import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, hasDb, testApp } from "./test-helpers.js";

const megaRed = {
  name: "Mega Red",
  description: "Omega-3 de krill, 60 cápsulas",
  price: "27.99",
  currency: "usd",
  dropiProductId: "148700",
  initialMessage: "Hola, soy Carlos",
  entryQuestion: "¿Desde qué ciudad nos escribes?",
  offers: [
    { quantity: 1, totalPrice: "27.99" },
    {
      quantity: 2,
      totalPrice: "37.99",
      label: "+ regalo sorpresa",
      freeShipping: true,
      featured: true,
    },
  ],
  media: [{ kind: "image", url: "https://media.example.com/megared.png" }],
  faqs: [{ question: "¿Es original?", answer: "Sí, importado de EE.UU." }],
  triggers: [
    { kind: "keyword", value: "me interesa el Mega Red" },
    { kind: "ad_id", value: "120250514665380388" },
  ],
  upsells: [{ name: "Batana Oil", price: "15.00", active: true }],
};

describe.skipIf(!hasDb)("Catálogo y prompts", () => {
  let app: FastifyInstance;
  let h: ReturnType<typeof client>;
  beforeAll(async () => {
    app = await testApp();
    h = client(app);
  });
  afterAll(async () => app.close());

  it("CRUD de producto con hijos", async () => {
    const o = await h.owner("cat");
    const created = await h.call(o.cookie, "POST", "/api/products", megaRed);
    expect(created.statusCode, created.body).toBe(201);
    const p = created.json();
    expect(p).toMatchObject({ name: "Mega Red", currency: "USD", price: "27.99" });
    expect(p.offers).toHaveLength(2);
    expect(p.offers[1]).toMatchObject({ quantity: 2, totalPrice: "37.99", position: 1 });
    expect(p.triggers).toHaveLength(2);

    const list = (await h.call(o.cookie, "GET", "/api/products")).json();
    expect(list).toEqual([expect.objectContaining({ id: p.id, triggers: 2, offers: 2 })]);

    const upd = await h.call(o.cookie, "PUT", `/api/products/${p.id}`, {
      ...megaRed,
      price: "29.99",
      offers: [{ quantity: 3, totalPrice: "52.00" }],
    });
    expect(upd.statusCode, upd.body).toBe(200);
    expect(upd.json().offers).toEqual([
      expect.objectContaining({ quantity: 3, totalPrice: "52.00" }),
    ]);
    expect(upd.json().faqs).toHaveLength(1);

    expect((await h.call(o.cookie, "DELETE", `/api/products/${p.id}`)).statusCode).toBe(204);
    expect((await h.call(o.cookie, "GET", `/api/products/${p.id}`)).statusCode).toBe(404);
  });

  it("valida datos y rechaza disparadores duplicados", async () => {
    const o = await h.owner("val");
    const bad = await h.call(o.cookie, "POST", "/api/products", { ...megaRed, price: "27,99" });
    expect(bad.statusCode).toBe(400);

    expect((await h.call(o.cookie, "POST", "/api/products", megaRed)).statusCode).toBe(201);
    const dup = await h.call(o.cookie, "POST", "/api/products", {
      ...megaRed,
      name: "Otro",
      triggers: [{ kind: "ad_id", value: "120250514665380388" }],
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().detail).toContain("Mega Red");
  });

  it("otro tenant no ve ni edita el producto, y puede usar el mismo disparador", async () => {
    const a = await h.owner("a");
    const b = await h.owner("b");
    const p = (await h.call(a.cookie, "POST", "/api/products", megaRed)).json();
    expect((await h.call(b.cookie, "GET", "/api/products")).json()).toEqual([]);
    expect((await h.call(b.cookie, "GET", `/api/products/${p.id}`)).statusCode).toBe(404);
    expect((await h.call(b.cookie, "PUT", `/api/products/${p.id}`, megaRed)).statusCode).toBe(404);
    expect((await h.call(b.cookie, "DELETE", `/api/products/${p.id}`)).statusCode).toBe(404);
    expect((await h.call(b.cookie, "POST", "/api/products", megaRed)).statusCode).toBe(201);
  });

  it("versiones de prompt, publicación, rollback y preview por capas", async () => {
    const o = await h.owner("prm");
    const p = (await h.call(o.cookie, "POST", "/api/products", megaRed)).json();

    const save = (body: object) => h.call(o.cookie, "POST", "/api/prompts", body);
    expect(
      (await save({ scope: "common", content: "Mensajes cortos.", publish: true })).statusCode,
    ).toBe(201);
    expect(
      (
        await save({
          scope: "master",
          content: "Soy {{nombre_asesor}}. Ofertas:\n{{presentacion_ofertas}}",
          publish: true,
        })
      ).statusCode,
    ).toBe(201);

    const v1 = (
      await save({
        scope: "product",
        productId: p.id,
        mode: "guiado",
        sections: { ficha_tecnica: "Precio {{precio}}" },
        variables: { nombre_asesor: "Carlos" },
        publish: true,
      })
    ).json();
    expect(v1.version).toBe(1);
    const v2 = (
      await save({ scope: "product", productId: p.id, mode: "libre", content: "Libre v2" })
    ).json();
    expect(v2.version).toBe(2);

    // v2 es borrador: la activa sigue siendo v1
    let hist = (
      await h.call(o.cookie, "GET", `/api/prompts?scope=product&productId=${p.id}`)
    ).json();
    expect(hist.map((x: { version: number; active: boolean }) => [x.version, x.active])).toEqual([
      [2, false],
      [1, true],
    ]);

    const prev = (
      await h.call(o.cookie, "POST", "/api/prompts/preview", { productId: p.id })
    ).json();
    expect(prev.layers.map((l: { name: string }) => l.name)).toEqual([
      "Plataforma",
      "Común de la tienda",
      "Prompt maestro",
      "Producto (guiado)",
    ]);
    expect(prev.text).toContain("Soy Carlos");
    expect(prev.text).toContain("2 x $37.99 (+ regalo sorpresa, envío gratis)");
    expect(prev.text).toContain("Precio $27.99");
    expect(prev.missing).toEqual([]);

    // Publicar v2 y volver a v1 (rollback)
    await h.call(o.cookie, "POST", `/api/prompts/${v2.id}/publish`);
    expect(
      (await h.call(o.cookie, "POST", "/api/prompts/preview", { productId: p.id })).json().text,
    ).toContain("Libre v2");
    await h.call(o.cookie, "POST", `/api/prompts/${v1.id}/publish`);
    hist = (await h.call(o.cookie, "GET", `/api/prompts?scope=product&productId=${p.id}`)).json();
    expect(hist.find((x: { active: boolean }) => x.active).version).toBe(1);

    // Preview de borrador sin guardar
    const draft = await h.call(o.cookie, "POST", "/api/prompts/preview", {
      productId: p.id,
      draft: { mode: "libre", content: "Hola {{desconocida}}", sections: {}, variables: {} },
    });
    expect(draft.json().missing).toEqual(["desconocida"]);

    // productId obligatorio solo en scope product
    expect((await save({ scope: "product", content: "x" })).statusCode).toBe(400);
    expect((await save({ scope: "master", productId: p.id, content: "x" })).statusCode).toBe(400);
  });

  it("un asesor puede leer el catálogo pero no editarlo", async () => {
    const o = await h.owner("own");
    const asesor = await h.signUp("ase");
    const inv = (
      await h.call(o.cookie, "POST", "/api/auth/organization/invite-member", {
        email: asesor.email,
        role: "asesor",
      })
    ).json();
    await h.call(asesor.cookie, "POST", "/api/auth/organization/accept-invitation", {
      invitationId: inv.id,
    });
    await h.call(o.cookie, "POST", "/api/products", megaRed);
    expect((await h.call(asesor.cookie, "GET", "/api/products")).json()).toHaveLength(1);
    expect((await h.call(asesor.cookie, "POST", "/api/products", megaRed)).statusCode).toBe(403);
    expect(
      (await h.call(asesor.cookie, "POST", "/api/prompts", { scope: "master", content: "x" }))
        .statusCode,
    ).toBe(403);
  });
});
