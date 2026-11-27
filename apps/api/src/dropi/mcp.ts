/**
 * Conexión con Dropi por su servidor MCP oficial (https://mcp.dropi.co/mcp).
 *
 * - Autorización: OAuth 2.1 con registro dinámico de cliente y PKCE (S256). La tienda inicia
 *   sesión en Dropi y autoriza a Selichat; no hay que copiar tokens.
 * - Transporte: MCP "Streamable HTTP" (JSON-RPC por POST; la respuesta puede venir como JSON o
 *   como eventos SSE).
 * - Las herramientas devuelven texto en formato TOON (tablas compactas); se lee con `parseToon`
 *   salvo que venga `structuredContent`.
 */
import { createHash, randomBytes } from "node:crypto";
import { DROPI_COUNTRIES, type DropiCountry } from "@chatea/shared";
import {
  catalogProductFrom,
  type DropiApi,
  type DropiCatalogProduct,
  type DropiCity,
  type DropiDepartment,
  DropiError,
  type DropiFingerprint,
  type DropiOrderPayload,
  type DropiOrderStatus,
  type DropiOrderSummary,
  type DropiProductInfo,
  type DropiQuote,
} from "./client.js";

export const DROPI_MCP = {
  url: "https://mcp.dropi.co/mcp",
  resource: "https://mcp.dropi.co/mcp",
  authorize: "https://mcp.dropi.co/login/authorize",
  token: "https://mcp.dropi.co/oauth/token",
  register: "https://mcp.dropi.co/oauth/register",
  scope: "read:inventory read:orders write:orders read:reports",
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => {
  const n = Number(v);
  return v !== "" && v != null && Number.isFinite(n) ? n : null;
};

// ---------- OAuth ----------

export interface McpTokens {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
}

const registered = new Map<string, string>();

/** Registra a Selichat como cliente OAuth público para esa URL de retorno (una vez por proceso). */
export async function registerClient(redirectUri: string, fetchImpl: typeof fetch = fetch) {
  const cached = registered.get(redirectUri);
  if (cached) return cached;
  const res = await fetchImpl(DROPI_MCP.register, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Selichat",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: DROPI_MCP.scope,
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const d = (await res?.json().catch(() => null)) as Json | null;
  const id = str(d?.client_id);
  if (!res?.ok || !id) throw new DropiError("Dropi no permitió registrar a Selichat (OAuth).");
  registered.set(redirectUri, id);
  return id;
}

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    state: p.state,
    scope: DROPI_MCP.scope,
    resource: DROPI_MCP.resource,
  });
  return `${DROPI_MCP.authorize}?${q}`;
}

async function tokenRequest(
  form: Record<string, string>,
  clientId: string,
  fetchImpl: typeof fetch,
  prevRefresh = "",
): Promise<McpTokens> {
  const res = await fetchImpl(DROPI_MCP.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...form, client_id: clientId, resource: DROPI_MCP.resource }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const d = (await res?.json().catch(() => null)) as Json | null;
  if (!res?.ok || !d?.access_token)
    throw new DropiError(
      res && (res.status === 400 || res.status === 401)
        ? "La autorización de Dropi venció o fue revocada. Vuelve a conectar Dropi."
        : "No se pudo obtener el acceso de Dropi.",
      401,
    );
  return {
    clientId,
    accessToken: str(d.access_token),
    refreshToken: str(d.refresh_token) || prevRefresh,
    expiresAt: Date.now() + (num(d.expires_in) ?? 3600) * 1000,
  };
}

export function exchangeCode(
  p: { code: string; verifier: string; redirectUri: string; clientId: string },
  fetchImpl: typeof fetch = fetch,
) {
  return tokenRequest(
    {
      grant_type: "authorization_code",
      code: p.code,
      code_verifier: p.verifier,
      redirect_uri: p.redirectUri,
    },
    p.clientId,
    fetchImpl,
  );
}

/** Renovaciones en curso: si dos turnos renuevan a la vez, comparten el resultado. */
const refreshing = new Map<string, Promise<McpTokens>>();

export function refreshTokens(t: McpTokens, fetchImpl: typeof fetch = fetch) {
  const key = `${t.clientId}|${t.refreshToken}`;
  let p = refreshing.get(key);
  if (!p) {
    p = tokenRequest(
      { grant_type: "refresh_token", refresh_token: t.refreshToken },
      t.clientId,
      fetchImpl,
      t.refreshToken,
    );
    refreshing.set(key, p);
    // El resultado queda un rato para quien todavía tenga el token viejo.
    p.then(
      () => setTimeout(() => refreshing.delete(key), 5 * 60_000).unref(),
      () => refreshing.delete(key),
    );
  }
  return p;
}

// ---------- TOON (formato de texto de las herramientas de Dropi) ----------

/** Separa por comas respetando comillas; los valores entre comillas se marcan como texto. */
function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let wasQuoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === "\\" && i + 1 < line.length) {
        const nx = line[++i] as string;
        cur += nx === "n" ? "\n" : nx === "t" ? "\t" : nx;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (ch === ",") {
      out.push(wasQuoted ? `\u0000${cur}` : cur.trim());
      cur = "";
      wasQuoted = false;
    } else cur += ch;
  }
  out.push(wasQuoted ? `\u0000${cur}` : cur.trim());
  return out;
}

/** Texto → valor: entre comillas siempre es texto; si no, número/booleano/null cuando aplica. */
function scalar(raw: string): unknown {
  if (raw.startsWith("\u0000")) return raw.slice(1);
  const s = raw.trim();
  if (s.startsWith('"')) return scalar(splitRow(s)[0] ?? "");
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

const indentOf = (l: string) => l.length - l.trimStart().length;
const HEADER = /^("[^"]*"|[^:[{]+?)(?:\[(\d+)\](?:\{([^}]*)\})?)?:(?:\s(.*))?$/;

/** Lee la salida TOON de las herramientas (objetos anidados por sangría y tablas `k[N]{a,b}:`). */
export function parseToon(text: string): Json {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  let i = 0;
  const block = (indent: number): Json => {
    const obj: Json = {};
    while (i < lines.length) {
      const line = lines[i] as string;
      const ind = indentOf(line);
      if (ind < indent) break;
      const m = HEADER.exec(line.trim());
      i++;
      if (!m) continue;
      const key = (m[1] as string).replace(/^"|"$/g, "").trim();
      const [, , count, fields, rest = ""] = m;
      if (count !== undefined && fields !== undefined) {
        const cols = splitRow(fields).map((c) => String(scalar(c)));
        const list: Json[] = [];
        while (i < lines.length && indentOf(lines[i] as string) > ind) {
          const vals = splitRow((lines[i] as string).trim());
          list.push(Object.fromEntries(cols.map((c, k) => [c, scalar(vals[k] ?? "")])));
          i++;
        }
        obj[key] = list;
      } else if (count !== undefined) {
        if (rest.trim()) obj[key] = splitRow(rest).map(scalar);
        else {
          const list: unknown[] = [];
          while (i < lines.length && indentOf(lines[i] as string) > ind) {
            list.push(scalar((lines[i] as string).trim().replace(/^-\s*/, "")));
            i++;
          }
          obj[key] = list;
        }
      } else if (rest.trim() === "") {
        obj[key] =
          i < lines.length && indentOf(lines[i] as string) > ind
            ? block(indentOf(lines[i] as string))
            : "";
      } else obj[key] = scalar(rest);
    }
    return obj;
  };
  return block(0);
}

// ---------- Transporte MCP ----------

/**
 * Dropi a veces avisa del acceso vencido o revocado como respuesta de la herramienta con error
 * (HTTP 200), no como 401: «sesión MCP no válida (token has been revoked)».
 */
const AUTH_ERROR =
  /token has been revoked|sesi[oó]n mcp no v[aá]lida|invalid[_ ]token|token (is )?expired|unauthori[sz]ed|no bearer token|volver a conectar/i;
export const REAUTH_MESSAGE =
  "Dropi revocó o venció la autorización de Selichat. Ve a Integraciones → Dropi, pulsa «Volver a autorizar» y luego reintenta el pedido.";

/** Lee una respuesta JSON-RPC, en JSON directo o en eventos SSE (`data: {...}`). */
async function readRpc(res: Response, id: number): Promise<Json | null> {
  const ct = res.headers.get("content-type") ?? "";
  const body = await res.text();
  if (!body.trim()) return null;
  const msgs: unknown[] = [];
  if (ct.includes("text/event-stream")) {
    for (const ev of body.split(/\r?\n\r?\n/)) {
      const data = ev
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) msgs.push(JSON.parse(data));
    }
  } else {
    const j = JSON.parse(body);
    msgs.push(...(Array.isArray(j) ? j : [j]));
  }
  return (msgs.find((m) => isObj(m) && m.id === id) as Json | undefined) ?? null;
}

class McpSession {
  private sessionId: string | null = null;
  private ready: Promise<void> | null = null;
  private seq = 0;

  constructor(
    private readonly getToken: () => Promise<string>,
    private readonly onUnauthorized: () => Promise<void>,
    private readonly fetchImpl: typeof fetch,
  ) {}

  private async post(payload: Json, retried = false): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${await this.getToken()}`,
      "MCP-Protocol-Version": "2025-06-18",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    let res: Response;
    try {
      res = await this.fetchImpl(DROPI_MCP.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (e) {
      throw new DropiError(
        (e as Error).name === "TimeoutError"
          ? "Dropi no respondió a tiempo."
          : "No se pudo conectar con Dropi.",
      );
    }
    if (res.status === 401 && !retried) {
      await this.onUnauthorized();
      return this.post(payload, true);
    }
    if (res.status === 401 || res.status === 403)
      throw new DropiError("Dropi rechazó el acceso. Vuelve a conectar Dropi.", res.status);
    return res;
  }

  private init() {
    this.ready ??= (async () => {
      const id = ++this.seq;
      const res = await this.post({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "selichat", version: "1.0" },
        },
      });
      if (!res.ok) throw new DropiError(`Dropi MCP: HTTP ${res.status} al iniciar.`, res.status);
      this.sessionId = res.headers.get("mcp-session-id");
      await readRpc(res, id);
      await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    })().catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  /** Llama una herramienta y devuelve sus datos (structuredContent, JSON o TOON). */
  async call(name: string, args: Json, retried = false): Promise<Json> {
    await this.init();
    const id = ++this.seq;
    const res = await this.post({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });
    if (res.status === 404 && this.sessionId && !retried) {
      // La sesión venció en Dropi: se abre otra.
      this.sessionId = null;
      this.ready = null;
      return this.call(name, args, true);
    }
    if (!res.ok) throw new DropiError(`Dropi MCP: HTTP ${res.status} en ${name}.`, res.status);
    const msg = await readRpc(res, id).catch(() => null);
    if (!msg) throw new DropiError(`Dropi no respondió a ${name}.`);
    const result = isObj(msg.result) ? msg.result : {};
    const textOut = (Array.isArray(result.content) ? result.content : [])
      .filter((c): c is Json => isObj(c) && c.type === "text")
      .map((c) => str(c.text))
      .join("\n");
    const failure = isObj(msg.error)
      ? str(msg.error.message) || "error"
      : result.isError
        ? textOut || "error"
        : "";
    if (failure && AUTH_ERROR.test(failure)) {
      if (retried) throw new DropiError(REAUTH_MESSAGE, 401);
      // Acceso revocado/vencido: se renueva con el refresh token y se reintenta una vez.
      await this.onUnauthorized();
      this.sessionId = null;
      this.ready = null;
      return this.call(name, args, true);
    }
    if (failure) throw new DropiError(`Dropi: ${failure}`.slice(0, 400));
    if (isObj(result.structuredContent)) return { ...result.structuredContent, _text: textOut };
    try {
      const j = JSON.parse(textOut);
      if (isObj(j)) return { ...j, _text: textOut };
      if (Array.isArray(j)) return { items: j, _text: textOut };
    } catch {}
    return { ...parseToon(textOut), _text: textOut };
  }
}

const fingerprintCache = new Map<string, { at: number; fp: DropiFingerprint }>();

const items = (d: Json): Json[] => {
  for (const k of ["items", "results", "data", "orders", "cities", "departments"])
    if (Array.isArray(d[k])) return (d[k] as unknown[]).filter(isObj);
  return [];
};

/** Cliente de Dropi vía MCP: misma interfaz que el cliente por token. */
export class DropiMcpClient implements DropiApi {
  readonly mode = "mcp" as const;
  readonly key: string;
  readonly placesKey: string;
  private readonly session: McpSession;

  constructor(
    private tokens: McpTokens,
    readonly country: DropiCountry,
    /** Guarda los tokens renovados (cifrados en la integración de la tienda). */
    private readonly onTokens: (t: McpTokens) => Promise<void>,
    private readonly fetchImpl: typeof fetch = fetch,
    /** La autorización ya no sirve: se marca para pedir «Volver a autorizar». */
    private readonly onAuthLost?: (message: string) => Promise<void>,
  ) {
    this.key = createHash("sha256")
      .update(`mcp|${tokens.clientId}|${tokens.refreshToken || tokens.accessToken}`)
      .digest("hex")
      .slice(0, 24);
    this.placesKey = fetchImpl === fetch ? country : `${country}~${this.key}`;
    this.session = new McpSession(
      async () => {
        if (this.tokens.refreshToken && this.tokens.expiresAt - Date.now() < 60_000)
          await this.refresh();
        return this.tokens.accessToken;
      },
      () => this.refresh(),
      fetchImpl,
    );
  }

  private async refresh() {
    try {
      if (!this.tokens.refreshToken) throw new DropiError(REAUTH_MESSAGE, 401);
      const old = this.tokens.accessToken;
      this.tokens = await refreshTokens(this.tokens, this.fetchImpl);
      if (this.tokens.accessToken !== old) await this.onTokens(this.tokens);
    } catch (e) {
      // Ya no hay forma de renovar: la tienda tiene que volver a autorizar.
      await this.onAuthLost?.(REAUTH_MESSAGE).catch(() => null);
      throw e instanceof DropiError && e.status === 401 ? new DropiError(REAUTH_MESSAGE, 401) : e;
    }
  }

  call(name: string, args: Json = {}) {
    return this.session.call(name, args);
  }

  async departments(): Promise<DropiDepartment[]> {
    return items(await this.call("list_departments"))
      .map((d) => ({ id: Number(d.id), name: str(d.name), code: str(d.department_code) }))
      .filter((d) => d.id && d.name);
  }

  /** El país completo con 5 búsquedas (search_cities es por coincidencia parcial). */
  async allCities(): Promise<DropiCity[]> {
    const seen = new Map<number, DropiCity>();
    for (const v of ["a", "e", "i", "o", "u"])
      for (const c of await this.searchCities(v, "")) seen.set(c.id, c);
    return [...seen.values()];
  }

  async searchCities(name: string, _rateType: string, departmentId?: number) {
    const run = async (q: string) =>
      items(await this.call("search_cities", { name: q }))
        .map(
          (c): DropiCity => ({
            id: Number(c.id),
            name: str(c.name),
            departmentId: num(c.department_id),
            codDane: str(c.cod_dane),
            zipCode: str(c.zip_code),
          }),
        )
        .filter((c) => c.id && c.name && (!departmentId || c.departmentId === departmentId));
    let list = await run(name);
    // «Quito norte» → «Quito».
    const first = name.trim().split(/\s+/)[0] ?? "";
    if (!list.length && first.length >= 3 && first !== name.trim()) list = await run(first);
    return list;
  }

  private carriers: { id: number; name: string }[] | null = null;

  /** id de la transportadora por nombre (list_carriers), o null si la cuenta no la tiene. */
  async carrierId(name: string) {
    this.carriers ??= items(await this.call("list_carriers"))
      .map((c) => ({ id: Number(c.id), name: str(c.name).toUpperCase() }))
      .filter((c) => c.id);
    const n = name.toUpperCase();
    return this.carriers.find((c) => c.name === n || c.name.includes(n))?.id ?? null;
  }

  async createOrder(p: DropiOrderPayload) {
    const carrierId = p.carrier ? await this.carrierId(p.carrier).catch(() => null) : null;
    const d = await this.call("create_order", {
      ...(carrierId ? { distribution_company_id: carrierId } : {}),
      name: p.name,
      surname: p.surname,
      dir: p.dir,
      state: p.state,
      city: p.city,
      phone: p.phone,
      rate_type: p.rate_type,
      products: p.products.map((x) => ({
        id: x.id,
        price: x.price,
        quantity: x.quantity,
        ...(x.variation_id ? { variation_id: x.variation_id } : {}),
      })),
      ...(p.notes ? { notes: p.notes } : {}),
      ...(p.client_email ? { client_email: p.client_email } : {}),
      shop_order_id: p.shop_order_id,
    });
    const o = isObj(d.order) ? d.order : d;
    const id =
      str(o.order_id ?? o.id) || /(?:order_id|id)\W{1,4}(\d{3,})/i.exec(str(d._text))?.[1] || "";
    if (!id) throw new DropiError("Dropi no devolvió el número de la orden.");
    return { id, status: str(o.status) || p.status };
  }

  async listOrders(
    start: number,
    count: number,
    range?: { from: string; until: string },
  ): Promise<DropiOrderSummary[]> {
    return items(
      await this.call("list_orders", {
        start,
        result_number: Math.min(count, 100),
        ...(range ? { from: range.from, until: range.until } : {}),
      }),
    ).map((o) => ({
      id: str(o.order_id ?? o.id),
      status: str(o.status),
      phone: str(o.customer_phone ?? o.phone),
      createdAt: str(o.created_at),
    }));
  }

  async quote(p: Parameters<NonNullable<DropiApi["quote"]>>[0]): Promise<DropiQuote> {
    const d = await this.call("quote_shipping", {
      cash_on_delivery: p.cashOnDelivery,
      destination_city: {
        id: p.cityId,
        zip_code: p.zipCode || null,
        ...(p.daneCode ? { dane_code: p.daneCode } : {}),
      },
      products: p.products.map((x) => ({
        id: x.id,
        type: x.variationId ? "VARIABLE" : "SIMPLE",
        quantity: x.quantity,
        price: x.price,
        ...(x.variationId ? { variation_id: x.variationId } : {}),
      })),
      ...(p.direction ? { direction: p.direction } : {}),
    });
    const list = items(d).length
      ? items(d)
      : (["carriers", "options", "quotes"].flatMap((k) =>
          Array.isArray(d[k]) ? (d[k] as unknown[]).filter(isObj) : [],
        ) as Json[]);
    return {
      currency: str(d.currency) || "USD",
      options: list.map((o) => ({
        carrier: str(o.carrier ?? o.name ?? o.distribution_company),
        cost: num(o.shipping_cost),
        error: str(o.error),
      })),
    };
  }

  private productCache = new Map<number, { at: number; info: DropiProductInfo | null }>();

  async productInfo(id: number, nameHint: string): Promise<DropiProductInfo | null> {
    const hit = this.productCache.get(id);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.info;
    const info = await this.findProduct(id, nameHint);
    this.productCache.set(id, { at: Date.now(), info });
    return info;
  }

  private async findProduct(id: number, nameHint: string): Promise<DropiProductInfo | null> {
    // list_products busca el texto literal dentro del nombre: se prueba el nombre y su 1ª palabra.
    const words = nameHint.trim().split(/\s+/);
    const tries = [nameHint.trim(), words.find((w) => w.length >= 4) ?? ""].filter(Boolean);
    for (const search of [...new Set(tries)]) {
      const list = items(
        await this.call("list_products", { search, get_stock: true, page_size: 50 }),
      );
      const p = list.find((x) => Number(x.id) === id);
      if (p)
        return {
          id: String(id),
          name: str(p.name),
          stock: num(p.stock),
          cost: num(p.sale_price ?? p.cost),
        };
    }
    return null;
  }

  /** Busca en el catálogo de Dropi por nombre o por ID (el ID también entra como texto). */
  async searchProducts(query: string): Promise<DropiCatalogProduct[]> {
    const q = query.trim();
    if (!q) return [];
    const list = items(
      await this.call("list_products", { search: q, get_stock: true, page_size: 20 }),
    );
    const found = list.map(catalogProductFrom).filter((p) => p.id && p.name);
    // Por ID: primero el que coincide exacto.
    return /^\d+$/.test(q)
      ? [...found.filter((p) => p.id === q), ...found.filter((p) => p.id !== q)]
      : found;
  }

  async getOrder(id: string): Promise<DropiOrderStatus | null> {
    const d = await this.call("get_order", { id });
    const o = isObj(d.order) ? d.order : d;
    if (!str(o.status)) return null;
    return {
      status: str(o.status),
      trackingCode: str(o.tracking_code),
      carrier: str(o.shipping_company ?? o.carrier),
    };
  }

  /** Huella digital global de Dropi (compras del teléfono en todas las tiendas). */
  async fingerprint(phone: string): Promise<DropiFingerprint> {
    // La huella cambia poco: se guarda 6 h por teléfono (la ficha la pide al abrir cada chat).
    const hit = fingerprintCache.get(`${this.key}|${phone}`);
    if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.fp;
    const fp = await this.lookupFingerprint(phone);
    if (fingerprintCache.size > 5000) fingerprintCache.clear();
    fingerprintCache.set(`${this.key}|${phone}`, { at: Date.now(), fp });
    return fp;
  }

  private async lookupFingerprint(phone: string): Promise<DropiFingerprint> {
    const digits = phone.replace(/\D/g, "");
    const dial = DROPI_COUNTRIES[this.country].dial;
    // Dropi guarda el número nacional (sin indicativo ni 0 inicial): se prueba ese primero.
    const national = digits.startsWith(dial) ? digits.slice(dial.length) : digits.replace(/^0/, "");
    let r = await this.profile(national);
    if (!r.found && national !== digits) r = await this.profile(digits);
    return r;
  }

  private async profile(phone: string): Promise<DropiFingerprint> {
    const d = await this.call("get_customer_fingerprint_profile", { phone });
    const p = isObj(d.profile) ? d.profile : d;
    const delivery = num(p.delivery_probability);
    const ret = num(p.return_probability);
    const found = delivery !== null || ret !== null || Boolean(str(p.buyer_type));
    return {
      found,
      buyerType: str(p.buyer_type),
      riskLabel: str(p.risk_label),
      deliveryProbability: delivery,
      returnProbability: ret,
      message: found ? "" : str(d._text).slice(0, 200),
    };
  }
}
