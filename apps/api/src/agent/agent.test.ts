import { createDb } from "@chatea/db";
import { MockLanguageModelV4 } from "ai/test";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RealtimeBus } from "../realtime.js";
import { client, hasDb, testApp } from "../test-helpers.js";
import { sign } from "../whatsapp/signature.js";
import { dueStep, inSendingHours, runFollowUps } from "./followups.js";
import { splitReply, toModelMessages } from "./format.js";
import type { AgentScheduler } from "./scheduler.js";
import { AgentScheduler as Scheduler } from "./scheduler.js";

describe("formato del agente", () => {
  it("parte la respuesta en burbujas por párrafo", () => {
    expect(splitReply("Hola Ana 😊\n\n¿De qué ciudad nos escribes?")).toEqual([
      "Hola Ana 😊",
      "¿De qué ciudad nos escribes?",
    ]);
    expect(splitReply("a\n\nb\n\nc\n\nd", 3)).toEqual(["a", "b", "c\n\nd"]);
    expect(splitReply("   ")).toEqual([]);
  });

  it("fusiona ráfagas y empieza siempre por el cliente", () => {
    const msgs = toModelMessages([
      { direction: "out", author: "ia", type: "text", body: "Bienvenida" },
      { direction: "in", author: "cliente", type: "text", body: "hola" },
      { direction: "in", author: "cliente", type: "audio", body: "" },
      { direction: "out", author: "humano", type: "text", body: "te ayudo" },
    ]);
    expect(msgs).toEqual([
      { role: "user", content: "hola\n[audio sin texto]" },
      { role: "assistant", content: "(asesor humano) te ayudo" },
    ]);
  });
});

describe("scheduler del agente", () => {
  it("agrupa ráfagas y no corre dos turnos a la vez", async () => {
    const runs: string[] = [];
    let release: () => void = () => {};
    const s = new Scheduler(async (_t, c) => {
      runs.push(c);
      if (runs.length === 1) await new Promise<void>((r) => (release = r));
    }, 20);
    s.schedule("t", "c1");
    s.schedule("t", "c1");
    s.schedule("t", "c1");
    await new Promise((r) => setTimeout(r, 50));
    expect(runs).toEqual(["c1"]); // 3 mensajes → 1 turno
    s.schedule("t", "c1"); // llega otro mientras piensa
    await new Promise((r) => setTimeout(r, 50));
    expect(runs).toEqual(["c1"]); // no corre en paralelo
    release();
    await new Promise((r) => setTimeout(r, 80));
    await s.whenIdle();
    expect(runs).toEqual(["c1", "c1"]); // pero sí al terminar
  });
});

describe("recordatorios: reglas", () => {
  const steps = [
    { enabled: true, delayMinutes: 30, message: "a" },
    { enabled: true, delayMinutes: 1380, message: "b" },
  ];
  const t0 = new Date("2026-11-24T15:00:00Z");
  const at = (min: number) => new Date(t0.getTime() + min * 60_000);
  it("envía el último paso vencido y no repite", () => {
    expect(dueStep(steps, 0, t0, at(10))).toBeNull();
    expect(dueStep(steps, 0, t0, at(31))).toBe(0);
    expect(dueStep(steps, 1, t0, at(31))).toBeNull();
    expect(dueStep(steps, 0, t0, at(1400))).toBe(1); // servidor caído: solo el último
    expect(dueStep(steps, 2, t0, at(5000))).toBeNull();
  });
  it("respeta el horario de la tienda (también si cruza medianoche)", () => {
    const tz = "America/Guayaquil"; // UTC-5
    const w = { start: "08:00", end: "22:00" };
    expect(inSendingHours(w, tz, new Date("2026-11-24T15:00:00Z"))).toBe(true); // 10:00
    expect(inSendingHours(w, tz, new Date("2026-11-24T04:00:00Z"))).toBe(false); // 23:00
    expect(
      inSendingHours({ start: "20:00", end: "02:00" }, tz, new Date("2026-11-24T06:00:00Z")),
    ).toBe(true); // 01:00
  });
});

const APP_SECRET = "abcdefabcdefabcdefabcdefabcdef12";
const TOKEN = "EAAG-token-de-prueba-agente-1234";

describe.skipIf(!hasDb)("agente de ventas (webhook → IA → WhatsApp)", () => {
  let app: FastifyInstance;
  let h: ReturnType<typeof client>;
  let scheduler: AgentScheduler | undefined;
  const sent: Record<string, unknown>[] = [];
  let llmCalls = 0;
  let pnid = "";
  let channelId = "";

  const metaFetch = (async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    if (url.includes("fields=display_phone_number"))
      return Response.json({ id: "P", display_phone_number: "+1 555", verified_name: "Test" });
    if (url.endsWith("/messages")) {
      if (body.status === "read") return Response.json({ success: true });
      sent.push(body);
      return Response.json({ messages: [{ id: `wamid.AI${sent.length}` }] });
    }
    return Response.json({ error: { message: "no simulado" } }, { status: 404 });
  }) as unknown as typeof fetch;

  const usage = {
    inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 40, text: 40, reasoning: 0 },
  };
  // Llamadas impares: registra datos con la herramienta; pares: responde al cliente.
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      llmCalls++;
      if (llmCalls % 2 === 1)
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: `call-${llmCalls}`,
              toolName: "update_order_data",
              input: JSON.stringify({ nombre: "Ana Pérez", ciudad: "Quito" }),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: "tool_use" },
          usage,
          warnings: [],
        };
      return {
        content: [
          {
            type: "text" as const,
            text: "¡Gracias Ana! 😊\n\n¿Me confirmas tu dirección en Quito?",
          },
        ],
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
        resolveModel: async () => ({ model, temperature: 0.3, label: "mock/ventas" }),
        onScheduler: (s) => {
          scheduler = s;
        },
      },
    );
    h = client(app);
  });
  afterAll(async () => app.close());

  const webhook = async (id: string, text: string) => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: pnid },
                contacts: [{ wa_id: "593991112233", profile: { name: "Ana" } }],
                messages: [
                  {
                    from: "593991112233",
                    id,
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
      url: `/api/webhooks/whatsapp/${channelId}`,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(raw, APP_SECRET),
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    await scheduler?.whenIdle();
  };
  const texts = (from = 0) => sent.slice(from).map((m) => (m.text as { body: string }).body);

  it("embudo, datos del pedido con herramientas y pausa cuando entra un humano", async () => {
    const o = await h.owner("agente");
    pnid = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const ch = await h.call(o.cookie, "POST", "/api/channels", {
      name: "Principal",
      phoneNumberId: pnid,
      wabaId: "987654321",
      accessToken: TOKEN,
      appSecret: APP_SECRET,
    });
    expect(ch.statusCode, ch.body).toBe(201);
    channelId = ch.json().id;
    const prod = await h.call(o.cookie, "POST", "/api/products", {
      name: "Mega Red",
      price: "27.99",
      currency: "USD",
      initialMessage: "¡Hola! Mega Red es omega 3 de krill 🦐",
      entryQuestion: "¿Para quién sería el producto?",
      triggers: [{ kind: "keyword", value: "mega red" }],
    });
    expect(prod.statusCode, prod.body).toBe(201);

    // 1) Primer mensaje con palabra clave → embudo fijo, sin IA.
    await webhook("wamid.AGIN1", "Hola, quiero info del Mega Red");
    expect(llmCalls).toBe(0);
    expect(texts()).toEqual([
      "¡Hola! Mega Red es omega 3 de krill 🦐",
      "¿Para quién sería el producto?",
    ]);

    // 2) Da sus datos → la IA los registra y contesta en 2 burbujas.
    await webhook("wamid.AGIN2", "Para mí, soy Ana Pérez de Quito");
    expect(llmCalls).toBe(2);
    expect(texts(2)).toEqual(["¡Gracias Ana! 😊", "¿Me confirmas tu dirección en Quito?"]);
    const [conv] = (await h.call(o.cookie, "GET", "/api/conversations")).json();
    expect(conv.checkoutState).toMatchObject({
      nombre: "Ana Pérez",
      ciudad: "Quito",
      etapa: "datos",
    });

    // 3) Un asesor responde desde la bandeja → la IA queda pausada.
    const human = await h.call(o.cookie, "POST", `/api/conversations/${conv.id}/messages`, {
      kind: "text",
      body: "Hola Ana, soy Laura, te ayudo yo",
    });
    expect(human.statusCode, human.body).toBe(201);
    await webhook("wamid.AGIN3", "ok gracias");
    expect(llmCalls).toBe(2);
    const [after] = (await h.call(o.cookie, "GET", "/api/conversations")).json();
    expect(after.botPaused).toBe(true);
  });
  it("recordatorio a los 30 min si el cliente no responde, y se reinicia cuando escribe", async () => {
    const o = await h.owner("seguimiento");
    pnid = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const ch = await h.call(o.cookie, "POST", "/api/channels", {
      name: "Principal",
      phoneNumberId: pnid,
      wabaId: "987654321",
      accessToken: TOKEN,
      appSecret: APP_SECRET,
    });
    channelId = ch.json().id;
    // Horario abierto todo el día para que la prueba no dependa de la hora.
    await h.call(o.cookie, "PUT", "/api/settings", {
      country: "EC",
      currency: "USD",
      timezone: "America/Guayaquil",
      messagingWindow: { start: "00:00", end: "00:00" },
    });
    await h.call(o.cookie, "POST", "/api/products", {
      name: "Colageno",
      price: "19.99",
      currency: "USD",
      initialMessage: "¡Hola! Te cuento del colágeno",
      triggers: [{ kind: "keyword", value: "colageno" }],
      followUps: {
        reminders: [
          { enabled: true, delayMinutes: 30, message: "¿Sigues interesada? 😊" },
          { enabled: true, delayMinutes: 1380, message: "Hoy se cierra tu reserva" },
        ],
        remarketing: [],
      },
    });
    await webhook("wamid.FU1", "info del colageno");
    const before = sent.length;

    const { db, client: pg } = createDb(process.env.DATABASE_URL ?? "");
    const deps = {
      db,
      bus: new RealtimeBus(),
      wa: {
        encryptionKey: process.env.ENCRYPTION_KEY ?? "",
        graphVersion: "v27.0",
        fetchImpl: metaFetch,
      },
      resolveModel: async () => ({ model, temperature: 0.3, label: "mock" }),
    };
    const later = (min: number) => new Date(Date.now() + min * 60_000);
    try {
      await runFollowUps(deps, later(10), [o.org.id]);
      expect(sent.length).toBe(before); // aún no
      await runFollowUps(deps, later(31), [o.org.id]);
      expect(texts(before)).toEqual(["¿Sigues interesada? 😊"]);
      await runFollowUps(deps, later(32), [o.org.id]);
      expect(sent.length).toBe(before + 1); // no repite
      await runFollowUps(deps, later(1381), [o.org.id]);
      expect(texts(before)).toEqual(["¿Sigues interesada? 😊", "Hoy se cierra tu reserva"]);

      // El cliente vuelve a escribir: el contador se reinicia (la IA le responde primero).
      await webhook("wamid.FU2", "sí, cuánto cuesta?");
      const afterReply = sent.length;
      await runFollowUps(deps, later(31), [o.org.id]);
      expect(texts(afterReply)).toEqual(["¿Sigues interesada? 😊"]);
    } finally {
      await pg.end();
    }
  });
});
