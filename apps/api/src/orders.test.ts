import {
  formatPhone,
  missingCheckoutFields,
  nationalPhone,
  parseQuantity,
  splitName,
  stageFromDropi,
} from "@chatea/shared";
import { MockLanguageModelV4 } from "ai/test";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgentTurn } from "./agent/engine.js";
import type { AgentScheduler } from "./agent/scheduler.js";
import { findAgencies } from "./carriers/servientrega.js";
import { evaluateRisk, parseDropiWebhook } from "./orders/service.js";
import { client, hasDb, testApp } from "./test-helpers.js";
import { sign } from "./whatsapp/signature.js";

describe("pedidos: reglas", () => {
  it("mapea estados crudos de Dropi a etapas", () => {
    expect(stageFromDropi("PENDIENTE CONFIRMACION")).toBe("por_confirmar");
    expect(stageFromDropi("PENDIENTE")).toBe("confirmado");
    expect(stageFromDropi("GUIA_GENERADA")).toBe("guia_generada");
    expect(stageFromDropi("EN REPARTO")).toBe("en_transito");
    expect(stageFromDropi("EN OFICINA DE TRANSPORTADORA")).toBe("en_oficina");
    expect(stageFromDropi("NO ENTREGADO - NOVEDAD")).toBe("novedad");
    expect(stageFromDropi("ENTREGADO")).toBe("entregado");
    expect(stageFromDropi("DEVOLUCION EN TRANSITO")).toBe("devolucion");
    expect(stageFromDropi("CANCELADO")).toBe("cancelado");
    expect(stageFromDropi("ALGO RARO")).toBeNull();
  });

  it("cantidad, nombre y teléfono como los pide Dropi", () => {
    expect(parseQuantity("2 frascos")).toBe(2);
    expect(parseQuantity("la promo de tres")).toBe(3);
    expect(parseQuantity("")).toBe(1);
    expect(splitName("Ana María Pérez Gómez")).toEqual({
      nombre: "Ana María",
      apellido: "Pérez Gómez",
    });
    expect(splitName("Ana")).toEqual({ nombre: "Ana", apellido: "" });
    expect(nationalPhone("593991112233", "EC")).toBe("0991112233");
    expect(nationalPhone("0991112233", "EC")).toBe("0991112233");
    expect(nationalPhone("573001112233", "CO")).toBe("3001112233");
  });

  it("teléfono con el código de país separado", () => {
    expect(formatPhone("593991234567")).toBe("+593 991234567");
    expect(formatPhone("19195551234")).toBe("+1 9195551234");
    expect(formatPhone("573001112233")).toBe("+57 3001112233");
    expect(formatPhone("50760001111")).toBe("+507 60001111");
  });

  it("retiro en agencia reemplaza la dirección", () => {
    const base = { nombre: "Ana", ciudad: "Ambato", cantidad: "1" };
    expect(missingCheckoutFields(base)).toEqual(["direccion"]);
    expect(missingCheckoutFields({ ...base, agencia: "AMBATO_CASTILLO" })).toEqual([]);
  });

  it("la IA busca agencias de Servientrega y las ofrece", async () => {
    const agencyFetch = (async (url: string) => {
      expect(url).toBe("https://agencias.test/buscar?texto=Ambato%20Ficoa");
      return Response.json({
        ciudad_detectada: "ambato",
        resultados: [
          {
            nombre: "AMBATO_CASTILLO",
            ciudad: "AMBATO",
            provincia: "TUNGURAHUA",
            direccion: "CUENCA 15-06 Y CASTILLO",
            sector: "CENTRO",
            telefono: "03-3732000",
            horario_lun_vie: "09H00 A 18H00",
            horario_fin_semana: "09H00 A 13H00",
            entrega_en_oficina: "SI",
          },
        ],
      });
    }) as unknown as typeof fetch;
    const r = await findAgencies("https://agencias.test/", "Ambato Ficoa", agencyFetch);
    expect(r.agencias[0]).toMatchObject({ nombre: "AMBATO_CASTILLO", entregaEnOficina: true });

    let n = 0;
    const toolResults: unknown[] = [];
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const model = new MockLanguageModelV4({
      doGenerate: async (opts) => {
        n++;
        if (n === 1)
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "a1",
                toolName: "find_agencies",
                input: JSON.stringify({ texto: "Ambato Ficoa" }),
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: "tool_use" },
            usage,
            warnings: [],
          };
        toolResults.push(opts.prompt.at(-1));
        return {
          content: [{ type: "text" as const, text: "Puedes retirar en AMBATO_CASTILLO" }],
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage,
          warnings: [],
        };
      },
    });
    const turn = await runAgentTurn({
      resolved: { model, temperature: 0, label: "mock" },
      prompt: { text: "Vende", media: [] },
      hasProduct: true,
      checkout: {},
      context: { now: new Date(), timezone: "America/Guayaquil", customerName: "Ana", phone: "1" },
      messages: [{ role: "user", content: "Vivo en Ambato, sector Ficoa" }],
      io: {
        saveCheckout: async () => {},
        handoff: async () => {},
        selectProduct: async () => true,
        findAgencies: (t) => findAgencies("https://agencias.test", t, agencyFetch),
      },
    });
    expect(turn.calls.map((c) => c.name)).toEqual(["find_agencies"]);
    expect(JSON.stringify(toolResults)).toContain("CUENCA 15-06 Y CASTILLO");
    expect(turn.reply).toContain("AMBATO_CASTILLO");
  });

  it("lee avisos de Dropi con formas distintas", () => {
    expect(
      parseDropiWebhook({ id: 5, status: "ENTREGADO", distribution_company: { name: "SERVI" } }),
    ).toMatchObject({ dropiOrderId: "5", status: "ENTREGADO", carrier: "SERVI" });
    expect(
      parseDropiWebhook({ objects: { order_id: "9", estado: "EN REPARTO", guia: "G1" } }),
    ).toMatchObject({ dropiOrderId: "9", status: "EN REPARTO", trackingCode: "G1" });
  });

  it("regla de riesgo solo con historial suficiente", () => {
    const rules = { enabled: true, minDeliveryRate: 50, minOrders: 2 };
    const h = (delivered: number, returned: number) => ({
      orders: delivered + returned,
      delivered,
      returned,
      cancelled: 0,
      deliveryRate:
        delivered + returned ? Math.round((delivered / (delivered + returned)) * 100) : null,
    });
    expect(evaluateRisk(h(0, 1), rules).blocked).toBe(false); // un solo pedido: no alcanza
    expect(evaluateRisk(h(1, 3), rules).blocked).toBe(true);
    expect(evaluateRisk(h(3, 1), rules).blocked).toBe(false);
    expect(evaluateRisk(h(0, 5), { ...rules, enabled: false }).blocked).toBe(false);
  });
});

const APP_SECRET = "abcdefabcdefabcdefabcdefabcdef12";
const TOKEN = "EAAG-token-de-prueba-pedidos-1234";
const DROPI_TOKEN = "tok-dropi-de-prueba";

describe.skipIf(!hasDb)("pedidos y Dropi (IA confirma → Dropi → webhook)", () => {
  let app: FastifyInstance;
  let h: ReturnType<typeof client>;
  let scheduler: AgentScheduler | undefined;
  const dropiOrders: Record<string, unknown>[] = [];
  let history: { phone: string; status: string }[] = [];

  const metaFetch = (async (url: string) => {
    if (url.includes("fields=display_phone_number"))
      return Response.json({ id: "P", display_phone_number: "+1 555", verified_name: "Test" });
    if (url.endsWith("/messages"))
      return Response.json({ messages: [{ id: `wamid.X${Date.now()}${Math.random()}` }] });
    return Response.json({ success: true });
  }) as unknown as typeof fetch;

  // Dropi falso: imita la API de integraciones (cabecera dropi-integration-key).
  const dropiFetch = (async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    if (!headers["dropi-integration-key"]?.startsWith(DROPI_TOKEN))
      return Response.json({ isSuccess: false, message: "Access denied" }, { status: 401 });
    const path = url.replace("https://api.dropi.ec/integrations/", "");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === "department")
      return Response.json({
        isSuccess: true,
        objects: [
          { id: 1, name: "PICHINCHA" },
          { id: 2, name: "GUAYAS" },
          { id: 3, name: "EL ORO" },
        ],
      });
    if (path === "trajectory/bycity") {
      const cities: Record<number, { id: number; name: string }[]> = {
        1: [{ id: 10, name: "QUITO" }],
        2: [
          { id: 20, name: "GUAYAQUIL" },
          { id: 21, name: "SANTA ROSA" },
        ],
        3: [{ id: 30, name: "SANTA ROSA" }],
      };
      // Dropi repite la ciudad por transportadora.
      const list = (cities[body.department_id] ?? []).flatMap((c) => [
        { id: c.id, city: { ...c, department_id: body.department_id } },
        { id: c.id + 1000, city: { ...c, department_id: body.department_id } },
      ]);
      return Response.json({ isSuccess: true, objects: list });
    }
    if (path === "orders/myorders" && init?.method === "POST") {
      dropiOrders.push(body);
      return Response.json({
        isSuccess: true,
        objects: { id: 555 + dropiOrders.length, status: "PENDIENTE CONFIRMACION" },
      });
    }
    if (path.startsWith("orders/myorders?"))
      return Response.json({ isSuccess: true, objects: history });
    return Response.json({ message: "no simulado" }, { status: 404 });
  }) as unknown as typeof fetch;

  // La IA registra los datos, verifica la ciudad, confirma y luego responde.
  let step = 0;
  const usage = {
    inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 10, text: 10, reasoning: 0 },
  };
  const toolCall = (toolName: string, input: object) => ({
    content: [
      {
        type: "tool-call" as const,
        toolCallId: `c${++step}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: "tool_use" },
    usage,
    warnings: [],
  });
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const n = step % 4;
      if (n === 0)
        return toolCall("update_order_data", {
          nombre: "Ana Pérez",
          direccion: "Av. Amazonas 123",
          cantidad: "2 frascos",
        });
      if (n === 1) return toolCall("check_city", { ciudad: "quito" });
      if (n === 2) return toolCall("confirm_order", {});
      step++;
      return {
        content: [{ type: "text" as const, text: "¡Listo! Tu pedido quedó registrado 🎉" }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage,
        warnings: [],
      };
    },
  });

  beforeAll(async () => {
    app = await testApp(
      { AGENT_DEBOUNCE_MS: "0" },
      {
        metaFetch,
        dropiFetch,
        resolveModel: async () => ({ model, temperature: 0.3, label: "mock", kind: "openai" }),
        onScheduler: (s) => {
          scheduler = s;
        },
      },
    );
    h = client(app);
  });
  afterAll(async () => app.close());

  async function store(name: string, options: object, product: object, token = DROPI_TOKEN) {
    const o = await h.owner(name);
    const saved = await h.call(o.cookie, "PUT", "/api/integrations/dropi", {
      token,
      country: "EC",
      options,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const pnid = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const ch = await h.call(o.cookie, "POST", "/api/channels", {
      name: "Principal",
      phoneNumberId: pnid,
      wabaId: "987654321",
      accessToken: TOKEN,
      appSecret: APP_SECRET,
    });
    expect(ch.statusCode, ch.body).toBe(201);
    const prod = await h.call(o.cookie, "POST", "/api/products", product);
    expect(prod.statusCode, prod.body).toBe(201);
    return { ...o, pnid, channelId: ch.json().id as string };
  }

  const inbound = async (s: { channelId: string; pnid: string }, from: string, text: string) => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: s.pnid },
                contacts: [{ wa_id: from, profile: { name: "Cliente" } }],
                messages: [
                  {
                    from,
                    id: `wamid.${from}.${Date.now()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: text },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/webhooks/whatsapp/${s.channelId}`,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(raw, APP_SECRET),
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    await scheduler?.whenIdle();
    await new Promise((r) => setTimeout(r, 80)); // subida a Dropi en segundo plano
  };

  it("conecta Dropi, la IA confirma, se sube y Dropi actualiza el estado", async () => {
    // Token inválido → Dropi lo rechaza y no se guarda.
    const probe = await h.owner("token");
    const bad = await h.call(probe.cookie, "PUT", "/api/integrations/dropi", {
      token: "otro-token",
      country: "EC",
      options: {},
    });
    expect(bad.statusCode).toBe(422);
    expect((await h.call(probe.cookie, "GET", "/api/integrations/dropi")).json().connected).toBe(
      false,
    );

    const s = await store(
      "pedidos",
      { autoUpload: true },
      {
        name: "Mega Red",
        price: "27.99",
        currency: "USD",
        dropiProductId: "777",
        offers: [{ quantity: 2, totalPrice: "49.99", label: "2 frascos" }],
        triggers: [{ kind: "keyword", value: "mega red" }],
      },
    );
    const info = (await h.call(s.cookie, "GET", "/api/integrations/dropi")).json();
    expect(info).toMatchObject({ connected: true, country: "EC", tokenHint: "••••ueba" });
    expect(JSON.stringify(info)).not.toContain(DROPI_TOKEN);
    const secretPath = new URL(info.webhookUrl).pathname;

    await inbound(s, "593991112233", "Hola, quiero 2 Mega Red");

    const list = (await h.call(s.cookie, "GET", "/api/orders")).json();
    expect(list).toHaveLength(1);
    const order = list[0];
    expect(order).toMatchObject({ stage: "por_confirmar", total: "49.99", source: "ia" });
    expect(order.customer).toMatchObject({ nombre: "Ana", apellido: "Pérez", ciudad: "QUITO" });
    const sent = dropiOrders.at(-1);
    expect(order.dropiOrderId).toBe(String(555 + dropiOrders.length));
    expect(sent).toMatchObject({
      total_order: 49.99,
      name: "Ana",
      surname: "Pérez",
      state: "PICHINCHA",
      city: "QUITO",
      phone: "0991112233",
      rate_type: "CON RECAUDO",
      status: "PENDIENTE CONFIRMACION",
      products: [{ id: 777, quantity: 2 }],
    });

    // Volver a confirmar no duplica el pedido.
    const count = dropiOrders.length;
    const again = await h.call(
      s.cookie,
      "POST",
      `/api/conversations/${order.conversationId}/order`,
    );
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(order.id);
    expect(dropiOrders).toHaveLength(count);

    // Webhook de Dropi: secreto equivocado, guía y luego entregado.
    const unknown = await app.inject({
      method: "POST",
      url: "/api/webhooks/dropi/secreto-que-no-existe-123",
      payload: {},
    });
    expect(unknown.statusCode).toBe(404);
    const hook = (payload: object) => app.inject({ method: "POST", url: secretPath, payload });
    const id = Number(order.dropiOrderId);
    expect((await hook({ id, status: "GUIA_GENERADA", shipping_guide: "G-123" })).statusCode).toBe(
      200,
    );
    let detail = (await h.call(s.cookie, "GET", `/api/orders/${order.id}`)).json();
    expect(detail).toMatchObject({ stage: "guia_generada", trackingCode: "G-123" });
    await hook({ objects: { id: String(id), status: "ENTREGADO" } });
    detail = (await h.call(s.cookie, "GET", `/api/orders/${order.id}`)).json();
    expect(detail.stage).toBe("entregado");
    expect(detail.events.map((e: { source: string }) => e.source)).toContain("dropi");

    // Los datos del pedido y la ficha quedan con la ciudad y provincia de Dropi.
    const [conv] = (await h.call(s.cookie, "GET", "/api/conversations")).json();
    expect(conv.checkoutState).toMatchObject({ ciudad: "QUITO", provincia: "PICHINCHA" });
    expect(conv.contact).toMatchObject({ name: "Ana Pérez", city: "QUITO" });
    // Huella en la ficha: sus pedidos en la tienda y en Dropi.
    history = [{ phone: "0991112233", status: "ENTREGADO" }];
    const fp = (
      await h.call(s.cookie, "GET", `/api/conversations/${order.conversationId}/fingerprint`)
    ).json();
    expect(fp.dropiConnected).toBe(true);
    expect(fp.local).toMatchObject({ orders: 1, delivered: 1 });
    expect(fp.dropi).toHaveProperty("orders");

    // Buscador de agencias: se activa por tienda.
    expect((await h.call(s.cookie, "GET", "/api/integrations/servientrega")).json()).toEqual({
      available: true,
      enabled: false,
    });
    await h.call(s.cookie, "PUT", "/api/integrations/servientrega", { enabled: true });
    expect((await h.call(s.cookie, "GET", "/api/integrations/servientrega")).json().enabled).toBe(
      true,
    );

    // Ya está en Dropi: no se cancela desde aquí.
    const edit = await h.call(s.cookie, "PATCH", `/api/orders/${order.id}`, { cancel: true });
    expect(edit.statusCode).toBe(409);
  });

  it("error al subir, corrección y reintento; riesgo que aprueba el dueño", async () => {
    const s = await store(
      "reintento",
      { autoUpload: false, risk: { enabled: true, minDeliveryRate: 50, minOrders: 2 } },
      {
        name: "Colágeno",
        price: "30.00",
        currency: "USD",
        dropiProductId: "888",
        triggers: [{ kind: "keyword", value: "colageno" }],
      },
      `${DROPI_TOKEN}-tienda2`, // otra cuenta de Dropi: su propio historial
    );
    // La IA confirma, pero la tienda no sube sola: queda "por subir".
    const before = dropiOrders.length;
    await inbound(s, "593997776655", "info del colageno");
    const [order] = (await h.call(s.cookie, "GET", "/api/orders")).json();
    expect(order.stage).toBe("pendiente_subida");
    expect(dropiOrders).toHaveLength(before);

    // El asesor cambia la ciudad a una ambigua (Santa Rosa existe en dos provincias).
    await h.call(s.cookie, "PATCH", `/api/orders/${order.id}`, {
      customer: { nombre: "Luis", apellido: "Mora", ciudad: "Santa Rosa", provincia: "" },
    });
    let up = (await h.call(s.cookie, "POST", `/api/orders/${order.id}/upload`, {})).json();
    expect(up.result.status).toBe("error");
    expect(up.order.stage).toBe("error_subida");
    expect(up.order.uploadError).toMatch(/varias ciudades/);

    // Corrige la provincia; el comprador tiene mal historial en la tienda → a revisión.
    await h.call(s.cookie, "PATCH", `/api/orders/${order.id}`, {
      customer: { provincia: "El Oro" },
    });
    history = [
      { phone: "0997776655", status: "DEVOLUCION" },
      { phone: "0997776655", status: "DEVUELTO AL REMITENTE" },
      { phone: "+593 99 777 6655", status: "ENTREGADO" },
      { phone: "0990000000", status: "ENTREGADO" },
    ];
    up = (await h.call(s.cookie, "POST", `/api/orders/${order.id}/upload`, {})).json();
    expect(up.result.status).toBe("revision");
    expect(up.order.risk).toMatchObject({ delivered: 1, returned: 2, blocked: true });
    expect(dropiOrders).toHaveLength(before);

    // El dueño lo aprueba igual.
    up = (await h.call(s.cookie, "POST", `/api/orders/${order.id}/upload`, { force: true })).json();
    expect(up.result.status).toBe("subido");
    expect(dropiOrders).toHaveLength(before + 1);
    expect(dropiOrders.at(-1)).toMatchObject({
      state: "EL ORO",
      city: "SANTA ROSA",
      surname: "Mora",
    });
    expect(up.order.stage).toBe("por_confirmar");
  });
});
