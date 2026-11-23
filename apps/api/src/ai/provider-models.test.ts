import { describe, expect, it } from "vitest";
import { assertPublicHttpsUrl, isPrivateAddress, listProviderModels } from "./provider-models.js";

describe("isPrivateAddress", () => {
  it.each([
    ["10.0.0.5", true],
    ["172.20.1.1", true],
    ["192.168.1.10", true],
    ["127.0.0.1", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["::1", true],
    ["fd00::1", true],
    ["::ffff:10.0.0.1", true],
    ["8.8.8.8", false],
    ["104.18.2.3", false],
    ["2606:4700::1111", false],
  ])("%s → %s", (ip, expected) => expect(isPrivateAddress(ip)).toBe(expected));
});

describe("assertPublicHttpsUrl", () => {
  const resolveTo = (address: string) => (async () => [{ address, family: 4 }]) as never;
  it("acepta https con IP pública", async () => {
    await expect(
      assertPublicHttpsUrl("https://openrouter.ai/api/v1", resolveTo("104.18.2.3")),
    ).resolves.toBeUndefined();
  });
  it("rechaza http, localhost, IPs internas y DNS que apunta a red privada", async () => {
    await expect(assertPublicHttpsUrl("http://openrouter.ai")).rejects.toThrow(
      "url_debe_ser_https",
    );
    await expect(assertPublicHttpsUrl("https://localhost:4000")).rejects.toThrow("url_privada");
    await expect(assertPublicHttpsUrl("https://10.0.0.8/v1")).rejects.toThrow("url_privada");
    await expect(assertPublicHttpsUrl("https://[::1]/v1")).rejects.toThrow("url_privada");
    await expect(
      assertPublicHttpsUrl("https://api.evil.test", resolveTo("172.18.0.3")),
    ).rejects.toThrow("url_privada");
    await expect(assertPublicHttpsUrl("no es url")).rejects.toThrow("url_invalida");
  });
});

describe("listProviderModels", () => {
  function fakeFetch(body: unknown, status = 200) {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const f = (async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { f, calls };
  }

  it("Anthropic usa x-api-key y versión", async () => {
    const { f, calls } = fakeFetch({
      data: [{ id: "claude-sonnet-5-5" }, { id: "claude-haiku-5-5" }],
    });
    expect(await listProviderModels("anthropic", "k1", null, f)).toEqual([
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
    ]);
    expect(calls[0]?.headers).toMatchObject({
      "x-api-key": "k1",
      "anthropic-version": "2023-06-01",
    });
  });

  it("OpenAI y xAI usan Bearer; Google quita el prefijo models/", async () => {
    const o = fakeFetch({ data: [{ id: "gpt-6-luna" }] });
    expect(await listProviderModels("openai", "k2", null, o.f)).toEqual(["gpt-6-luna"]);
    expect(o.calls[0]?.headers.Authorization).toBe("Bearer k2");
    const x = fakeFetch({ data: [{ id: "grok-4.7" }] });
    expect(await listProviderModels("xai", "k3", null, x.f)).toEqual(["grok-4.7"]);
    expect(x.calls[0]?.url).toBe("https://api.x.ai/v1/models");
    const g = fakeFetch({ models: [{ name: "models/gemini-2.5-flash" }] });
    expect(await listProviderModels("google", "k4", null, g.f)).toEqual(["gemini-2.5-flash"]);
    expect(g.calls[0]?.headers["x-goog-api-key"]).toBe("k4");
  });

  it("traduce errores de autenticación y caídas", async () => {
    await expect(listProviderModels("openai", "k", null, fakeFetch({}, 401).f)).rejects.toThrow(
      "ia_api_key_invalida",
    );
    await expect(listProviderModels("openai", "k", null, fakeFetch({}, 500).f)).rejects.toThrow(
      "proveedor_no_responde",
    );
  });

  it("compatible exige URL pública", async () => {
    await expect(
      listProviderModels("openai_compatible", "k", "http://10.0.0.1/v1", fakeFetch({}).f),
    ).rejects.toThrow("url_debe_ser_https");
  });
});
