import { describe, expect, it } from "vitest";
import { autoSetup, discover } from "./onboarding.js";

const TOKEN = "EAAG-token-tienda-123456789";
const APP_ID = "111";
const SECRET = "abcdefabcdefabcdefabcdefabcdef12";
const APP_TOKEN = `${APP_ID}|${SECRET}`;

type Call = { method: string; url: string; auth: string; body: Record<string, unknown> };
type Route = (c: Call) => unknown;

/** Meta simulado: cada ruta responde un JSON o lanza {status, code, message}. */
function fakeMeta(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const f = (async (
    url: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ) => {
    const c: Call = {
      method: init?.method ?? "GET",
      url: url.replace(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\//, ""),
      auth: init?.headers?.Authorization?.replace("Bearer ", "") ?? "",
      body: init?.body ? JSON.parse(init.body) : {},
    };
    calls.push(c);
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === c.method && (c.url === p || c.url.startsWith(p ?? ""));
    });
    if (!key) return Response.json({ error: { message: `no simulado ${c.url}` } }, { status: 404 });
    try {
      return Response.json(routes[key]?.(c));
    } catch (e) {
      const err = e as { status: number; code: number; message: string };
      return Response.json(
        { error: { message: err.message, code: err.code } },
        { status: err.status },
      );
    }
  }) as unknown as typeof fetch;
  return { opts: { version: "v27.0", fetchImpl: f }, calls };
}

const fail = (status: number, code: number, message: string): never => {
  throw { status, code, message };
};
const onlyApp = (c: Call) => (c.auth === APP_TOKEN ? null : fail(400, 190, "secret malo"));

const happy: Record<string, Route> = {
  "GET app?": (c) =>
    c.auth === TOKEN ? { id: APP_ID, name: "App Tienda" } : fail(401, 190, "token malo"),
  "GET debug_token": (c) =>
    onlyApp(c) ?? {
      data: {
        is_valid: true,
        type: "SYSTEM_USER",
        expires_at: 0,
        scopes: ["whatsapp_business_messaging", "whatsapp_business_management"],
        granular_scopes: [
          { scope: "whatsapp_business_management", target_ids: ["W1"] },
          { scope: "whatsapp_business_messaging", target_ids: ["W1"] },
        ],
      },
    },
  [`GET ${APP_ID}/subscriptions`]: (c) => onlyApp(c) ?? { data: [] },
  [`POST ${APP_ID}/subscriptions`]: (c) => onlyApp(c) ?? { success: true },
  [`GET ${APP_ID}?`]: (c) => onlyApp(c) ?? { id: APP_ID, name: "App Tienda" },
  "GET W1/phone_numbers": () => ({
    data: [
      {
        id: "P1",
        display_phone_number: "+593 99 111 2222",
        verified_name: "Tienda Uno",
        quality_rating: "GREEN",
        status: "CONNECTED",
      },
    ],
  }),
  "GET W1?": () => ({ id: "W1", name: "Cuenta Tienda" }),
  "POST W1/subscribed_apps": () => ({ success: true }),
  "POST P1": () => ({ success: true }),
};

describe("discover", () => {
  it("lista los números del token con su cuenta y valida el App Secret", async () => {
    const m = fakeMeta(happy);
    const d = await discover(TOKEN, SECRET, m.opts);
    expect(d.app).toEqual({ id: APP_ID, name: "App Tienda" });
    expect(d.token.permanent).toBe(true);
    expect(d.missingScopes).toEqual([]);
    expect(d.numbers).toEqual([
      {
        phoneNumberId: "P1",
        wabaId: "W1",
        wabaName: "Cuenta Tienda",
        displayPhone: "+593 99 111 2222",
        verifiedName: "Tienda Uno",
        qualityRating: "GREEN",
        status: "CONNECTED",
      },
    ]);
  });

  it("token inválido y App Secret de otra app dan errores claros", async () => {
    const m = fakeMeta(happy);
    await expect(discover("otro-token-123456789012", SECRET, m.opts)).rejects.toMatchObject({
      code: "token_invalido",
    });
    await expect(discover(TOKEN, "00000000000000000000000000000000", m.opts)).rejects.toMatchObject(
      { code: "app_secret_no_coincide" },
    );
  });

  it("avisa token temporal y permisos faltantes; sin target_ids busca en los negocios", async () => {
    const m = fakeMeta({
      ...happy,
      "GET debug_token": (c) =>
        onlyApp(c) ?? {
          data: {
            type: "USER",
            expires_at: 1_900_000_000,
            scopes: ["whatsapp_business_management"],
          },
        },
      "GET me/businesses": () => ({
        data: [
          { owned_whatsapp_business_accounts: { data: [{ id: "W1", name: "Cuenta Tienda" }] } },
        ],
      }),
    });
    const d = await discover(TOKEN, SECRET, m.opts);
    expect(d.token.permanent).toBe(false);
    expect(d.token.expiresAt).toBe(new Date(1_900_000_000 * 1000).toISOString());
    expect(d.missingScopes).toEqual(["whatsapp_business_messaging"]);
    expect(d.numbers.map((n) => n.phoneNumberId)).toEqual(["P1"]);
  });
});

describe("autoSetup", () => {
  const ch = {
    accessToken: TOKEN,
    appSecret: SECRET,
    wabaId: "W1",
    phoneNumberId: "P1",
    webhookUrl: "https://selichat.test/api/webhooks/whatsapp/abc",
    verifyToken: "vt-123",
  };
  const otherHook = {
    [`GET ${APP_ID}/subscriptions`]: () => ({
      data: [
        {
          object: "whatsapp_business_account",
          callback_url: "https://otro-sistema.com/hook",
          fields: [{ name: "messages" }],
        },
      ],
    }),
  };

  it("app sin webhook: suscribe la WABA, crea el webhook de la app y el del número", async () => {
    const m = fakeMeta(happy);
    const r = await autoSetup(ch, m.opts);
    expect(r).toMatchObject({
      subscribed: { ok: true },
      appWebhook: { ok: true },
      webhook: { ok: true },
      ready: true,
    });
    expect(
      m.calls.find((c) => c.method === "POST" && c.url === `${APP_ID}/subscriptions`)?.body,
    ).toEqual({
      object: "whatsapp_business_account",
      callback_url: ch.webhookUrl,
      verify_token: ch.verifyToken,
      fields: "messages",
    });
    expect(m.calls.find((c) => c.method === "POST" && c.url === "P1")?.body).toEqual({
      webhook_configuration: { override_callback_uri: ch.webhookUrl, verify_token: "vt-123" },
    });
  });

  it("respeta el webhook que ya tenía la app y usa el del número", async () => {
    const m = fakeMeta({ ...happy, ...otherHook });
    const r = await autoSetup(ch, m.opts);
    expect(r.ready).toBe(true);
    expect(r.appWebhook).toMatchObject({ ok: true, note: expect.any(String) });
    expect(m.calls.some((c) => c.method === "POST" && c.url === `${APP_ID}/subscriptions`)).toBe(
      false,
    );
  });

  it("no queda lista si el número rechaza el webhook y la app apunta a otro sistema", async () => {
    const m = fakeMeta({
      ...happy,
      ...otherHook,
      "POST P1": () => fail(400, 100, "Unsupported post request"),
    });
    const r = await autoSetup(ch, m.opts);
    expect(r.webhook).toEqual({ ok: false, error: "Unsupported post request" });
    expect(r.ready).toBe(false);
  });

  it("app con webhook sin el campo messages pide activarlo", async () => {
    const m = fakeMeta({
      ...happy,
      [`GET ${APP_ID}/subscriptions`]: () => ({
        data: [{ object: "whatsapp_business_account", fields: [{ name: "account_update" }] }],
      }),
    });
    const r = await autoSetup(ch, m.opts);
    expect(r.appWebhook.ok).toBe(false);
    expect(r.ready).toBe(false);
  });
});
