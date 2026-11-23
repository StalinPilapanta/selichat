import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AiProviderKind } from "@chatea/shared";

export class ProviderError extends Error {}

/** Rangos privados, loopback, link-local y similares (IPv4 e IPv6). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return (
    v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")
  );
}

/**
 * La URL base de un proveedor "compatible" la escribe el tenant y el servidor la llama:
 * se exige https y un host público para que no pueda apuntar a la red interna (SSRF).
 */
export async function assertPublicHttpsUrl(raw: string, resolve = lookup): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderError("url_invalida");
  }
  if (url.protocol !== "https:") throw new ProviderError("url_debe_ser_https");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal"))
    throw new ProviderError("url_privada");
  const addrs = isIP(host)
    ? [{ address: host }]
    : await resolve(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new ProviderError("url_invalida");
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new ProviderError("url_privada");
}

const ENDPOINTS: Record<Exclude<AiProviderKind, "openai_compatible">, string> = {
  anthropic: "https://api.anthropic.com/v1/models?limit=1000",
  openai: "https://api.openai.com/v1/models",
  xai: "https://api.x.ai/v1/models",
  google: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
};

/** IDs de modelos que la cuenta del tenant puede usar, según la API del proveedor. */
export async function listProviderModels(
  kind: AiProviderKind,
  apiKey: string,
  baseUrl: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  let url: string;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (kind === "openai_compatible") {
    if (!baseUrl) throw new ProviderError("url_invalida");
    await assertPublicHttpsUrl(baseUrl);
    url = `${baseUrl.replace(/\/+$/, "")}/models`;
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    url = ENDPOINTS[kind];
    if (kind === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (kind === "google") headers["x-goog-api-key"] = apiKey;
    else headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetchImpl(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!res) throw new ProviderError("proveedor_no_responde");
  if (res.status === 401 || res.status === 403) throw new ProviderError("ia_api_key_invalida");
  if (!res.ok) throw new ProviderError("proveedor_no_responde");
  const body = (await res.json().catch(() => ({}))) as {
    data?: { id?: string }[];
    models?: { name?: string }[];
  };
  const ids =
    kind === "google"
      ? (body.models ?? []).map((m) => (m.name ?? "").replace(/^models\//, ""))
      : (body.data ?? []).map((m) => m.id ?? "");
  return [...new Set(ids.filter(Boolean))].sort();
}
