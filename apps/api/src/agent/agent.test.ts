import { createDb } from "@chatea/db";
import { MockLanguageModelV4, MockTranscriptionModelV4 } from "ai/test";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RealtimeBus } from "../realtime.js";
import { runLeadHousekeeping } from "../services/leads.js";
import { client, hasDb, testApp } from "../test-helpers.js";
import { sign } from "../whatsapp/signature.js";
import { noProductPrompt } from "./engine.js";
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
      {
        role: "user",
        content: "hola\n[audio que no se pudo transcribir: pide amablemente que lo escriba]",
      },
      { role: "assistant", content: "(asesor humano) te ayudo" },
    ]);
  });
});

describe("cliente sin producto elegido", () => {
  const catalog = [
    {
      id: "p1",
      name: "Mega Red",
      description:
        "**Omega 3 de krill** para el corazón y las articulaciones. Frasco de 60 cápsulas.",
      price: "29.99",
      currency: "USD",
    },
    { id: "p2", name: "Colágeno", description: "", price: "24.00", currency: "USD" },
  ];
  it("lista los productos con su beneficio, el sitio web y pide elegir con select_product", () => {
    const p = noProductPrompt(
      "NatureVita",
      catalog,
      [{ productId: "p1", value: "krill" }],
      "https://naturevitaec.com",
    );
    expect(p).toContain("pregúntale con qué producto le podemos ayudar");
    expect(p).toContain(
      "id=p1 | Mega Red — Omega 3 de krill para el corazón y las articulaciones.",
    );
    expect(p).toContain("palabras: krill");
    expect(p).toContain("id=p2 | Colágeno | 24.00 USD");
    expect(p).toContain("https://naturevitaec.com");
    expect(p).toContain("select_product");
  });
  it("sin sitio web no lo menciona", () => {
    expect(noProductPrompt("NatureVita", catalog, [], null)).not.toContain("catálogo en");
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

  it("un turno colgado no bloquea la conversación para siempre", async () => {
    const errors: string[] = [];
    let n = 0;
    const s = new Scheduler(
      async () => {
        n++;
        if (n === 1) await new Promise(() => {}); // el proveedor nunca responde
      },
      5,
      (e) => errors.push((e as Error).message),
      40,
    );
    s.schedule("t", "c1");
    await new Promise((r) => setTimeout(r, 80));
    expect(errors[0]).toContain("no terminó a tiempo");
    s.schedule("t", "c1"); // el siguiente mensaje sí se atiende
    await new Promise((r) => setTimeout(r, 30));
    await s.whenIdle();
    expect(n).toBe(2);
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
  let failNext = false;
  const typings: Record<string, unknown>[] = [];
  let pnid = "";
  let channelId = "";

  const metaFetch = (async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    if (url.includes("fields=display_phone_number"))
      return Response.json({ id: "P", display_phone_number: "+1 555", verified_name: "Test" });
    // Media de Meta: id → URL temporal → bytes.
    if (url.endsWith("/MEDIA_AUDIO"))
      return Response.json({ url: "https://lookaside.test/audio", mime_type: "audio/ogg" });
    if (url.endsWith("/MEDIA_IMG"))
      return Response.json({ url: "https://lookaside.test/img", mime_type: "image/jpeg" });
    if (url.startsWith("https://lookaside.test/"))
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    if (url.endsWith("/messages")) {
      if (body.status === "read") {
        if (body.typing_indicator) typings.push(body);
        return Response.json({ success: true });
      }
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
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      llmCalls++;
      if (failNext) {
        failNext = false;
        throw new Error("Cuota del proveedor agotada");
      }
      prompts.push(options.prompt);
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
        resolveModel: async () => ({
          model,
          temperature: 0.3,
          label: "mock/ventas",
          kind: "openai" as const,
        }),
        resolveTranscriber: async () =>
          new MockTranscriptionModelV4({
            doGenerate: async () => ({
              text: "quiero dos frascos para mi mamá",
              segments: [],
              language: "es",
              durationInSeconds: 3,
              warnings: [],
              response: { timestamp: new Date(), modelId: "mock-transcribe" },
            }),
          }),
        onScheduler: (s) => {
          scheduler = s;
        },
      },
    );
    h = client(app);
  });
  afterAll(async () => app.close());

  const webhook = async (id: string, text: string, extra?: Record<string, unknown>) => {
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
                    ...extra,
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
    expect(typings).toHaveLength(0); // el embudo fijo no «escribe»
    await webhook("wamid.AGIN2", "Para mí, soy Ana Pérez de Quito");
    // Mientras la IA piensa, el cliente ve «escribiendo…» sobre su último mensaje.
    expect(typings[0]).toMatchObject({
      status: "read",
      message_id: "wamid.AGIN2",
      typing_indicator: { type: "text" },
    });
    expect(llmCalls).toBe(2);
    expect(texts(2)).toEqual(["¡Gracias Ana! 😊", "¿Me confirmas tu dirección en Quito?"]);
    const [conv] = (await h.call(o.cookie, "GET", "/api/conversations")).json();
    expect(conv.checkoutState).toMatchObject({
      nombre: "Ana Pérez",
      ciudad: "Quito",
      etapa: "datos",
    });

    // Lead: entró por la palabra clave (Interesado) y al dar datos pasó a «Datos».
    const leads = (await h.call(o.cookie, "GET", "/api/leads")).json();
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ id: conv.id, stage: "datos", productName: "Mega Red" });
    expect(leads[0].price).toBe("27.99");
    // Moverlo a mano: perdido exige motivo; luego se puede reabrir.
    const noReason = await h.call(o.cookie, "PATCH", `/api/leads/${conv.id}`, { stage: "perdido" });
    expect(noReason.statusCode).toBe(400);
    expect(
      (
        await h.call(o.cookie, "PATCH", `/api/leads/${conv.id}`, {
          stage: "perdido",
          lostReason: "precio",
        })
      ).statusCode,
    ).toBe(200);
    const lostLead = (await h.call(o.cookie, "GET", "/api/leads")).json()[0];
    expect(lostLead).toMatchObject({ stage: "perdido", lostReason: "precio" });
    await h.call(o.cookie, "PATCH", `/api/leads/${conv.id}`, { stage: "datos" });
    // Un perdido no vuelve solo al embudo: lo reabrió el asesor.
    expect((await h.call(o.cookie, "GET", "/api/leads")).json()[0]).toMatchObject({
      stage: "datos",
      lostReason: null,
    });

    // El proveedor de IA falla: no responde, y la ficha dice por qué.
    failNext = true;
    const before = sent.length;
    await webhook("wamid.AGINX", "¿y cuánto cuesta?");
    expect(sent.length).toBe(before);
    const failed = (await h.call(o.cookie, "GET", `/api/conversations/${conv.id}`)).json();
    expect(failed.lastAgentRun).toMatchObject({ status: "error" });
    expect(failed.lastAgentRun.error).toContain("Cuota del proveedor agotada");
    llmCalls = 2;

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

      // Lead interesado que no vuelve a escribir: a las 48 h pasa a perdido («No responde»)…
      const [fc] = (await h.call(o.cookie, "GET", "/api/conversations")).json();
      await h.call(o.cookie, "PATCH", `/api/leads/${fc.id}`, { stage: "interesado" });
      await runLeadHousekeeping(db, later(47 * 60));
      expect((await h.call(o.cookie, "GET", "/api/leads")).json()[0].stage).toBe("interesado");
      await runLeadHousekeeping(db, later(49 * 60));
      expect((await h.call(o.cookie, "GET", "/api/leads")).json()[0]).toMatchObject({
        stage: "perdido",
        lostReason: "no_responde",
      });
      // …y si escribe otra vez vuelve a Interesado.
      await webhook("wamid.FU3", "hola, sigo interesada");
      const [back] = (await h.call(o.cookie, "GET", "/api/leads")).json();
      expect(back.stage === "interesado" || back.stage === "datos").toBe(true);
      expect(back.lostReason).toBeNull();

      // Perdido: a las 48 h el lead se borra (la conversación); antes, no.
      await h.call(o.cookie, "PATCH", `/api/leads/${back.id}`, {
        stage: "perdido",
        lostReason: "precio",
      });
      await runLeadHousekeeping(db, later(47 * 60));
      expect((await h.call(o.cookie, "GET", "/api/leads")).json()).toHaveLength(1);
      const r = await runLeadHousekeeping(db, later(49 * 60));
      expect(r.deleted).toBeGreaterThanOrEqual(1);
      expect((await h.call(o.cookie, "GET", "/api/leads")).json()).toHaveLength(0);
      expect((await h.call(o.cookie, "GET", "/api/conversations")).json()).toHaveLength(0);
    } finally {
      await pg.end();
    }
  });
  it("transcribe audios y le pasa las imágenes al modelo", async () => {
    const o = await h.owner("multimedia");
    pnid = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const ch = await h.call(o.cookie, "POST", "/api/channels", {
      name: "Principal",
      phoneNumberId: pnid,
      wabaId: "987654321",
      accessToken: TOKEN,
      appSecret: APP_SECRET,
    });
    channelId = ch.json().id;
    const before = prompts.length;
    await webhook("wamid.MM1", "", { type: "audio", audio: { id: "MEDIA_AUDIO", voice: true } });
    await webhook("wamid.MM2", "", { type: "image", image: { id: "MEDIA_IMG", caption: "así?" } });

    const all = JSON.stringify(prompts.slice(before));
    expect(all).toContain("quiero dos frascos para mi mamá");
    expect(all).toContain('"type":"file"'); // la imagen llegó al modelo
    const [conv] = (await h.call(o.cookie, "GET", "/api/conversations")).json();
    const msgs = (await h.call(o.cookie, "GET", `/api/conversations/${conv.id}/messages`)).json();
    const list = Array.isArray(msgs) ? msgs : msgs.messages;
    const audio = list.find((m: { type: string }) => m.type === "audio");
    expect(audio.data.transcript).toBe("quiero dos frascos para mi mamá");
  });
});

describe.skipIf(!hasDb)("banco de pruebas del agente", () => {
  let app: FastifyInstance;
  let h: ReturnType<typeof client>;
  let customerTurns = 0;
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };
  const text = (t: string) => ({
    content: [{ type: "text" as const, text: t }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage,
    warnings: [],
  });
  // Un solo modelo hace de cliente, agente y juez según lo que se le pide.
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const prompt = JSON.stringify(options.prompt);
      if (options.responseFormat?.type === "json")
        return text(
          JSON.stringify({
            checks: [
              { criterio: "a", cumple: true, detalle: "ok" },
              { criterio: "b", cumple: false, detalle: "inventó un precio" },
            ],
            resumen: "Vende bien pero inventó un precio.",
          }),
        );
      if (prompt.includes("Eres un CLIENTE"))
        return text(++customerTurns > 2 ? "[FIN]" : `mensaje del cliente ${customerTurns}`);
      return text("Claro 😊\n\n¿De qué ciudad nos escribes?");
    },
  });

  beforeAll(async () => {
    app = await testApp(
      {},
      { resolveModel: async () => ({ model, temperature: 0.3, label: "mock/ventas" }) },
    );
    h = client(app);
  });
  afterAll(async () => app.close());

  it("chat manual y conversación simulada con veredicto, sin enviar nada", async () => {
    const o = await h.owner("banco");
    const prod = await h.call(o.cookie, "POST", "/api/products", {
      name: "Mega Red",
      price: "27.99",
      currency: "USD",
      initialMessage: "¡Hola! Te cuento de Mega Red",
    });
    const productId = prod.json().id;

    const first = await h.call(o.cookie, "POST", "/api/agent/chat", { productId, history: [] });
    expect(first.json().replies).toEqual([
      { role: "agente", text: "¡Hola! Te cuento de Mega Red" },
    ]);
    const turn = await h.call(o.cookie, "POST", "/api/agent/chat", {
      productId,
      history: [...first.json().replies, { role: "cliente", text: "precio?" }],
    });
    expect(turn.json().replies.map((r: { text: string }) => r.text)).toEqual([
      "Claro 😊",
      "¿De qué ciudad nos escribes?",
    ]);

    const sim = await h.call(o.cookie, "POST", "/api/agent/simulate", {
      productId,
      persona: "Cliente apurado que quiere precio",
      maxTurns: 5,
    });
    expect(sim.statusCode, sim.body).toBe(200);
    const r = sim.json();
    expect(r.transcript.filter((m: { role: string }) => m.role === "cliente")).toHaveLength(2);
    expect(r.verdict.passed).toBe(false);
    expect(r.verdict.checks[1].detalle).toContain("inventó");

    const other = await h.owner("ajeno");
    const denied = await h.call(other.cookie, "POST", "/api/agent/chat", { productId });
    expect(denied.statusCode).toBe(404); // RLS: otra tienda no ve el producto
  });
});
