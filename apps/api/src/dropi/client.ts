/**
 * Cliente de la API de integraciones de Dropi (la misma que usa su plugin oficial de
 * WooCommerce): https://api.dropi.<país>/integrations/…, cabecera `dropi-integration-key`
 * con el token que da Dropi al crear una tienda/integración.
 *
 * Las respuestas vienen como {isSuccess, status, message, objects}; `objects` a veces es
 * lista, a veces objeto o mapa por id: se leen de forma tolerante.
 */
import { createHash } from "node:crypto";
import { DROPI_COUNTRIES, type DropiCountry } from "@chatea/shared";

export class DropiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export interface DropiDepartment {
  id: number;
  name: string;
  code: string;
}
export interface DropiCity {
  id: number;
  name: string;
  departmentId: number | null;
  codDane: string;
}
export interface DropiOrderSummary {
  id: string;
  status: string;
  phone: string;
  createdAt: string;
}
export interface DropiOrderPayload {
  total_order: number;
  notes: string;
  name: string;
  surname: string;
  dir: string;
  country: string;
  state: string;
  city: string;
  phone: string;
  client_email: string;
  payment_method_id: 1;
  status: string;
  type: "FINAL_ORDER";
  rate_type: string;
  products: { id: number; price: number; quantity: number; variation_id?: number }[];
  calculate_costs_and_shiping: true;
  shop_order_id: string;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Extrae la lista de una respuesta: lista, {objects:[…]}, {objects:{cities:[…]}} o mapa por id. */
export function rows(j: unknown, depth = 0): Json[] {
  if (Array.isArray(j)) return j.filter(isObj);
  if (!isObj(j) || depth > 3) return [];
  for (const k of ["objects", "data", "cities", "orders", "items", "results", "result"]) {
    if (k in j) {
      const r = rows(j[k], depth + 1);
      if (r.length) return r;
    }
  }
  const vals = Object.values(j);
  if (vals.length && vals.every(isObj) && vals.some((v) => v.id != null || v.name)) return vals;
  return [];
}

const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export class DropiClient {
  readonly base: string;
  /** Identifica la cuenta para cachés en memoria sin guardar el token. */
  readonly key: string;

  constructor(
    private readonly token: string,
    readonly country: DropiCountry,
    private readonly fetchImpl: typeof fetch = fetch,
    base?: string,
  ) {
    this.base = (base ?? DROPI_COUNTRIES[country].base).replace(/\/?$/, "/");
    this.key = createHash("sha256").update(`${this.base}|${token}`).digest("hex").slice(0, 24);
  }

  private async call<T = Json>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.base + path, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json;charset=UTF-8",
          "dropi-integration-key": this.token,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new DropiError(
        (e as Error).name === "TimeoutError"
          ? "Dropi no respondió a tiempo."
          : "No se pudo conectar con Dropi.",
      );
    }
    const data = (await res.json().catch(() => null)) as Json | null;
    if (res.status === 401 || res.status === 403)
      throw new DropiError(
        "Dropi no aceptó el token. Revisa que sea el token de integración de tu tienda.",
        res.status,
      );
    if (!res.ok || !data || data.isSuccess === false) {
      const msg = data?.message ?? data?.error ?? data?.errors ?? `HTTP ${res.status}`;
      throw new DropiError(
        `Dropi: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`.slice(0, 400),
        res.status,
      );
    }
    return data as T;
  }

  async departments(): Promise<DropiDepartment[]> {
    return rows(await this.call("GET", "department"))
      .map((d) => ({
        id: Number(d.id),
        name: str(d.name ?? d.department).trim(),
        code: str(d.department_code ?? d.code),
      }))
      .filter((d) => d.id && d.name);
  }

  /** Ciudades con cobertura en una provincia/departamento. Dropi repite la ciudad por transportadora. */
  async cities(departmentId: number, rateType: string): Promise<DropiCity[]> {
    const raw = rows(
      await this.call("POST", "trajectory/bycity", {
        department_id: departmentId,
        rate_type: rateType,
      }),
    );
    const seen = new Set<number>();
    const out: DropiCity[] = [];
    for (const r of raw) {
      const c = isObj(r.city) ? r.city : r;
      const id = num(typeof r.city === "string" ? (r.city_id ?? r.id) : (c.id ?? r.city_id));
      const name = str(typeof r.city === "string" ? r.city : (c.name ?? c.city_name)).trim();
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        name,
        departmentId: num(c.department_id ?? r.department_id) ?? departmentId,
        codDane: str(c.cod_dane ?? r.cod_dane),
      });
    }
    return out;
  }

  /** Crea la orden; devuelve el id y el estado que asignó Dropi. */
  async createOrder(payload: DropiOrderPayload): Promise<{ id: string; status: string }> {
    const d = await this.call<Json>("POST", "orders/myorders", payload);
    const o = isObj(d.objects) ? d.objects : {};
    const id = str(o.id ?? d.id);
    if (!id) throw new DropiError("Dropi no devolvió el número de la orden.");
    return { id, status: str(o.status ?? payload.status) };
  }

  /** Órdenes de la tienda, de la más reciente a la más antigua. */
  async listOrders(start: number, count: number): Promise<DropiOrderSummary[]> {
    const d = await this.call(
      "GET",
      `orders/myorders?result_number=${count}&start=${start}&order_by=id&order_type=desc`,
    );
    return rows(d).map((o) => ({
      id: str(o.id),
      status: str(o.status),
      phone: str(o.phone ?? o.client_phone ?? o.customer_phone),
      createdAt: str(o.created_at),
    }));
  }

  async product(id: string): Promise<{ id: string; name: string; type: string } | null> {
    const d = await this.call<Json>("GET", `products/v2/${encodeURIComponent(id)}`);
    const p = isObj(d.objects) ? d.objects : null;
    return p ? { id: str(p.id), name: str(p.name), type: str(p.type || "SIMPLE") } : null;
  }
}
