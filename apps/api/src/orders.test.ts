import { createHash } from "node:crypto";
import {
  displayPhone,
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
import {
  callesDe,
  deCiudad,
  fonetica,
  Geocoder,
  referenciasDeLugar,
} from "./carriers/agencias-geo.js";
import { findAgencies, resolveAgency } from "./carriers/servientrega.js";
import type { DropiApi } from "./dropi/client.js";
import { DropiMcpClient, parseToon, REAUTH_MESSAGE } from "./dropi/mcp.js";
import {
  evaluateGlobalRisk,
  evaluateRisk,
  findDuplicate,
  parseDropiWebhook,
} from "./orders/service.js";
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
    expect(nationalPhone("593991112233", "EC")).toBe("991112233");
    expect(nationalPhone("0991112233", "EC")).toBe("991112233"); // como lo guarda Dropi
    expect(nationalPhone("573001112233", "CO")).toBe("3001112233");
  });

  it("teléfono con el código de país separado", () => {
    expect(formatPhone("593991234567")).toBe("+593 991234567");
    expect(formatPhone("19195551234")).toBe("+1 9195551234");
    expect(formatPhone("573001112233")).toBe("+57 3001112233");
    expect(formatPhone("50760001111")).toBe("+507 60001111");
    // Teléfono del pedido (como lo escribió el cliente) con el código del WhatsApp del contacto.
    expect(displayPhone("0991234567", "593987654321")).toBe("+593 991234567");
    expect(displayPhone("991234567", "593987654321")).toBe("+593 991234567");
    expect(displayPhone("593991234567", "593987654321")).toBe("+593 991234567");
    expect(displayPhone("8515551234", "18515550000")).toBe("+1 8515551234");
    expect(displayPhone("+57 300 111 2233")).toBe("+57 3001112233");
    expect(displayPhone("")).toBe("");
  });

  it("retiro en agencia reemplaza la dirección", () => {
    const base = { nombre: "Ana", ciudad: "Ambato", cantidad: "1" };
    expect(missingCheckoutFields(base)).toEqual(["direccion"]);
    expect(missingCheckoutFields({ ...base, agencia: "AMBATO_CASTILLO" })).toEqual([]);
    // Tienda que solo envía a agencia: la agencia es obligatoria y la dirección no.
    expect(missingCheckoutFields(base, { agencyOnly: true })).toEqual(["agencia"]);
    expect(
      missingCheckoutFields({ ...base, agencia: "AMBATO_CASTILLO" }, { agencyOnly: true }),
    ).toEqual([]);
  });

  // Respuestas del servicio de agencias (formas reales de servientrega.neolabsgroup.io).
  const ag = (nombre: string, sector: string, retiro = "SI", ciudad = "AMBATO") => ({
    nombre,
    ciudad,
    provincia: "TUNGURAHUA",
    direccion: `DIR ${nombre}`,
    sector,
    telefono: "03-3732000",
    horario_lun_vie: "09H00 A 18H00",
    horario_fin_semana: "09H00 A 13H00",
    entrega_en_oficina: retiro,
  });
  const agencyService = (answers: Record<string, object>) => {
    const asked: string[] = [];
    const f = (async (url: string) => {
      const texto = new URL(url).searchParams.get("texto") ?? "";
      asked.push(texto);
      return Response.json(
        answers[texto] ?? { ciudad_detectada: null, resultados: [], mensaje: "sin ciudad" },
      );
    }) as unknown as typeof fetch;
    return { f, asked };
  };

  // Ciudades inventadas (no están en el directorio): prueban solo el buscador del servicio.
  it("agencias: modos del buscador del servicio", async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      ag(`ZZLANDIA_AG${i}`, "NORTE", "SI", "ZZLANDIA"),
    );
    const { f, asked } = agencyService({
      "Qqville norte": {
        ciudad_detectada: "qqville",
        modo: "ciudad_sector",
        total_ciudad: 9,
        resultados: [
          ag("QQVILLE_NORTE", "NORTE", "NO", "QQVILLE"),
          ag("QQVILLE_PARQUE", "CENTRO", "SI", "QQVILLE"),
        ],
      },
      Wwpueblo: {
        ciudad_detectada: "wwpueblo",
        modo: "solo_ciudad",
        resultados: [
          ag("WWPUEBLO_CENTRO", "CENTRO", "SI", "WWPUEBLO"),
          ag("WWPUEBLO_SUR", "SUR", "SI", "WWPUEBLO"),
          ag("WWPUEBLO_X", "SUR", "NO", "WWPUEBLO"),
        ],
      },
      Zzlandia: { ciudad_detectada: "zzlandia", modo: "solo_ciudad", resultados: many },
      Yyunica: {
        ciudad_detectada: "yyunica",
        modo: "unica",
        resultados: [ag("YYUNICA", "CENTRO", "SI", "YYUNICA")],
      },
      // Ninguna del sector entrega: se buscan las de la ciudad, primero las del mismo sector.
      "Qqville izamba": {
        ciudad_detectada: "qqville",
        modo: "ciudad_sector",
        resultados: [ag("QQVILLE_IZAMBA", "NORTE", "NO", "QQVILLE")],
      },
      qqville: {
        ciudad_detectada: "qqville",
        modo: "solo_ciudad",
        resultados: [
          ag("QQVILLE_SUR", "SUR", "SI", "QQVILLE"),
          ag("QQVILLE_PINLLO", "NORTE", "SI", "QQVILLE"),
          ag("QQVILLE_IZAMBA", "NORTE", "NO", "QQVILLE"),
        ],
      },
    });
    const norte = await findAgencies("https://ag.test", "Qqville norte", f);
    expect(norte.estado).toBe("cercanas");
    expect(norte.agencias.map((a) => a.nombre)).toEqual(["QQVILLE_PARQUE"]);
    expect(norte.nota).toContain("Norte");
    expect(norte.agencias[0]).toMatchObject({
      registro: "QQVILLE_PARQUE---CENTRO---DIR QQVILLE_PARQUE",
      nombreCorto: "Parque",
    });
    expect(await findAgencies("https://ag.test", "Wwpueblo", f)).toMatchObject({
      estado: "lista",
      totalCiudad: 2,
    });
    expect((await findAgencies("https://ag.test", "Zzlandia", f)).estado).toBe("falta_sector");
    expect((await findAgencies("https://ag.test", "Yyunica", f)).estado).toBe("unica");
    expect((await findAgencies("https://ag.test", "Nada", f)).estado).toBe("sin_ciudad");
    const izamba = await findAgencies("https://ag.test", "Qqville izamba", f);
    expect(izamba.agencias.map((a) => a.nombre)).toEqual(["QQVILLE_PINLLO", "QQVILLE_SUR"]);
    expect(asked).toContain("qqville");

    // La elección se valida contra lo mostrado (por registro o por nombre).
    expect(
      (await resolveAgency("https://ag.test", norte.agencias[0]?.registro ?? "", f))?.ciudad,
    ).toBe("QQVILLE");
    expect((await resolveAgency("https://ag.test", "WWPUEBLO_SUR", f))?.sector).toBe("SUR");
    expect(await resolveAgency("https://ag.test", "AGENCIA_INVENTADA---X---Y", f)).toBeNull();
    // Del directorio aunque no se haya mostrado (p. ej. tras reiniciar el API).
    expect((await resolveAgency("https://ag.test", "AMBATO_PINLLO", f))?.ciudad).toBe("AMBATO");
  });

  it("agencias como el bot: nombre escrito, agencia sin retiro, referencia en el mapa", async () => {
    const { f, asked } = agencyService({});
    // «Guachi grande» = AMBATO_HUACHI GRANDE (fonética), sin llamar al servicio.
    const named = await findAgencies("https://ag.test", "en ambato por la guachi grande", f);
    expect(named.estado).toBe("nombrada");
    expect(named.agencias.map((a) => a.nombre)).toEqual(["AMBATO_HUACHI GRANDE"]);
    // Con la ciudad ya registrada en el pedido basta el nombre de la zona.
    const anchored = await findAgencies("https://ag.test", "huachi solis", f, { ciudad: "Ambato" });
    expect(anchored.agencias[0]?.nombre).toBe("AMBATO_HUACHI SOLIS");
    // Ficoa no entrega paquetes: las más cercanas a ella, con distancia.
    const ficoa = await findAgencies("https://ag.test", "Ambato Ficoa", f);
    expect(ficoa.estado).toBe("cercanas");
    expect(ficoa.nota).toContain("Ficoa");
    expect(ficoa.agencias).toHaveLength(3);
    expect(ficoa.agencias.every((a) => a.entregaEnOficina && a.nombre !== "AMBATO_FICOA")).toBe(
      true,
    );
    expect(asked).toEqual([]);
    // El servicio no responde: lista de la ciudad desde el directorio.
    const down = (async () => {
      throw new Error("caído");
    }) as unknown as typeof fetch;
    expect(await findAgencies("https://ag.test", "Pelileo", down)).toMatchObject({
      estado: "unica",
      agencias: [{ nombre: "PELILEO_PRINCIPAL" }],
    });

    // Referencia («cerca del colegio X») → punto en el mapa → agencias por distancia.
    const castillo = deCiudad("AMBATO").find((a) => a.nombre === "AMBATO_CASTILLO");
    const geoAsked: string[] = [];
    const geoFetch = (async (url: string) => {
      geoAsked.push(url);
      return Response.json({
        features: [
          {
            geometry: { coordinates: [castillo?.lon, castillo?.lat] },
            properties: { name: "Colegio Bolívar", type: "house" },
          },
        ],
      });
    }) as unknown as typeof fetch;
    const many = deCiudad("AMBATO", true).map((a) => ({
      nombre: a.nombre,
      ciudad: a.ciudad,
      sector: a.sector,
      direccion: a.direccion,
      entrega_en_oficina: "SI",
    }));
    const svc = agencyService({
      "Ambato, cerca del colegio Bolivar": {
        ciudad_detectada: "ambato",
        modo: "solo_ciudad",
        resultados: many,
      },
    });
    const geo = await findAgencies("https://ag.test", "Ambato, cerca del colegio Bolivar", svc.f, {
      geocoder: new Geocoder(geoFetch),
      nombreCliente: "Ana Pérez",
    });
    expect(geo.estado).toBe("cercanas");
    expect(geo.agencias[0]?.nombre).toBe("AMBATO_CASTILLO");
    expect(geo.nota).toContain("Colegio Bolívar");
    expect(new URL(geoAsked[0] ?? "").searchParams.get("q")).toBe(
      "cerca del colegio bolivar, AMBATO",
    );
    expect(geoAsked.join(" ")).not.toMatch(/ana|perez/i);
  });

  it("referencias de lugar y cruces de calles como el bot", () => {
    expect(callesDe("calle garcia moreno y martinez mera 469")).toEqual([
      "garcia moreno",
      "martinez mera",
    ]);
    expect(callesDe("9 de octubre y boyaca")).toEqual(["9 de octubre", "boyaca"]);
    expect(callesDe("cerca del parque")).toEqual([]);
    // Sin ciudad ni el nombre del cliente; los mensajes sin pista de lugar se ignoran.
    expect(
      referenciasDeLugar(
        ["hola buenas", "soy Ana Pérez, vivo cerca del parque Cevallos", "Ambato sector Ficoa"],
        "AMBATO",
        "Ana Pérez",
      ),
    ).toEqual(["cerca del parque cevallos", "ficoa"]);
    expect(fonetica("Guachi Grande")).toBe(fonetica("HUACHI GRANDE"));
    expect(fonetica("la mena dos")).toBe(fonetica("MENA 2"));
  });

  it("tienda solo con agencia: la IA busca, el cliente elige y se confirma sin dirección", async () => {
    const { f } = agencyService({
      "Wwpueblo centro": {
        ciudad_detectada: "wwpueblo",
        modo: "ciudad_sector",
        resultados: [ag("WWPUEBLO_CENTRO", "CENTRO", "SI", "WWPUEBLO")],
      },
    });
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const steps: [string, object][] = [
      ["update_order_data", { nombre: "Ana Pérez", cantidad: "1" }],
      ["confirm_order", {}], // sin agencia todavía: no se puede
      ["find_agencies", { texto: "Wwpueblo centro" }],
      ["choose_agency", { registro: "WWPUEBLO_CENTRO---CENTRO---DIR WWPUEBLO_CENTRO" }],
      ["confirm_order", {}],
    ];
    let n = 0;
    const results: unknown[] = [];
    let system = "";
    const model = new MockLanguageModelV4({
      doGenerate: async (opts) => {
        if (n === 0) system = JSON.stringify(opts.prompt);
        if (n > 0) results.push(opts.prompt.at(-1));
        const s = steps[n++];
        if (!s)
          return {
            content: [{ type: "text" as const, text: "Listo, retira en Baños Centro" }],
            finishReason: { unified: "stop" as const, raw: "stop" },
            usage,
            warnings: [],
          };
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: `t${n}`,
              toolName: s[0],
              input: JSON.stringify(s[1]),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: "tool_use" },
          usage,
          warnings: [],
        };
      },
    });
    const saved: Record<string, string>[] = [];
    const turn = await runAgentTurn({
      resolved: { model, temperature: 0, label: "mock" },
      prompt: { text: "Vende", media: [] },
      agencyOnly: true,
      hasProduct: true,
      checkout: {},
      context: { now: new Date(), timezone: "America/Guayaquil", customerName: "Ana", phone: "1" },
      messages: [{ role: "user", content: "Quiero uno, vivo en Wwpueblo centro" }],
      io: {
        saveCheckout: async (st) => {
          saved.push({ ...st });
        },
        handoff: async () => {},
        selectProduct: async () => true,
        checkCity: async () => ({
          ok: true,
          city: "BANOS DE AGUA SANTA",
          department: "TUNGURAHUA",
        }),
        findAgencies: (t) => findAgencies("https://ag.test", t, f),
        chooseAgency: (v) => resolveAgency("https://ag.test", v, f),
      },
    });
    expect(system).toContain("ENTREGA EN AGENCIA SERVIENTREGA");
    // Flujo completo hasta el cierre, y en la posventa no se deriva ni se vuelve a vender.
    expect(system).toContain("Resumen");
    expect(system).toContain("Después de confirmar");
    expect(system).toContain("eso lo ve logística");
    expect(JSON.stringify(results[1])).toContain("agencia"); // primer confirm: falta la agencia
    expect(turn.calls.map((c) => c.name)).toEqual(steps.map((s) => s[0]));
    expect(turn.state).toMatchObject({
      agencia: "WWPUEBLO_CENTRO---CENTRO---DIR WWPUEBLO_CENTRO",
      ciudad: "BANOS DE AGUA SANTA",
      provincia: "TUNGURAHUA",
      etapa: "confirmado",
    });
    expect(turn.state.direccion).toBeUndefined();
  });

  it("la IA busca agencias de Servientrega y las ofrece", async () => {
    const agencyFetch = (async (url: string) => {
      expect(url).toBe("https://agencias.test/buscar?texto=Ambato%20centro");
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
    const r = await findAgencies("https://agencias.test/", "Ambato centro", agencyFetch);
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
                input: JSON.stringify({ texto: "Ambato centro" }),
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

  it("duplicado en Dropi: mismo teléfono, activo y reciente", async () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 10 * 86400_000).toISOString();
    const fake = (mode: "token" | "mcp", list: object[]) =>
      ({
        mode,
        key: `k-${mode}-${Math.random()}`,
        country: "EC",
        departments: async () => [],
        searchCities: async () => [],
        createOrder: async () => ({ id: "1", status: "" }),
        listOrders: async () => list,
      }) as unknown as DropiApi;
    const o = (id: string, phone: string, status: string, createdAt: string) => ({
      id,
      phone,
      status,
      createdAt,
    });
    const t = fake("token", [
      o("1", "0991112233", "CANCELADO", now),
      o("2", "0991112233", "ENTREGADO", old),
      o("3", "0991112233", "PENDIENTE", now),
    ]);
    expect((await findDuplicate(t, "593991112233", 3))?.id).toBe("3");
    expect(await findDuplicate(t, "593991112233", 0)).toBeNull();
    const t2 = fake("token", [o("4", "991112233", "GUIA_GENERADA", "")]); // sin fecha: no se afirma
    expect(await findDuplicate(t2, "593991112233", 3)).toBeNull();
    const m = fake("mcp", [o("5", "991112233", "GUIA_GENERADA", "")]); // MCP ya filtra por fecha
    expect((await findDuplicate(m, "593991112233", 3))?.id).toBe("5");
  });

  it("Dropi MCP: «token has been revoked» como error de herramienta → renueva o pide reautorizar", async () => {
    const valid = new Set(["at-ok"]);
    let refreshOk = true;
    const f = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/oauth/token")) {
        if (!refreshOk) return Response.json({ error: "invalid_grant" }, { status: 400 });
        valid.add("at-new");
        return Response.json({ access_token: "at-new", refresh_token: "rt-new", expires_in: 3600 });
      }
      const bearer = ((init?.headers ?? {}) as Record<string, string>).Authorization?.slice(7);
      const msg = JSON.parse(String(init?.body));
      if (!("id" in msg)) return new Response(null, { status: 202 });
      if (msg.method === "initialize")
        return Response.json({ jsonrpc: "2.0", id: msg.id, result: {} });
      // Dropi responde 200 con isError cuando el acceso ya no sirve.
      if (!valid.has(bearer ?? ""))
        return Response.json({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: "sesión MCP no válida (token has been revoked): el usuario debe desconectar y volver a conectar el conector",
              },
            ],
          },
        });
      return Response.json({
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: "items[1]{id,name}:\n  43,PICHINCHA" }] },
      });
    }) as unknown as typeof fetch;
    const tokens = {
      clientId: "c",
      accessToken: "at-viejo",
      refreshToken: "rt",
      expiresAt: Date.now() + 3600_000,
    };
    const saved: string[] = [];
    const lost: string[] = [];
    const client = new DropiMcpClient(
      tokens,
      "EC",
      async (t) => {
        saved.push(t.accessToken);
      },
      f,
      async (m) => {
        lost.push(m);
      },
    );
    expect((await client.departments()).map((d) => d.name)).toEqual(["PICHINCHA"]);
    expect(saved).toEqual(["at-new"]); // se renovó y se guardó solo
    expect(lost).toEqual([]);

    // Si tampoco se puede renovar: mensaje claro y la tienda queda marcada para reautorizar.
    refreshOk = false;
    valid.clear();
    const stale = new DropiMcpClient(
      { ...tokens, refreshToken: "rt-2" },
      "EC",
      async () => {},
      f,
      async (m) => {
        lost.push(m);
      },
    );
    await expect(stale.departments()).rejects.toThrow(REAUTH_MESSAGE);
    expect(lost).toEqual([REAUTH_MESSAGE]);
  });

  it("huella global de Dropi: sin pedidos finalizados nunca bloquea", () => {
    const rules = { enabled: true, minDeliveryRate: 50, minOrders: 2 };
    const fp = (d: number | null, r: number | null, found = true) => ({
      found,
      buyerType: "Comprador",
      riskLabel: "Riesgo",
      deliveryProbability: d,
      returnProbability: r,
      message: "",
    });
    expect(evaluateGlobalRisk(fp(30, 60), rules).blocked).toBe(true);
    expect(evaluateGlobalRisk(fp(80, 10), rules).blocked).toBe(false);
    expect(evaluateGlobalRisk(fp(0, 0), rules).blocked).toBe(false); // sin datos
    expect(evaluateGlobalRisk(fp(null, null, false), rules).blocked).toBe(false);
    expect(evaluateGlobalRisk(fp(30, 60), { ...rules, enabled: false }).blocked).toBe(false);
  });

  it("lee el formato TOON que devuelven las herramientas MCP de Dropi", () => {
    // Salidas reales de list_departments, search_cities, list_orders y get_order.
    expect(
      parseToon(
        'items[2]{id,country_id,name,department_code}:\n  43,1,PICHINCHA,"1040"\n  61,1,GALAPAGOS,""\ncount: 2',
      ),
    ).toEqual({
      items: [
        { id: 43, country_id: 1, name: "PICHINCHA", department_code: "1040" },
        { id: 61, country_id: 1, name: "GALAPAGOS", department_code: "" },
      ],
      count: 2,
    });
    const orders = parseToon(
      [
        "items[1]{order_id,status,customer_name,customer_phone,city,total}:",
        '  "8112531",GUIA_GENERADA,Lizbeth Torres,"986015695",JOYA DE LOS SACHAS,38',
        "count: 1",
        "applied_range:",
        "  from: 2026-10-26",
        "  defaulted: true",
      ].join("\n"),
    );
    expect(orders.items).toEqual([
      {
        order_id: "8112531",
        status: "GUIA_GENERADA",
        customer_name: "Lizbeth Torres",
        customer_phone: "986015695",
        city: "JOYA DE LOS SACHAS",
        total: 38,
      },
    ]);
    expect(orders.applied_range).toEqual({ from: "2026-10-26", defaulted: true });
    const order = parseToon(
      [
        'order_id: "8112531"',
        "status: GUIA_GENERADA",
        "customer:",
        "  name: Lizbeth Torres",
        '  phone: "986015695"',
        "items[1]{product_id,product_name,qty,unit_price,subtotal}:",
        "  186883,PROMOCION DRENAJE LINFATICO 30 ML  2X1,2,15,30",
        "total: 38",
        'tracking_code: "1800239264"',
      ].join("\n"),
    );
    expect(order).toMatchObject({
      order_id: "8112531",
      status: "GUIA_GENERADA",
      customer: { name: "Lizbeth Torres", phone: "986015695" },
      tracking_code: "1800239264",
    });
    expect((order.items as { qty: number }[])[0]?.qty).toBe(2);
  });
});

const APP_SECRET = "abcdefabcdefabcdefabcdefabcdef12";
const TOKEN = "EAAG-token-de-prueba-pedidos-1234";
const DROPI_TOKEN = "tok-dropi-de-prueba";

describe.skipIf(!hasDb)("pedidos y Dropi (IA confirma → Dropi → webhook)", () => {
  let app: FastifyInstance;
  let h: ReturnType<typeof client>;
  let scheduler: AgentScheduler | undefined;
  let dropiSync: (() => Promise<{ updated: number }>) | undefined;
  const dropiOrders: Record<string, unknown>[] = [];
  let history: { phone: string; status: string }[] = [];

  const metaFetch = (async (url: string) => {
    if (url.includes("fields=display_phone_number"))
      return Response.json({ id: "P", display_phone_number: "+1 555", verified_name: "Test" });
    if (url.endsWith("/messages"))
      return Response.json({ messages: [{ id: `wamid.X${Date.now()}${Math.random()}` }] });
    return Response.json({ success: true });
  }) as unknown as typeof fetch;

  // Dropi MCP falso: OAuth con PKCE + JSON-RPC; las herramientas responden en TOON.
  const run = Date.now().toString(36);
  const mcp = {
    challenge: "",
    valid: new Set<string>(),
    created: [] as Record<string, unknown>[],
    status: {} as Record<string, string>,
    refreshes: 0,
    fpPhones: [] as string[],
    listArgs: [] as Record<string, unknown>[],
    productSearches: [] as string[],
    quotes: [] as Record<string, unknown>[],
    citySearches: [] as string[],
  };
  const toon = (text: string) => ({ content: [{ type: "text", text }] });
  const mcpFetch = async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/oauth/register") return Response.json({ client_id: "selichat-test" });
    if (path === "/oauth/token") {
      const f = new URLSearchParams(String(init?.body));
      if (f.get("grant_type") === "authorization_code") {
        const verifier = f.get("code_verifier") ?? "";
        const pkceOk = createHash("sha256").update(verifier).digest("base64url") === mcp.challenge;
        if (f.get("code") !== "codigo-ok" || !pkceOk)
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        mcp.valid.add(`at-${run}-1`);
        return Response.json({
          access_token: `at-${run}-1`,
          refresh_token: `rt-${run}-1`,
          expires_in: 3600,
        });
      }
      if (f.get("refresh_token") === `rt-${run}-1`) {
        mcp.refreshes++;
        mcp.valid.add(`at-${run}-2`);
        return Response.json({
          access_token: `at-${run}-2`,
          refresh_token: `rt-${run}-2`,
          expires_in: 3600,
        });
      }
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    const bearer = ((init?.headers ?? {}) as Record<string, string>).Authorization?.replace(
      "Bearer ",
      "",
    );
    if (!bearer || !mcp.valid.has(bearer)) return new Response("no bearer token", { status: 401 });
    const msg = JSON.parse(String(init?.body));
    if (!("id" in msg)) return new Response(null, { status: 202 });
    const reply = (result: unknown) =>
      Response.json(
        { jsonrpc: "2.0", id: msg.id, result },
        { headers: { "mcp-session-id": "s1" } },
      );
    if (msg.method === "initialize")
      return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} } });
    const a = msg.params.arguments as Record<string, unknown>;
    switch (msg.params.name) {
      case "list_departments":
        return reply(
          toon(
            'items[2]{id,country_id,name,department_code}:\n  43,1,PICHINCHA,"1040"\n  44,1,GUAYAS,"1031"\ncount: 2',
          ),
        );
      case "search_cities": {
        mcp.citySearches.push(String(a.name));
        const q = String(a.name).toUpperCase();
        const all = [
          [802, 43, "QUITO"],
          [807, 43, "PUERTO QUITO"],
          [900, 44, "GUAYAQUIL"],
        ].filter((c) => String(c[2]).includes(q));
        const rowsTxt = all.map((c) => `  ${c[0]},${c[1]},${c[2]},"201001001001","2"`);
        return reply(
          toon(
            [`items[${all.length}]{id,department_id,name,cod_dane,zip_code}:`, ...rowsTxt].join(
              "\n",
            ),
          ),
        );
      }
      case "create_order": {
        mcp.created.push(a);
        const id = String(9000 + mcp.created.length);
        mcp.status[id] = "PENDIENTE CONFIRMACION";
        // Esta respuesta llega como evento SSE.
        const body = JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: toon(`order_id: "${id}"\nstatus: PENDIENTE CONFIRMACION\ntotal: 49.99`),
        });
        return new Response(`event: message\ndata: ${body}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      }
      case "get_order": {
        const st = mcp.status[String(a.id)] ?? "PENDIENTE";
        return reply(
          toon(
            `order_id: "${a.id}"\nstatus: ${st}\ncustomer:\n  name: Ana\ntotal: 49.99\ntracking_code: "${st === "GUIA_GENERADA" ? "1800" : ""}"`,
          ),
        );
      }
      case "list_orders": {
        mcp.listArgs.push(a);
        // Otro cliente con pedido activo y uno del mismo teléfono ya cancelado: no es duplicado.
        return reply(
          toon(
            'items[2]{order_id,status,customer_name,customer_phone,city,total,created_at}:\n  "7001",PENDIENTE,Otro Cliente,"987654321",QUITO,20,"2026-11-24T10:00:00"\n  "7002",CANCELADO,Ana,"991112233",QUITO,20,"2026-11-24T09:00:00"\ncount: 2',
          ),
        );
      }
      case "list_products":
        mcp.productSearches.push(String(a.search));
        return reply(
          toon(
            "items[1]{id,name,sale_price,suggested_price,stock}:\n  777,MEGA RED OMEGA 3,10.5,27.99,50\ncount: 1\ncurrency: USD",
          ),
        );
      case "quote_shipping":
        mcp.quotes.push(a);
        return reply(
          toon(
            'currency: USD\nitems[2]{carrier,shipping_cost,error}:\n  SERVIENTREGA,4.25,""\n  LAARCOURIER,null,Sin cobertura',
          ),
        );
      case "list_carriers":
        return reply(toon("items[1]{id,name}:\n  3,SERVIENTREGA"));
      case "get_customer_fingerprint_profile":
        mcp.fpPhones.push(String(a.phone));
        return reply(
          toon(
            "buyer_type: Comprador frecuente\nrisk_label: Riesgo bajo\ndelivery_probability: 85\nreturn_probability: 10",
          ),
        );
    }
    return reply({ content: [{ type: "text", text: "herramienta desconocida" }], isError: true });
  };

  // Dropi falso: imita la API de integraciones (cabecera dropi-integration-key).
  const dropiFetch = (async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://mcp.dropi.co/")) return mcpFetch(url, init);
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
        onDropiSync: (r) => {
          dropiSync = r;
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
      phone: "991112233",
      rate_type: "CON RECAUDO",
      status: "PENDIENTE CONFIRMACION",
      products: [{ id: 777, quantity: 2 }],
    });

    // La venta cerrada deja el lead en «Ganado» con el valor del pedido.
    const [lead] = (await h.call(s.cookie, "GET", "/api/leads")).json();
    expect(lead).toMatchObject({ stage: "ganado", orderTotal: "49.99" });

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
    // Entregado: el lead pasa a «Cerrado» (sale del tablero a las 72 h).
    expect((await h.call(s.cookie, "GET", "/api/leads")).json()[0].stage).toBe("cerrado");
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
      mode: "off",
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

  it("conecta con la cuenta de Dropi (MCP): OAuth, subida, huella global y estados", async () => {
    const o = await h.owner("mcp");
    const start = await h.call(o.cookie, "POST", "/api/integrations/dropi/oauth/start", {
      country: "EC",
      options: { autoUpload: true, risk: { enabled: true, minDeliveryRate: 50, minOrders: 2 } },
    });
    expect(start.statusCode, start.body).toBe(200);
    const auth = new URL(start.json().url);
    expect(`${auth.origin}${auth.pathname}`).toBe("https://mcp.dropi.co/login/authorize");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3100/api/integrations/dropi/oauth/callback",
    );
    mcp.challenge = auth.searchParams.get("code_challenge") ?? "";
    const state = encodeURIComponent(auth.searchParams.get("state") ?? "");
    const callback = (cookie: string, code = "codigo-ok") =>
      app.inject({
        method: "GET",
        url: `/api/integrations/dropi/oauth/callback?code=${code}&state=${state}`,
        headers: { cookie },
      });

    // Otra tienda no puede quedarse con la autorización; un código falso no conecta.
    const other = await h.owner("ajena");
    const stolen = await callback(other.cookie);
    expect(stolen.statusCode).toBe(302);
    expect(stolen.headers.location).toContain("dropi_error=");
    expect((await callback(o.cookie, "codigo-falso")).headers.location).toContain("dropi_error=");

    const ok = await callback(o.cookie);
    expect(ok.statusCode).toBe(302);
    expect(ok.headers.location).toBe(
      "http://localhost:3100/panel/integraciones/dropi?dropi=conectado",
    );
    const info = (await h.call(o.cookie, "GET", "/api/integrations/dropi")).json();
    expect(info).toMatchObject({ connected: true, mode: "mcp", country: "EC" });
    expect(info.tokenHint).toBeUndefined();
    expect(JSON.stringify(info)).not.toContain(`at-${run}`);

    // Guardar opciones sin token mantiene la conexión por cuenta.
    const keep = await h.call(o.cookie, "PUT", "/api/integrations/dropi", {
      country: "EC",
      options: { ...info.options, rateType: "CON RECAUDO" },
    });
    expect(keep.statusCode, keep.body).toBe(200);
    expect((await h.call(o.cookie, "GET", "/api/integrations/dropi")).json().mode).toBe("mcp");

    const pnid = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const ch = await h.call(o.cookie, "POST", "/api/channels", {
      name: "Principal",
      phoneNumberId: pnid,
      wabaId: "987654321",
      accessToken: TOKEN,
      appSecret: APP_SECRET,
    });
    expect(ch.statusCode, ch.body).toBe(201);
    const prod = await h.call(o.cookie, "POST", "/api/products", {
      name: "Mega Red",
      price: "27.99",
      currency: "USD",
      dropiProductId: "777",
      offers: [{ quantity: 2, totalPrice: "49.99", label: "2 frascos" }],
      triggers: [{ kind: "keyword", value: "mega red" }],
    });
    expect(prod.statusCode, prod.body).toBe(201);

    // La IA verifica la ciudad y confirma: se sube por create_order (con huella global).
    await inbound({ channelId: ch.json().id, pnid }, "593991112233", "Hola, quiero 2 Mega Red");
    const [order] = (await h.call(o.cookie, "GET", "/api/orders")).json();
    expect(order, "sin pedido").toBeTruthy();
    expect(order).toMatchObject({ stage: "por_confirmar", dropiOrderId: "9001" });
    expect(order.customer).toMatchObject({ ciudad: "QUITO", provincia: "PICHINCHA" });
    expect(order.risk).toMatchObject({ source: "dropi_global", deliveryRate: 85, blocked: false });
    expect(mcp.created.at(-1)).toMatchObject({
      name: "Ana",
      surname: "Pérez",
      state: "PICHINCHA",
      city: "QUITO",
      phone: "991112233",
      rate_type: "CON RECAUDO",
      products: [{ id: 777, price: 25, quantity: 2 }],
    });
    // Dropi guarda el teléfono nacional sin el 0: así se consulta la huella.
    expect(mcp.fpPhones[0]).toBe("991112233");
    // Provincias y ciudades: el país se carga una vez (5 búsquedas) y luego se verifica sin
    // consultar Dropi (ni en check_city ni al subir el pedido).
    expect(mcp.citySearches).toEqual(["a", "e", "i", "o", "u"]);
    // Antes de crear: duplicados por teléfono (últimos días), stock/costo y cotización.
    expect(mcp.listArgs[0]).toHaveProperty("from");
    expect(mcp.productSearches[0]).toBe("Mega Red");
    expect(mcp.quotes[0]).toMatchObject({
      cash_on_delivery: true,
      destination_city: { id: 802 },
      products: [{ id: 777, type: "SIMPLE", quantity: 2, price: 25 }],
    });
    expect(order.shippingCost).toBe("4.25");

    // El acceso vence: se renueva solo, se guarda y se sigue usando.
    mcp.valid.delete(`at-${run}-1`);
    const fpUrl = `/api/conversations/${order.conversationId}/fingerprint`;
    const fp = (await h.call(o.cookie, "GET", fpUrl)).json();
    expect(fp.global).toMatchObject({ found: true, buyerType: "Comprador frecuente" });
    expect(fp.global.deliveryProbability).toBe(85);
    // La huella queda en caché: abrir la ficha otra vez no consulta a Dropi.
    const fpCalls = mcp.fpPhones.length;
    expect((await h.call(o.cookie, "GET", fpUrl)).json().global.found).toBe(true);
    expect(mcp.fpPhones.length).toBe(fpCalls);

    // Sin webhook: la consulta periódica trae la guía (y renueva el acceso vencido una vez),
    // y repetirla no duplica eventos.
    mcp.status["9001"] = "GUIA_GENERADA";
    expect((await dropiSync?.())?.updated).toBeGreaterThanOrEqual(1);
    expect(mcp.refreshes).toBe(1);
    let detail = (await h.call(o.cookie, "GET", `/api/orders/${order.id}`)).json();
    expect(detail).toMatchObject({ stage: "guia_generada", trackingCode: "1800" });
    const dropiEvents = () =>
      detail.events.filter((e: { source: string }) => e.source === "dropi").length;
    expect(dropiEvents()).toBe(1);
    await dropiSync?.();
    detail = (await h.call(o.cookie, "GET", `/api/orders/${order.id}`)).json();
    expect(dropiEvents()).toBe(1);

    // Llega a la agencia: con el aviso activado se le escribe al cliente una sola vez.
    const opts = (await h.call(o.cookie, "GET", "/api/integrations/dropi")).json().options;
    await h.call(o.cookie, "PUT", "/api/integrations/dropi", {
      country: "EC",
      options: { ...opts, notices: { ...opts.notices, retiro: true } },
    });
    mcp.status["9001"] = "PARA RETIRO EN AGENCIA SERVIENTREGA";
    await dropiSync?.();
    await dropiSync?.();
    detail = (await h.call(o.cookie, "GET", `/api/orders/${order.id}`)).json();
    expect(detail.stage).toBe("en_oficina");
    // En la agencia: el lead pasa a «En agencia» con el estado del pedido.
    const [inAgency] = (await h.call(o.cookie, "GET", "/api/leads")).json();
    expect(inAgency).toMatchObject({ stage: "en_agencia", order: { dropiOrderId: "9001" } });
    const avisos = detail.events.filter((e: { message: string }) =>
      e.message.startsWith("Aviso de llegada a la agencia"),
    );
    expect(avisos).toHaveLength(1);
    const msgs = (
      await h.call(o.cookie, "GET", `/api/conversations/${order.conversationId}/messages`)
    ).json();
    const sent = JSON.stringify(msgs);
    expect(sent).toContain("ya llegó a");
    expect(sent).toContain("Guía: 1800");
    // En la lista de pedidos se ve desde cuándo está en la agencia.
    const [listed] = (await h.call(o.cookie, "GET", "/api/orders?stage=en_oficina")).json();
    expect(listed.stageSince).toBeTruthy();

    // Eliminar el contacto: se va su conversación, el pedido se conserva.
    const conv = (
      await h.call(o.cookie, "GET", `/api/conversations/${order.conversationId}`)
    ).json();
    const del = await h.call(o.cookie, "DELETE", `/api/contacts/${conv.contact.id}`);
    expect(del.statusCode, del.body).toBe(200);
    expect(del.json().conversations).toBe(1);
    expect((await h.call(o.cookie, "GET", "/api/conversations")).json()).toHaveLength(0);
    const kept = (await h.call(o.cookie, "GET", `/api/orders/${order.id}`)).json();
    expect(kept).toMatchObject({ id: order.id, dropiOrderId: "9001", conversationId: null });
    expect((await h.call(o.cookie, "DELETE", `/api/contacts/${conv.contact.id}`)).statusCode).toBe(
      404,
    );
    // Otra tienda no puede borrar contactos ajenos.
    expect(
      (await h.call(other.cookie, "DELETE", `/api/contacts/${conv.contact.id}`)).statusCode,
    ).toBe(404);
  });
});
