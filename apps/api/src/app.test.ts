import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, hasDb, testApp } from "./test-helpers.js";

describe.skipIf(!hasDb)("API (integración)", () => {
  let app: FastifyInstance;
  let h: ReturnType<typeof client>;
  let seenAuth = "";
  beforeAll(async () => {
    app = await testApp(
      {},
      {
        providerFetch: (async (_url: string, init: { headers: Record<string, string> }) => {
          seenAuth = init.headers.Authorization ?? "";
          return new Response(JSON.stringify({ data: [{ id: "grok-4.7" }, { id: "grok-4.20" }] }));
        }) as unknown as typeof fetch,
      },
    );
    h = client(app);
  });
  afterAll(async () => app.close());

  const signUp = (n: string) => h.signUp(n);
  const createOrg = (c: string, n: string) => h.createOrg(c, n);
  const call = (...a: Parameters<typeof h.call>) => h.call(...a);

  it("health", async () => {
    const res = await app.inject({ url: "/health" });
    expect(res.json()).toEqual({ ok: true, mail: "sin_smtp" });
  });

  it("rutas de tenant exigen sesión", async () => {
    const res = await app.inject({ url: "/api/me" });
    expect(res.statusCode).toBe(401);
  });

  it("flujo completo: tenant, configuración, IA y aislamiento", async () => {
    const ana = await signUp("ana");
    const beto = await signUp("beto");

    // Sin organización todavía
    expect((await call(ana.cookie, "GET", "/api/me")).statusCode).toBe(409);

    const orgA = await createOrg(ana.cookie, "TiendaA");
    const orgB = await createOrg(beto.cookie, "TiendaB");

    const me = (await call(ana.cookie, "GET", "/api/me")).json();
    expect(me).toMatchObject({ tenantId: orgA.id, role: "owner" });

    // Configuración por defecto creada por el hook
    const settings = (await call(ana.cookie, "GET", "/api/settings")).json();
    expect(settings).toMatchObject({
      country: "EC",
      currency: "USD",
      timezone: "America/Guayaquil",
    });

    // Proveedor de IA: la key no vuelve nunca
    const created = await call(ana.cookie, "POST", "/api/ai-providers", {
      kind: "anthropic",
      name: "Claude principal",
      apiKey: "sk-ant-super-secreta-9876",
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.body).not.toContain("super-secreta");
    const provider = created.json();
    expect(provider.apiKeyHint).toBe("••••9876");

    // Modelo del agente de ventas
    const put = await call(ana.cookie, "PUT", "/api/agent-configs/ventas", {
      providerId: provider.id,
      model: "claude-sonnet-5-5",
      temperature: 0.5,
    });
    expect(put.statusCode, put.body).toBe(200);
    const configs = (await call(ana.cookie, "GET", "/api/agent-configs")).json();
    expect(configs.find((c: { agent: string }) => c.agent === "ventas")).toMatchObject({
      model: "claude-sonnet-5-5",
    });

    // Beto (otro tenant) no ve ni puede usar ni borrar el proveedor de Ana
    expect((await call(beto.cookie, "GET", "/api/ai-providers")).json()).toEqual([]);
    const steal = await call(beto.cookie, "PUT", "/api/agent-configs/ventas", {
      providerId: provider.id,
      model: "x",
      temperature: 0.1,
    });
    expect(steal.json()).toEqual({ error: "proveedor_no_existe" });
    expect((await call(beto.cookie, "DELETE", `/api/ai-providers/${provider.id}`)).statusCode).toBe(
      404,
    );
    expect((await call(ana.cookie, "GET", "/api/ai-providers")).json()).toHaveLength(1);
    expect(orgB.id).not.toBe(orgA.id);

    // Marca de la tienda: nombre, color y logo (solo archivos subidos a esta tienda).
    const own = `http://localhost:3100/api/files/${orgA.id}/0e4b1b64-6c8c-4b7a-9f0e-3a1d2c3b4a5f.png`;
    const brand = await call(ana.cookie, "PUT", "/api/settings/branding", {
      name: "NatureVita",
      color: "#2563EB",
      logoUrl: own,
    });
    expect(brand.statusCode, brand.body).toBe(200);
    expect((await call(ana.cookie, "GET", "/api/settings")).json()).toMatchObject({
      brandName: "NatureVita",
      brandColor: "#2563eb",
      logoUrl: own,
      country: "EC", // lo demás de la configuración no cambia
    });
    const foreign = await call(ana.cookie, "PUT", "/api/settings/branding", {
      name: "X",
      color: "#2563eb",
      logoUrl: `http://localhost:3100/api/files/${orgB.id}/0e4b1b64-6c8c-4b7a-9f0e-3a1d2c3b4a5f.png`,
    });
    expect(foreign.statusCode).toBe(400);
    const badColor = await call(ana.cookie, "PUT", "/api/settings/branding", {
      name: null,
      color: "verde",
      logoUrl: null,
    });
    expect(badColor.statusCode).toBe(400);
    // Beto no ve la marca de Ana.
    expect((await call(beto.cookie, "GET", "/api/settings")).json().brandName).toBeNull();
  });

  it("lista modelos en vivo del proveedor y bloquea URLs internas", async () => {
    const own = await signUp("modelos");
    await createOrg(own.cookie, "TiendaM");
    const p = (
      await call(own.cookie, "POST", "/api/ai-providers", {
        kind: "xai",
        name: "Grok",
        apiKey: "xai-123456",
      })
    ).json();
    const res = await call(own.cookie, "GET", `/api/ai-providers/${p.id}/models`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ models: ["grok-4.20", "grok-4.7"] });
    expect(seenAuth).toBe("Bearer xai-123456");

    const bad = await call(own.cookie, "POST", "/api/ai-providers", {
      kind: "openai_compatible",
      name: "Interno",
      apiKey: "x",
      baseUrl: "https://10.0.0.5/v1",
    });
    expect(bad.json()).toEqual({ error: "url_privada" });
  });

  it("invitar a un asesor y que acepte", async () => {
    const owner = await signUp("duena");
    const org = await createOrg(owner.cookie, "TiendaC");
    const asesor = await signUp("asesor");

    const inv = await call(owner.cookie, "POST", "/api/auth/organization/invite-member", {
      email: asesor.email,
      role: "asesor",
    });
    expect(inv.statusCode, inv.body).toBe(200);

    const accept = await call(asesor.cookie, "POST", "/api/auth/organization/accept-invitation", {
      invitationId: inv.json().id,
    });
    expect(accept.statusCode, accept.body).toBe(200);

    const me = (await call(asesor.cookie, "GET", "/api/me")).json();
    expect(me).toMatchObject({ tenantId: org.id, role: "asesor" });

    // Un asesor no puede cambiar proveedores de IA
    const res = await call(asesor.cookie, "POST", "/api/ai-providers", {
      kind: "openai",
      name: "x",
      apiKey: "sk-x",
    });
    expect(res.statusCode).toBe(403);
  });
});

describe.skipIf(!hasDb)("Registro con confirmación de correo", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await testApp({ REQUIRE_EMAIL_VERIFICATION: "true" });
  });
  afterAll(async () => app.close());

  it("guarda el WhatsApp y no deja entrar hasta confirmar el correo", async () => {
    const email = `registro-${Date.now()}@test.local`;
    const headers = { origin: "http://localhost:3100" };
    const up = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers,
      payload: {
        email,
        password: "clave-segura-123",
        name: "Ana",
        phone: "593991234567",
        callbackURL: "/crear-tienda",
      },
    });
    expect(up.statusCode, up.body).toBe(200);
    // Sin sesión hasta confirmar el correo.
    expect(up.json().token).toBeNull();
    expect(up.json().user.phone).toBe("593991234567");

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers,
      payload: { email, password: "clave-segura-123" },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().code).toBe("EMAIL_NOT_VERIFIED");

    // Puede pedir que se lo reenvíen.
    const resend = await app.inject({
      method: "POST",
      url: "/api/auth/send-verification-email",
      headers,
      payload: { email, callbackURL: "/crear-tienda" },
    });
    expect(resend.statusCode, resend.body).toBe(200);
  });
});
