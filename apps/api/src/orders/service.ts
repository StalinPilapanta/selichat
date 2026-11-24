/**
 * Pedidos: se crean cuando el cliente confirma (IA o asesor), se suben a Dropi y Dropi
 * devuelve los cambios de estado por webhook.
 */
import { type Database, schema, withTenant } from "@chatea/db";
import {
  type CheckoutState,
  type DropiCountry,
  type DropiOptions,
  decryptSecret,
  dropiOptionsSchema,
  encryptSecret,
  LOCAL_STAGES,
  nationalPhone,
  normPlace,
  type OrderStage,
  parseQuantity,
  splitName,
  stageFromDropi,
} from "@chatea/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  type DropiApi,
  type DropiCity,
  DropiClient,
  type DropiDepartment,
  DropiError,
  type DropiFingerprint,
  type DropiOrderSummary,
} from "../dropi/client.js";
import { DropiMcpClient, type McpTokens } from "../dropi/mcp.js";
import { loadProduct } from "../services/catalog.js";

const { orders, orderEvents, integrations, conversations, contacts, tenantSettings, dropiRoutes } =
  schema;
type OrderCustomer = schema.OrderCustomer;
type OrderItem = schema.OrderItem;
type OrderRisk = schema.OrderRisk;

export interface DropiDeps {
  db: Database;
  encryptionKey: string;
  /** fetch hacia Dropi (inyectable en pruebas). */
  fetchImpl?: typeof fetch;
}

/** token = API de integraciones (token pegado); mcp = cuenta Dropi autorizada por OAuth. */
export type DropiMode = "token" | "mcp";

export interface DropiConfig {
  mode: DropiMode;
  token: string;
  mcp?: McpTokens;
  country: DropiCountry;
  options: DropiOptions;
}

export function readDropiConfig(enc: string, key: string): DropiConfig {
  const raw = JSON.parse(decryptSecret(enc, key)) as Partial<DropiConfig>;
  return {
    mode: raw.mode === "mcp" ? "mcp" : "token",
    token: raw.token ?? "",
    mcp: raw.mcp,
    country: (raw.country ?? "EC") as DropiCountry,
    options: dropiOptionsSchema.parse(raw.options ?? {}),
  };
}

export function writeDropiConfig(cfg: DropiConfig, key: string) {
  return encryptSecret(JSON.stringify(cfg), key);
}

/** Cliente según el modo; en MCP los tokens renovados se guardan cifrados en la integración. */
export function dropiClient(deps: DropiDeps, tenantId: string, config: DropiConfig): DropiApi {
  if (config.mode === "mcp" && config.mcp)
    return new DropiMcpClient(
      config.mcp,
      config.country,
      async (mcp) => {
        const configEnc = writeDropiConfig({ ...config, mcp }, deps.encryptionKey);
        await withTenant(deps.db, tenantId, (tx) =>
          tx.update(integrations).set({ configEnc }).where(eq(integrations.kind, "dropi")),
        );
      },
      deps.fetchImpl,
    );
  return new DropiClient(config.token, config.country, deps.fetchImpl);
}

export async function loadDropi(deps: DropiDeps, tenantId: string) {
  const [row] = await withTenant(deps.db, tenantId, (tx) =>
    tx.select().from(integrations).where(eq(integrations.kind, "dropi")),
  );
  if (row?.status !== "active") return null;
  const config = readDropiConfig(row.configEnc, deps.encryptionKey);
  return { config, client: dropiClient(deps, tenantId, config) };
}

// ---------- Ciudades (cobertura de Dropi) ----------

const deptCache = new Map<string, { at: number; list: DropiDepartment[] }>();
const DEPT_TTL = 12 * 3600_000;

async function departmentsOf(client: DropiApi) {
  const c = deptCache.get(client.key);
  if (c && Date.now() - c.at < DEPT_TTL) return c.list;
  const list = await client.departments();
  deptCache.set(client.key, { at: Date.now(), list });
  return list;
}

export type PlaceResult =
  | {
      ok: true;
      city: string;
      department: string;
      cityId?: number;
      zipCode?: string;
      daneCode?: string;
    }
  | { ok: false; reason: string; options?: string[] };

/** Valida ciudad (y provincia) contra la cobertura de Dropi; devuelve los nombres como los escribe Dropi. */
export async function resolvePlace(
  client: DropiApi,
  rateType: string,
  ciudad: string,
  provincia?: string,
): Promise<PlaceResult> {
  const c = normPlace(ciudad);
  if (!c) return { ok: false, reason: "Falta la ciudad." };
  const departments = await departmentsOf(client);
  const pv = provincia ? normPlace(provincia) : "";
  const dept = pv
    ? (departments.find((d) => normPlace(d.name) === pv) ??
      departments.find((d) => normPlace(d.name).startsWith(pv) || pv.startsWith(normPlace(d.name))))
    : undefined;
  const depName = (id: number | null) => departments.find((d) => d.id === id)?.name ?? "";
  const all = await client.searchCities(ciudad, rateType, dept?.id);
  let hits = all.filter((x) => normPlace(x.name) === c);
  if (!hits.length)
    hits = all.filter(
      (x) => normPlace(x.name).startsWith(c) || c.startsWith(`${normPlace(x.name)} `),
    );
  if (!hits.length)
    return {
      ok: false,
      reason: `Dropi no tiene cobertura registrada para «${ciudad}»${dept ? ` en ${dept.name}` : ""}.`,
    };
  const byDept = new Map(hits.map((h) => [h.departmentId, h]));
  if (byDept.size > 1)
    return {
      ok: false,
      reason: `Hay varias ciudades «${ciudad}»: indica la provincia.`,
      options: [...byDept.values()]
        .map((h) => `${h.name} (${depName(h.departmentId)})`)
        .slice(0, 8),
    };
  const hit = hits[0] as DropiCity;
  return {
    ok: true,
    city: hit.name,
    department: depName(hit.departmentId),
    cityId: hit.id,
    zipCode: hit.zipCode ?? "",
    daneCode: hit.codDane,
  };
}

// ---------- Huella del comprador (pedidos de la tienda en Dropi) ----------

const historyCache = new Map<string, { at: number; list: { phone: string; status: string }[] }>();
const HISTORY_TTL = 10 * 60_000;
const HISTORY_MAX = 1000;

export async function buyerHistory(client: DropiApi, phone: string) {
  let h = historyCache.get(client.key);
  if (!h || Date.now() - h.at > HISTORY_TTL) {
    const list: { phone: string; status: string }[] = [];
    for (let start = 0; start < HISTORY_MAX; start += 100) {
      const page = await client.listOrders(start, 100);
      list.push(...page.map((o) => ({ phone: o.phone, status: o.status })));
      if (page.length < 100) break;
    }
    h = { at: Date.now(), list };
    historyCache.set(client.key, h);
  }
  const tail = phone.replace(/\D/g, "").slice(-9);
  const mine = h.list.filter((o) => tail && o.phone.replace(/\D/g, "").slice(-9) === tail);
  const stages = mine.map((o) => stageFromDropi(o.status));
  const delivered = stages.filter((s) => s === "entregado").length;
  const returned = stages.filter((s) => s === "devolucion").length;
  const cancelled = stages.filter((s) => s === "cancelado").length;
  const finished = delivered + returned;
  return {
    orders: mine.length,
    delivered,
    returned,
    cancelled,
    deliveryRate: finished ? Math.round((delivered / finished) * 100) : null,
  };
}

export function evaluateRisk(
  h: Omit<OrderRisk, "blocked" | "reason">,
  rules: DropiOptions["risk"],
): OrderRisk {
  if (!rules.enabled) return { ...h, blocked: false };
  const finished = h.delivered + h.returned;
  if (finished >= rules.minOrders && (h.deliveryRate ?? 100) < rules.minDeliveryRate)
    return {
      ...h,
      blocked: true,
      reason: `Recibe el ${h.deliveryRate}% de sus pedidos (${h.delivered} de ${finished}); el mínimo es ${rules.minDeliveryRate}%.`,
    };
  return { ...h, blocked: false };
}

/**
 * Huella global de Dropi (MCP). Sin pedidos finalizados (ambas probabilidades en 0) no hay
 * datos suficientes: nunca bloquea.
 */
export function evaluateGlobalRisk(f: DropiFingerprint, rules: DropiOptions["risk"]): OrderRisk {
  const base: OrderRisk = {
    orders: 0,
    delivered: 0,
    returned: 0,
    cancelled: 0,
    deliveryRate: f.deliveryProbability,
    blocked: false,
    source: "dropi_global",
    buyerType: f.buyerType,
    riskLabel: f.riskLabel,
    returnRate: f.returnProbability,
  };
  const hasData = (f.deliveryProbability ?? 0) > 0 || (f.returnProbability ?? 0) > 0;
  if (!rules.enabled || !f.found || !hasData) return base;
  if ((f.deliveryProbability ?? 100) < rules.minDeliveryRate)
    return {
      ...base,
      blocked: true,
      reason: `Según la huella de Dropi recibe el ${f.deliveryProbability}% de sus pedidos (${f.riskLabel || f.buyerType}); el mínimo es ${rules.minDeliveryRate}%.`,
    };
  return base;
}

/** Riesgo del comprador: huella global si la conexión es MCP; si no, historial de la tienda. */
export async function buyerRisk(client: DropiApi, phone: string, rules: DropiOptions["risk"]) {
  if (client.fingerprint) return evaluateGlobalRisk(await client.fingerprint(phone), rules);
  return evaluateRisk(await buyerHistory(client, phone), rules);
}

// ---------- Pedido duplicado en Dropi (mismo teléfono, últimos días) ----------

const INACTIVE = /CANCELAD|RECHAZAD|DEVOLUCI|DEVUELT|ANULAD/;
const dupCache = new Map<string, { at: number; list: DropiOrderSummary[] }>();
const DUP_TTL = 90_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Pedido ACTIVO en Dropi con ese teléfono en los últimos `days` días (como el bot de ventas). */
export async function findDuplicate(client: DropiApi, phone: string, days: number) {
  const tail = phone.replace(/\D/g, "").slice(-9);
  if (tail.length < 9 || days <= 0) return null;
  const key = `${client.key}|${days}`;
  let c = dupCache.get(key);
  if (!c || Date.now() - c.at > DUP_TTL) {
    const now = new Date();
    const range = {
      from: ymd(new Date(now.getTime() - days * 86400_000)),
      until: ymd(new Date(now.getTime() + 86400_000)),
    };
    const list: DropiOrderSummary[] = [];
    for (let page = 0; page < 5; page++) {
      const batch = await client.listOrders(page * 100, 100, range);
      list.push(...batch);
      if (batch.length < 100) break;
    }
    c = { at: Date.now(), list };
    dupCache.set(key, c);
  }
  const since = Date.now() - days * 86400_000;
  return (
    c.list.find((o) => {
      if (o.phone.replace(/\D/g, "").slice(-9) !== tail) return false;
      if (INACTIVE.test(o.status.toUpperCase())) return false;
      // El token no filtra por fecha: sin fecha legible no se puede afirmar que es reciente.
      if (client.mode === "token") {
        const t = Date.parse(o.createdAt);
        return Number.isFinite(t) && t >= since;
      }
      return true;
    }) ?? null
  );
}

export const forgetDuplicates = (client: DropiApi) => {
  for (const k of dupCache.keys()) if (k.startsWith(`${client.key}|`)) dupCache.delete(k);
};

// ---------- Crear pedido desde la conversación ----------

export class OrderError extends Error {}

/** Etapas en las que el pedido sigue vivo (para no duplicarlo). */
const ORDER_OPEN: OrderStage[] = [
  "pendiente_subida",
  "revision",
  "error_subida",
  "por_confirmar",
  "confirmado",
  "guia_generada",
  "en_transito",
  "en_oficina",
  "novedad",
];

/** Crea (o devuelve el ya existente) pedido de una conversación con su checkout. */
export async function createOrderFromConversation(
  db: Database,
  tenantId: string,
  conversationId: string,
  opts: { source: "ia" | "humano"; checkout?: CheckoutState },
) {
  return withTenant(db, tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.conversationId, conversationId), inArray(orders.stage, ORDER_OPEN)));
    if (existing) return { order: existing, created: false };
    const [row] = await tx
      .select({ conv: conversations, contact: contacts })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(eq(conversations.id, conversationId));
    if (!row) throw new OrderError("La conversación no existe.");
    const st = (opts.checkout ?? row.conv.checkoutState ?? {}) as CheckoutState;
    if (!row.conv.productId) throw new OrderError("La conversación no tiene producto asignado.");
    const product = await loadProduct(tx, row.conv.productId);
    if (!product) throw new OrderError("El producto ya no existe.");
    const [settings] = await tx.select().from(tenantSettings);

    const quantity = parseQuantity(st.cantidad);
    const offer = product.offers.find((o) => o.quantity === quantity);
    const wanted = normPlace(st.variante ?? "");
    const variant = wanted
      ? (product.variants.find((v) => normPlace(v.name) === wanted) ??
        product.variants.find((v) => normPlace(v.name).includes(wanted)))
      : undefined;
    const unit = Number(variant?.price ?? product.price);
    const total = offer ? Number(offer.totalPrice) : unit * quantity;
    const customer: OrderCustomer = {
      ...splitName(st.nombre ?? row.contact.name ?? row.contact.profileName ?? ""),
      telefono: (st.telefono ?? "").replace(/\D/g, "") || row.contact.phone,
      provincia: st.provincia ?? "",
      ciudad: st.ciudad ?? "",
      direccion: st.direccion ?? "",
      referencia: st.referencia ?? "",
      ...(st.agencia ? { agencia: st.agencia } : {}),
    };
    const items: OrderItem[] = [
      {
        productId: product.id,
        name: product.name,
        quantity,
        unitPrice: (total / quantity).toFixed(2),
        dropiProductId: product.dropiProductId,
        dropiVariationId: variant?.dropiVariationId ?? null,
        variant: variant?.name ?? st.variante,
      },
    ];
    const [order] = await tx
      .insert(orders)
      .values({
        contactId: row.contact.id,
        conversationId,
        productId: product.id,
        source: opts.source,
        customer,
        items,
        total: total.toFixed(2),
        currency: product.currency || settings?.currency || "USD",
        notes: [st.cantidad && `Oferta: ${st.cantidad}`, st.notas].filter(Boolean).join(" · "),
      })
      .returning();
    if (!order) throw new OrderError("No se pudo crear el pedido.");
    await tx.insert(orderEvents).values({
      orderId: order.id,
      source: opts.source,
      stage: order.stage,
      message:
        opts.source === "ia"
          ? "La IA confirmó el pedido con el cliente."
          : "Pedido creado por un asesor.",
    });
    return { order, created: true };
  });
}

// ---------- Subir a Dropi ----------

const uploading = new Set<string>();

export type UploadResult =
  | { status: "subido"; dropiOrderId: string }
  | { status: "revision"; reason: string }
  | { status: "error"; error: string }
  | { status: "omitido"; reason: string };

/**
 * Sube un pedido local a Dropi. `force` salta la regla de riesgo (lo decide un asesor).
 * Un solo intento a la vez por pedido; nunca sube dos veces el mismo pedido.
 */
export async function uploadOrder(
  deps: DropiDeps,
  tenantId: string,
  orderId: string,
  opts: { force?: boolean; actor?: "ia" | "humano" | "sistema" } = {},
): Promise<UploadResult> {
  if (uploading.has(orderId)) return { status: "omitido", reason: "subiendo" };
  uploading.add(orderId);
  try {
    return await doUpload(deps, tenantId, orderId, opts);
  } finally {
    uploading.delete(orderId);
  }
}

async function doUpload(
  deps: DropiDeps,
  tenantId: string,
  orderId: string,
  opts: { force?: boolean; actor?: "ia" | "humano" | "sistema" },
): Promise<UploadResult> {
  const { db } = deps;
  const [order] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(orders).where(eq(orders.id, orderId)),
  );
  if (!order) return { status: "omitido", reason: "no_existe" };
  if (order.dropiOrderId || !LOCAL_STAGES.includes(order.stage as OrderStage))
    return { status: "omitido", reason: "ya_subido" };

  const fail = async (error: string, stage: OrderStage = "error_subida") => {
    await withTenant(db, tenantId, async (tx) => {
      await tx
        .update(orders)
        .set({ stage, uploadError: error, uploadAttempts: order.uploadAttempts + 1 })
        .where(eq(orders.id, orderId));
      await tx.insert(orderEvents).values({ orderId, source: "sistema", stage, message: error });
    });
    return { status: "error" as const, error };
  };

  const dropi = await loadDropi(deps, tenantId);
  if (!dropi) return fail("Dropi no está conectado (Integraciones → Dropi).", "pendiente_subida");
  const { client, config } = dropi;

  const item = order.items[0];
  if (!item?.dropiProductId)
    return fail(
      `El producto «${item?.name ?? "?"}» no tiene ID de Dropi (Catálogo → producto → ID en Dropi).`,
    );
  const c = order.customer;
  const missing = [
    !c.nombre && "nombre",
    !c.ciudad && "ciudad",
    !c.direccion && !c.agencia && "dirección",
    !c.telefono && "teléfono",
  ].filter(Boolean);
  if (missing.length) return fail(`Faltan datos del cliente: ${missing.join(", ")}.`);

  try {
    const rateType = order.rateType || config.options.rateType;
    const place = await resolvePlace(client, rateType, c.ciudad, c.provincia);
    if (!place.ok)
      return fail(
        place.options?.length
          ? `${place.reason} Opciones: ${place.options.join(", ")}`
          : place.reason,
      );

    // No se sube: queda en «Revisar» para que un dueño o administrador decida.
    const hold = async (reason: string, extra: Partial<typeof orders.$inferInsert> = {}) => {
      await withTenant(db, tenantId, async (tx) => {
        await tx
          .update(orders)
          .set({ stage: "revision", uploadError: reason, ...extra })
          .where(eq(orders.id, orderId));
        await tx.insert(orderEvents).values({
          orderId,
          source: "sistema",
          stage: "revision",
          message: `No se subió: ${reason}`,
        });
      });
      return { status: "revision" as const, reason };
    };

    // Huella del comprador (después de validar la ciudad).
    let risk: OrderRisk | null = null;
    if (config.options.risk.enabled) {
      risk = await buyerRisk(client, c.telefono, config.options.risk);
      if (risk.blocked && !opts.force) return hold(`riesgo — ${risk.reason ?? ""}`, { risk });
    }

    // Ya hay un pedido activo con este teléfono en Dropi (doble confirmación, otro chat…).
    if (!opts.force && config.options.duplicateDays > 0) {
      const dup = await findDuplicate(client, c.telefono, config.options.duplicateDays).catch(
        () => null,
      );
      if (dup)
        return hold(
          `ya existe en Dropi el pedido #${dup.id} (${dup.status || "activo"}) con este teléfono.`,
        );
    }

    const products = order.items.map((i) => ({
      id: Number(i.dropiProductId),
      price: Number(i.unitPrice),
      quantity: i.quantity,
      ...(i.dropiVariationId ? { variation_id: Number(i.dropiVariationId) } : {}),
    }));

    // Stock y costo de proveedor: Dropi rechaza vender por debajo del costo.
    if (config.options.checkStock && client.productInfo) {
      for (const [k, i] of order.items.entries()) {
        const p = products[k];
        if (!p) continue;
        const info = await client.productInfo(p.id, i.name).catch(() => null);
        if (!info) continue;
        if (info.stock != null && info.stock < p.quantity)
          return fail(
            `Sin stock en Dropi: «${info.name || i.name}» tiene ${info.stock} y el pedido lleva ${p.quantity}.`,
          );
        if (info.cost != null && p.price < info.cost)
          return fail(
            `El precio de «${info.name || i.name}» ($${p.price.toFixed(2)} c/u) es menor a su costo de proveedor en Dropi ($${info.cost.toFixed(2)}). Ajusta la oferta.`,
          );
      }
    }

    // Cotización: confirma cobertura y costo de envío antes de crear (como el bot de ventas).
    let shippingCost: string | null = null;
    if (config.options.quoteBeforeUpload && client.quote && place.cityId) {
      const q = await client
        .quote({
          cityId: place.cityId,
          zipCode: place.zipCode || null,
          daneCode: place.daneCode || undefined,
          cashOnDelivery: rateType === "CON RECAUDO",
          products: products.map((x) => ({
            id: x.id,
            quantity: x.quantity,
            price: x.price,
            variationId: x.variation_id,
          })),
        })
        .catch(() => null); // la cotización no responde: no se bloquea la venta
      if (q?.options.length) {
        const ok = q.options.filter((o) => o.cost != null);
        const want = c.agencia ? "SERVIENTREGA" : "";
        const pick = want
          ? q.options.find((o) => o.carrier.toUpperCase().includes(want))
          : ok.sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0))[0];
        if (want && (!pick || pick.cost == null))
          return fail(
            `Servientrega no cotiza este envío${pick?.error ? `: ${pick.error}` : " (no aparece en la cotización)"}.`,
          );
        if (!want && !ok.length)
          return fail(
            `Ninguna transportadora pudo cotizar este envío: ${q.options
              .map((o) => `${o.carrier} — ${o.error || "sin motivo"}`)
              .join("; ")}`.slice(0, 400),
          );
        if (pick?.cost != null) shippingCost = pick.cost.toFixed(2);
      }
    }

    const created = await client.createOrder({
      total_order: Number(order.total),
      notes: [order.notes, `Pedido Selichat ${order.id.slice(0, 8)}`].filter(Boolean).join(" · "),
      name: c.nombre,
      surname: c.apellido || ".",
      dir: c.agencia
        ? c.agencia.includes("---")
          ? c.agencia // NOMBRE---SECTOR---DIRECCIÓN, el formato de retiro de las guías
          : [`RETIRO EN OFICINA: ${c.agencia}`, c.direccion].filter(Boolean).join(" — ")
        : [c.direccion, c.referencia].filter(Boolean).join(" — "),
      // Retiro en agencia: la transportadora tiene que ser Servientrega.
      ...(c.agencia ? { carrier: "SERVIENTREGA" } : {}),
      country: config.country,
      state: place.department,
      city: place.city,
      phone: nationalPhone(c.telefono, config.country),
      client_email: c.email ?? "",
      payment_method_id: 1,
      status: config.options.initialStatus,
      type: "FINAL_ORDER",
      rate_type: rateType,
      products,
      calculate_costs_and_shiping: true,
      shop_order_id: order.id,
    });
    forgetDuplicates(client);
    const stage = stageFromDropi(created.status) ?? "por_confirmar";
    await withTenant(db, tenantId, async (tx) => {
      await tx
        .update(orders)
        .set({
          stage,
          dropiOrderId: created.id,
          dropiStatus: created.status,
          uploadedAt: new Date(),
          uploadError: null,
          uploadAttempts: order.uploadAttempts + 1,
          risk,
          ...(shippingCost ? { shippingCost } : {}),
          ...(c.agencia ? { carrier: "SERVIENTREGA" } : {}),
          customer: { ...c, ciudad: place.city, provincia: place.department },
        })
        .where(and(eq(orders.id, orderId), isNull(orders.dropiOrderId)));
      await tx.insert(orderEvents).values({
        orderId,
        source: opts.actor ?? "sistema",
        rawStatus: created.status,
        stage,
        message: `Subido a Dropi: orden #${created.id}${opts.force ? " (aprobado por un asesor)" : ""}.`,
      });
      // Los datos del pedido en la conversación quedan con la ciudad y provincia de Dropi.
      if (order.conversationId)
        await tx
          .update(conversations)
          .set({
            checkoutState: sql`${conversations.checkoutState} || ${JSON.stringify({
              ciudad: place.city,
              provincia: place.department,
            })}::jsonb`,
          })
          .where(eq(conversations.id, order.conversationId));
    });
    return { status: "subido", dropiOrderId: created.id };
  } catch (e) {
    if (e instanceof DropiError) return fail(e.message);
    throw e;
  }
}

// ---------- Webhook de estados ----------

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const pick = (o: Json, keys: string[]): unknown => {
  for (const k of keys) {
    const v = k.split(".").reduce<unknown>((a, p) => (isObj(a) ? a[p] : undefined), o);
    if (v != null && v !== "") return v;
  }
  return undefined;
};
const text = (v: unknown) => (v == null || typeof v === "object" ? "" : String(v));

/** Lee un aviso de Dropi (la forma varía): id de la orden, estado, guía y transportadora. */
export function parseDropiWebhook(body: unknown) {
  const o = isObj(body) ? body : {};
  const src = isObj(o.objects) ? o.objects : isObj(o.data) ? o.data : isObj(o.order) ? o.order : o;
  return {
    dropiOrderId: text(pick(src, ["id", "order_id", "orderId", "external_id"])),
    status: text(pick(src, ["status", "estado", "order_status", "new_status"])),
    trackingCode: text(pick(src, ["shipping_guide", "guia", "guide", "tracking_code", "tracking"])),
    carrier: text(
      pick(src, [
        "distribution_company.name",
        "distributionCompany.name",
        "transportadora",
        "carrier",
        "shipping_company",
      ]),
    ),
  };
}

/** Se llama cuando un pedido cambia de etapa por Dropi (avisos al cliente). */
export type OnStage = (tenantId: string, orderId: string, stage: OrderStage) => Promise<unknown>;

export async function applyDropiWebhook(
  db: Database,
  tenantId: string,
  body: unknown,
  onStage?: OnStage,
) {
  const ev = parseDropiWebhook(body);
  if (!ev.dropiOrderId) return { matched: false as const };
  const r = await applyDropiStatus(db, tenantId, ev, isObj(body) ? body : { body });
  if (r.matched && r.stageChanged) await onStage?.(tenantId, r.orderId, r.stage as OrderStage);
  return r;
}

/** Aplica un estado de Dropi (webhook o consulta). Sin cambios no deja evento. */
export async function applyDropiStatus(
  db: Database,
  tenantId: string,
  ev: { dropiOrderId: string; status: string; trackingCode: string; carrier: string },
  payload?: Record<string, unknown>,
  opts: { onlyChanges?: boolean } = {},
) {
  return withTenant(db, tenantId, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.dropiOrderId, ev.dropiOrderId));
    if (!order) return { matched: false as const };
    const stage = stageFromDropi(ev.status);
    const changed =
      (ev.status && ev.status !== order.dropiStatus) ||
      (ev.trackingCode && ev.trackingCode !== order.trackingCode) ||
      (ev.carrier && ev.carrier !== order.carrier);
    if (opts.onlyChanges && !changed)
      return {
        matched: true as const,
        orderId: order.id,
        stage: order.stage,
        changed: false,
        stageChanged: false,
      };
    await tx
      .update(orders)
      .set({
        ...(ev.status ? { dropiStatus: ev.status } : {}),
        ...(stage ? { stage } : {}),
        ...(ev.trackingCode ? { trackingCode: ev.trackingCode } : {}),
        ...(ev.carrier ? { carrier: ev.carrier } : {}),
      })
      .where(eq(orders.id, order.id));
    await tx.insert(orderEvents).values({
      orderId: order.id,
      source: "dropi",
      rawStatus: ev.status || null,
      stage: stage ?? order.stage,
      message: [ev.status, ev.trackingCode && `guía ${ev.trackingCode}`, ev.carrier]
        .filter(Boolean)
        .join(" · "),
      payload: payload ?? null,
    });
    return {
      matched: true as const,
      orderId: order.id,
      stage: stage ?? order.stage,
      changed: true,
      stageChanged: Boolean(stage && stage !== order.stage),
    };
  });
}

/** Pedidos subidos que todavía pueden cambiar de estado. */
const TRACKED: OrderStage[] = [
  "por_confirmar",
  "confirmado",
  "guia_generada",
  "en_transito",
  "en_oficina",
  "novedad",
];

/**
 * Conexión MCP: no hay webhook, así que se consulta el estado de los pedidos vivos.
 * Recorre las tiendas con Dropi conectado (dropi_routes no tiene RLS) y como mucho `perTenant`
 * pedidos por tienda, empezando por los que llevan más tiempo sin actualizarse.
 */
export async function syncDropiStatuses(deps: DropiDeps, perTenant = 40, onStage?: OnStage) {
  const tenants = await deps.db.select({ tenantId: dropiRoutes.tenantId }).from(dropiRoutes);
  let updated = 0;
  for (const { tenantId } of tenants) {
    const dropi = await loadDropi(deps, tenantId).catch(() => null);
    const getOrder = dropi?.client.getOrder?.bind(dropi.client);
    if (!getOrder) continue;
    const list = await withTenant(deps.db, tenantId, (tx) =>
      tx
        .select({ dropiOrderId: orders.dropiOrderId })
        .from(orders)
        .where(and(inArray(orders.stage, TRACKED), sql`${orders.dropiOrderId} is not null`))
        .orderBy(orders.updatedAt)
        .limit(perTenant),
    );
    for (const o of list) {
      try {
        const st = await getOrder(o.dropiOrderId as string);
        if (!st) continue;
        const r = await applyDropiStatus(
          deps.db,
          tenantId,
          { dropiOrderId: o.dropiOrderId as string, ...st },
          { ...st, via: "consulta" },
          { onlyChanges: true },
        );
        if (r.matched && r.changed) updated++;
        if (r.matched && r.stageChanged)
          await onStage?.(tenantId, r.orderId, r.stage as OrderStage).catch(() => null);
      } catch (e) {
        if (!(e instanceof DropiError)) throw e;
        if (e.status === 401 || e.status === 403) break; // autorización vencida: siguiente tienda
      }
    }
  }
  return { updated };
}
