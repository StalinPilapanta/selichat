import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RealtimeBus } from "./realtime.js";
import { client, hasDb, testApp, WEB } from "./test-helpers.js";
import { sign } from "./whatsapp/signature.js";

const APP_SECRET = "abcdefabcdefabcdefabcdefabcdef12";
const TOKEN = "EAAG-token-de-prueba-123456789";

/** Meta simulado: responde como la Graph API y registra lo que se le envía. */
function fakeMeta() {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  let counter = 0;
  let failNext: { status: number; code: number; message: string } | null = null;
  const f = (async (
    url: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    sent.push({ url, body });
    if (init?.headers?.Authorization !== `Bearer ${TOKEN}`)
      return Response.json(
        { error: { message: "Invalid OAuth access token", code: 190 } },
        { status: 401 },
      );
    if (failNext) {
      const e = failNext;
      failNext = null;
      return Response.json({ error: { message: e.message, code: e.code } }, { status: e.status });
    }
    if (url.includes("fields=display_phone_number"))
      return Response.json({
        id: "PNID",
        display_phone_number: "+593 99 000 1111",
        verified_name: "VitashopEc",
      });
    if (url.endsWith("/messages")) {
      if (body.status === "read") return Response.json({ success: true });
      return Response.json({ messages: [{ id: `wamid.OUT${++counter}` }] });
    }
    if (url.includes("/message_templates") && init?.method === "DELETE")
      return Response.json({ success: true });
    if (/\/TPL-NEW$/.test(url) && init?.method === "POST") return Response.json({ success: true });
    if (url.includes("/message_templates") && init?.method === "POST")
      return Response.json({ id: "TPL-NEW", status: "PENDING", category: body.category });
    if (url.includes("/message_templates"))
      return Response.json({
        data: [
          {
            id: "TPL1",
            name: "confirmacion_pedido",
            language: "es",
            status: "APPROVED",
            category: "UTILITY",
            components: [{ type: "BODY", text: "Hola {{1}}, tu pedido de {{2}} está listo" }],
          },
          {
            id: "TPL2",
            name: "novedad",
            language: "es",
            status: "REJECTED",
            category: "UTILITY",
            components: [],
            rejected_reason: "INVALID_FORMAT",
          },
        ],
      });
    return Response.json({ error: { message: "no simulado" } }, { status: 404 });
  }) as unknown as typeof fetch;
  return { f, sent, fail: (e: typeof failNext) => (failNext = e) };
}

describe.skipIf(!hasDb)("WhatsApp + bandeja", () => {
  let app: FastifyInstance;
  let h: ReturnType<typeof client>;
  const meta = fakeMeta();
  const bus = new RealtimeBus();
  let owner: Awaited<ReturnType<typeof h.owner>>;
  let channel: { id: string; webhookUrl: string; verifyToken: string };
  let pnid = "";

  beforeAll(async () => {
    app = await testApp({}, { metaFetch: meta.f, bus });
    h = client(app);
  });
  afterAll(async () => app.close());

  const webhook = (value: object, opts: { secret?: string; channelId?: string } = {}) => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "WABA", changes: [{ field: "messages", value }] }],
    });
    return app.inject({
      method: "POST",
      url: `/api/webhooks/whatsapp/${opts.channelId ?? channel.id}`,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(raw, opts.secret ?? APP_SECRET),
      },
      payload: raw,
    });
  };
  const inbound = (id: string, text: string, extra: object = {}, from = "593991234567") => ({
    metadata: { phone_number_id: pnid },
    contacts: [{ wa_id: from, profile: { name: "Ana Cliente" } }],
    messages: [
      {
        from,
        id,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: text },
        ...extra,
      },
    ],
  });

  beforeEach(async () => {
    owner = await h.owner("wa");
    pnid = String(Date.now()) + String(Math.floor(Math.random() * 1000));
    const res = await h.call(owner.cookie, "POST", "/api/channels", {
      name: "Principal",
      phoneNumberId: pnid,
      wabaId: "987654321",
      accessToken: TOKEN,
      appSecret: APP_SECRET,
    });
    expect(res.statusCode, res.body).toBe(201);
    channel = res.json();
  });

  it("conecta el canal validando con Meta y no expone secretos", async () => {
    expect(channel).toMatchObject({
      displayPhone: "+593 99 000 1111",
      verifiedName: "VitashopEc",
      status: "activo",
    });
    expect(channel.webhookUrl).toBe(`${WEB}/api/webhooks/whatsapp/${channel.id}`);
    const list = await h.call(owner.cookie, "GET", "/api/channels");
    expect(list.body).not.toContain(TOKEN);
    expect(list.body).not.toContain(APP_SECRET);

    const bad = await h.call(owner.cookie, "POST", "/api/channels", {
      name: "x",
      phoneNumberId: "55555555",
      wabaId: "1234567",
      accessToken: "token-equivocado-123456789",
      appSecret: APP_SECRET,
    });
    expect(bad.json().error).toBe("whatsapp_token_invalido");

    const dup = await h.call(owner.cookie, "POST", "/api/channels", {
      name: "x",
      phoneNumberId: pnid,
      wabaId: "1234567",
      accessToken: TOKEN,
      appSecret: APP_SECRET,
    });
    expect(dup.statusCode).toBe(409);
  });

  it("verificación del webhook (hub.challenge)", async () => {
    const ok = await app.inject({
      url: `/api/webhooks/whatsapp/${channel.id}?hub.mode=subscribe&hub.verify_token=${channel.verifyToken}&hub.challenge=12345`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("12345");
    const bad = await app.inject({
      url: `/api/webhooks/whatsapp/${channel.id}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`,
    });
    expect(bad.statusCode).toBe(403);
  });

  it("rechaza webhooks sin firma válida", async () => {
    expect(
      (await webhook(inbound("wamid.BAD", "hola"), { secret: "ffffffffffffffffffffffffffffffff" }))
        .statusCode,
    ).toBe(401);
    expect((await h.call(owner.cookie, "GET", "/api/conversations")).json()).toEqual([]);
  });

  it("mensaje entrante: contacto, conversación, producto por anuncio, dedupe y evento en vivo", async () => {
    const product = (
      await h.call(owner.cookie, "POST", "/api/products", {
        name: "Mega Red",
        price: "27.99",
        currency: "USD",
        triggers: [{ kind: "ad_id", value: "120250514665380388" }],
      })
    ).json();

    const events: unknown[] = [];
    const off = bus.subscribe(owner.org.id, (e) => events.push(e));
    const msg = inbound("wamid.IN1", "Hola!", {
      referral: { source_type: "ad", source_id: "120250514665380388", ctwa_clid: "clid-9" },
    });
    expect((await webhook(msg)).statusCode).toBe(200);
    expect((await webhook(msg)).statusCode).toBe(200); // reintento de Meta
    off();

    const list = (await h.call(owner.cookie, "GET", "/api/conversations")).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      unreadCount: 1,
      lastMessagePreview: "Hola!",
      windowOpen: true,
      productId: product.id,
      contact: {
        phone: "593991234567",
        profileName: "Ana Cliente",
        sourceAdId: "120250514665380388",
      },
    });
    const msgs = (
      await h.call(owner.cookie, "GET", `/api/conversations/${list[0].id}/messages`)
    ).json();
    expect(msgs).toHaveLength(1);
    expect(events).toEqual([
      { type: "message", conversationId: list[0].id, messageId: msgs[0].id },
    ]);

    const detail = (await h.call(owner.cookie, "GET", `/api/conversations/${list[0].id}`)).json();
    expect(detail).toMatchObject({ productName: "Mega Red", ctwaClid: "clid-9" });

    await h.call(owner.cookie, "POST", `/api/conversations/${list[0].id}/read`);
    expect((await h.call(owner.cookie, "GET", "/api/conversations")).json()[0].unreadCount).toBe(0);
  });

  it("producto por palabra clave: gana la coincidencia más larga", async () => {
    await h.call(owner.cookie, "POST", "/api/products", {
      name: "Corto",
      price: "1.00",
      currency: "USD",
      triggers: [{ kind: "keyword", value: "Mega Red" }],
    });
    const largo = (
      await h.call(owner.cookie, "POST", "/api/products", {
        name: "Largo",
        price: "1.00",
        currency: "USD",
        triggers: [{ kind: "keyword", value: "me interesa el  MEGA red" }],
      })
    ).json();
    await webhook(inbound("wamid.K1", "Hola 👋 me interesa el Mega Red 💪"));
    expect((await h.call(owner.cookie, "GET", "/api/conversations")).json()[0].productId).toBe(
      largo.id,
    );
  });

  it("responder: texto dentro de 24 h, estados que no retroceden, asignación automática", async () => {
    await webhook(inbound("wamid.IN2", "precio?"));
    const conv = (await h.call(owner.cookie, "GET", "/api/conversations")).json()[0];
    const res = await h.call(owner.cookie, "POST", `/api/conversations/${conv.id}/messages`, {
      kind: "text",
      body: "Hola Ana, son $27.99",
    });
    expect(res.statusCode, res.body).toBe(201);
    const out = res.json();
    expect(out).toMatchObject({ status: "enviado", direction: "out", author: "humano" });
    const last = meta.sent.at(-1);
    expect(last?.url).toContain(`/v27.0/${pnid}/messages`);
    expect(last?.body).toMatchObject({
      to: "593991234567",
      type: "text",
      text: { body: "Hola Ana, son $27.99" },
    });

    const status = (s: string) => ({
      metadata: { phone_number_id: pnid },
      statuses: [{ id: out.waMessageId, status: s, timestamp: "1" }],
    });
    await webhook(status("read"));
    await webhook(status("delivered")); // llega tarde: no debe bajar de "leido"
    const msgs = (
      await h.call(owner.cookie, "GET", `/api/conversations/${conv.id}/messages`)
    ).json();
    expect(msgs.at(-1).status).toBe("leido");
    expect(
      (await h.call(owner.cookie, "GET", `/api/conversations/${conv.id}`)).json().assignedUserId,
    ).toBeTruthy();
  });

  it("ventana cerrada: solo plantillas aprobadas, con parámetros", async () => {
    const start = await h.call(owner.cookie, "POST", "/api/conversations", {
      channelId: channel.id,
      phone: "+593 98 765 4321",
    });
    expect(start.statusCode).toBe(201);
    const convId = start.json().id;
    const txt = await h.call(owner.cookie, "POST", `/api/conversations/${convId}/messages`, {
      kind: "text",
      body: "hola",
    });
    expect(txt.json()).toEqual({ error: "ventana_cerrada" });

    expect(
      (await h.call(owner.cookie, "POST", `/api/channels/${channel.id}/templates/sync`)).json(),
    ).toEqual({ synced: 2 });
    const tpls = (
      await h.call(owner.cookie, "GET", `/api/channels/${channel.id}/templates`)
    ).json();
    const ok = tpls.find((t: { name: string }) => t.name === "confirmacion_pedido");
    const rejected = tpls.find((t: { name: string }) => t.name === "novedad");
    expect(rejected).toMatchObject({ status: "REJECTED", rejectedReason: "INVALID_FORMAT" });

    expect(
      (
        await h.call(owner.cookie, "POST", `/api/conversations/${convId}/messages`, {
          kind: "template",
          templateId: rejected.id,
        })
      ).json(),
    ).toEqual({ error: "plantilla_no_aprobada" });

    const sent = await h.call(owner.cookie, "POST", `/api/conversations/${convId}/messages`, {
      kind: "template",
      templateId: ok.id,
      params: ["Ana", "Mega Red"],
    });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().body).toBe("Hola Ana, tu pedido de Mega Red está listo");
    expect(meta.sent.at(-1)?.body).toMatchObject({
      to: "593987654321",
      type: "template",
      template: { name: "confirmacion_pedido" },
    });
  });

  it("error de Meta queda registrado como fallido", async () => {
    await webhook(inbound("wamid.IN3", "hola"));
    const conv = (await h.call(owner.cookie, "GET", "/api/conversations")).json()[0];
    meta.fail({ status: 400, code: 131026, message: "Message undeliverable" });
    const res = await h.call(owner.cookie, "POST", `/api/conversations/${conv.id}/messages`, {
      kind: "text",
      body: "x",
    });
    expect(res.json()).toMatchObject({
      status: "fallido",
      error: { code: 131026, detail: "Message undeliverable" },
    });
  });

  it("crea plantillas en Meta con ejemplos obligatorios", async () => {
    const noEx = await h.call(owner.cookie, "POST", `/api/channels/${channel.id}/templates`, {
      name: "aviso_reparto",
      language: "es",
      category: "UTILITY",
      body: "Hola {{1}}, tu pedido sale hoy",
    });
    expect(noEx.json()).toEqual({ error: "faltan_ejemplos", count: 1 });
    const ok = await h.call(owner.cookie, "POST", `/api/channels/${channel.id}/templates`, {
      name: "aviso_reparto",
      language: "es",
      category: "UTILITY",
      body: "Hola {{1}}, tu pedido sale hoy",
      examples: ["Ana"],
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toMatchObject({ status: "PENDING", metaId: "TPL-NEW" });
    expect(meta.sent.at(-1)?.body).toMatchObject({
      components: [
        { type: "BODY", text: "Hola {{1}}, tu pedido sale hoy", example: { body_text: [["Ana"]] } },
      ],
    });

    const tplId = ok.json().id;
    const edited = await h.call(
      owner.cookie,
      "PATCH",
      `/api/channels/${channel.id}/templates/${tplId}`,
      { category: "UTILITY", body: "Hola {{1}}, tu pedido sale mañana", examples: ["Ana"] },
    );
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({ status: "PENDING" });
    expect(meta.sent.at(-1)?.url).toMatch(/\/TPL-NEW$/);
    expect(meta.sent.at(-1)?.body).toMatchObject({
      components: [{ type: "BODY", text: "Hola {{1}}, tu pedido sale mañana" }],
    });

    const del = await h.call(
      owner.cookie,
      "DELETE",
      `/api/channels/${channel.id}/templates/${tplId}`,
    );
    expect(del.statusCode).toBe(204);
    expect(meta.sent.at(-1)?.url).toContain("hsm_id=TPL-NEW");
    const left = (
      await h.call(owner.cookie, "GET", `/api/channels/${channel.id}/templates`)
    ).json();
    expect(left.find((t: { id: string }) => t.id === tplId)).toBeUndefined();
  });

  it("notas, pausa del bot, etiquetas e aislamiento entre tiendas", async () => {
    await webhook(inbound("wamid.IN4", "hola"));
    const conv = (await h.call(owner.cookie, "GET", "/api/conversations")).json()[0];
    await h.call(owner.cookie, "POST", `/api/conversations/${conv.id}/notes`, {
      body: "Cliente pide factura",
    });
    expect(
      (await h.call(owner.cookie, "GET", `/api/conversations/${conv.id}/notes`)).json()[0].body,
    ).toBe("Cliente pide factura");
    const p = await h.call(owner.cookie, "PATCH", `/api/conversations/${conv.id}`, {
      botPaused: true,
      labels: ["vip"],
    });
    expect(p.json()).toMatchObject({ botPaused: true, labels: ["vip"] });
    expect(
      (await h.call(owner.cookie, "GET", "/api/conversations?filter=pausadas")).json(),
    ).toHaveLength(1);

    // La lista trae la etapa del lead (para el chip de la bandeja).
    expect(conv.leadStage).toBeTruthy();

    // Respuestas rápidas: se crean, el mismo atajo se actualiza, se validan y se borran.
    const qr = await h.call(owner.cookie, "POST", "/api/quick-replies", {
      shortcut: "Precio",
      body: "El precio es $27.99 con envío gratis.",
    });
    expect(qr.statusCode, qr.body).toBe(201);
    expect(qr.json()).toMatchObject({ shortcut: "precio" });
    await h.call(owner.cookie, "POST", "/api/quick-replies", {
      shortcut: "precio",
      body: "Ahora $24.99",
    });
    const quick = (await h.call(owner.cookie, "GET", "/api/quick-replies")).json();
    expect(quick).toEqual([{ id: qr.json().id, shortcut: "precio", body: "Ahora $24.99" }]);
    const bad = await h.call(owner.cookie, "POST", "/api/quick-replies", {
      shortcut: "con espacios",
      body: "x",
    });
    expect(bad.statusCode).toBe(400);

    const other = await h.owner("otra");
    // Otra tienda no ve ni borra las respuestas rápidas de esta.
    expect((await h.call(other.cookie, "GET", "/api/quick-replies")).json()).toEqual([]);
    expect(
      (await h.call(other.cookie, "DELETE", `/api/quick-replies/${qr.json().id}`)).statusCode,
    ).toBe(404);
    expect(
      (await h.call(owner.cookie, "DELETE", `/api/quick-replies/${qr.json().id}`)).statusCode,
    ).toBe(200);
    expect((await h.call(owner.cookie, "GET", "/api/quick-replies")).json()).toEqual([]);
    expect((await h.call(other.cookie, "GET", "/api/conversations")).json()).toEqual([]);
    expect(
      (await h.call(other.cookie, "GET", `/api/conversations/${conv.id}/messages`)).json(),
    ).toEqual([]);
    expect(
      (
        await h.call(other.cookie, "POST", `/api/conversations/${conv.id}/messages`, {
          kind: "text",
          body: "x",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await h.call(other.cookie, "PATCH", `/api/conversations/${conv.id}`, { botPaused: false }))
        .statusCode,
    ).toBe(404);
    // Un webhook de otro canal no puede inyectar mensajes en este tenant
    expect(
      (
        await webhook(inbound("wamid.X", "spam"), {
          channelId: "00000000-0000-0000-0000-000000000000",
        })
      ).statusCode,
    ).toBe(404);
  });
});
