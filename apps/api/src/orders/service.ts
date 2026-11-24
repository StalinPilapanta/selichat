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
  LOCAL_STAGES,
  nationalPhone,
  normPlace,
  type OrderStage,
  parseQuantity,
  splitName,
  stageFromDropi,
} from "@chatea/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { type DropiCity, DropiClient, type DropiDepartment, DropiError } from "../dropi/client.js";
import { loadProduct } from "../services/catalog.js";

const { orders, orderEvents, integrations, conversations, contacts, tenantSettings } = schema;
type OrderCustomer = schema.OrderCustomer;
type OrderItem = schema.OrderItem;
type OrderRisk = schema.OrderRisk;

export interface DropiDeps {
  db: Database;
  encryptionKey: string;
  /** fetch hacia Dropi (inyectable en pruebas). */
  fetchImpl?: typeof fetch;
}

export interface DropiConfig {
  token: string;
  country: DropiCountry;
  options: DropiOptions;
}

export function readDropiConfig(enc: string, key: string): DropiConfig {
  const raw = JSON.parse(decryptSecret(enc, key)) as Partial<DropiConfig>;
  return {
    token: raw.token ?? "",
    country: (raw.country ?? "EC") as DropiCountry,
    options: dropiOptionsSchema.parse(raw.options ?? {}),
  };
}

export async function loadDropi(deps: DropiDeps, tenantId: string) {
  const [row] = await withTenant(deps.db, tenantId, (tx) =>
    tx.select().from(integrations).where(eq(integrations.kind, "dropi")),
  );
  if (row?.status !== "active") return null;
  const config = readDropiConfig(row.configEnc, deps.encryptionKey);
  return { config, client: new DropiClient(config.token, config.country, deps.fetchImpl) };
}

// ---------- Ciudades (cobertura de Dropi), en memoria por cuenta ----------

interface Places {
  at: number;
  departments: DropiDepartment[];
  cities: Map<number, DropiCity[]>;
}
const PLACES_TTL = 12 * 3600_000;
const placesCache = new Map<string, Places>();

async function places(client: DropiClient, rateType: string, departmentIds?: number[]) {
  const key = `${client.key}|${rateType}`;
  let p = placesCache.get(key);
  if (!p || Date.now() - p.at > PLACES_TTL) {
    p = { at: Date.now(), departments: await client.departments(), cities: new Map() };
    placesCache.set(key, p);
  }
  for (const id of departmentIds ?? p.departments.map((d) => d.id)) {
    if (!p.cities.has(id)) p.cities.set(id, await client.cities(id, rateType));
  }
  return p;
}

export type PlaceResult =
  | { ok: true; city: string; department: string }
  | { ok: false; reason: string; options?: string[] };

/** Valida ciudad (y provincia) contra la cobertura de Dropi; devuelve los nombres como los escribe Dropi. */
export async function resolvePlace(
  client: DropiClient,
  rateType: string,
  ciudad: string,
  provincia?: string,
): Promise<PlaceResult> {
  const c = normPlace(ciudad);
  if (!c) return { ok: false, reason: "Falta la ciudad." };
  const base = await places(client, rateType, []);
  const pv = provincia ? normPlace(provincia) : "";
  const dept = pv
    ? (base.departments.find((d) => normPlace(d.name) === pv) ??
      base.departments.find(
        (d) => normPlace(d.name).startsWith(pv) || pv.startsWith(normPlace(d.name)),
      ))
    : undefined;
  const p = await places(client, rateType, dept ? [dept.id] : undefined);
  const depName = (id: number | null) => p.departments.find((d) => d.id === id)?.name ?? "";
  const all = [...p.cities.entries()]
    .filter(([id]) => !dept || id === dept.id)
    .flatMap(([id, list]) => list.map((x) => ({ ...x, departmentId: x.departmentId ?? id })));
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
  return { ok: true, city: hit.name, department: depName(hit.departmentId) };
}

// ---------- Huella del comprador (pedidos de la tienda en Dropi) ----------

const historyCache = new Map<string, { at: number; list: { phone: string; status: string }[] }>();
const HISTORY_TTL = 10 * 60_000;
const HISTORY_MAX = 1000;

export async function buyerHistory(client: DropiClient, phone: string) {
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

    // Huella del comprador con el historial de la tienda en Dropi (después de validar la ciudad).
    let risk: OrderRisk | null = null;
    if (config.options.risk.enabled) {
      risk = evaluateRisk(await buyerHistory(client, c.telefono), config.options.risk);
      if (risk.blocked && !opts.force) {
        const blocked = risk;
        await withTenant(db, tenantId, async (tx) => {
          await tx
            .update(orders)
            .set({ stage: "revision", risk: blocked, uploadError: blocked.reason ?? null })
            .where(eq(orders.id, orderId));
          await tx.insert(orderEvents).values({
            orderId,
            source: "sistema",
            stage: "revision",
            message: `No se subió por riesgo: ${blocked.reason}`,
            payload: { ...blocked },
          });
        });
        return { status: "revision", reason: blocked.reason ?? "" };
      }
    }

    const created = await client.createOrder({
      total_order: Number(order.total),
      notes: [order.notes, `Pedido Selichat ${order.id.slice(0, 8)}`].filter(Boolean).join(" · "),
      name: c.nombre,
      surname: c.apellido || ".",
      dir: c.agencia
        ? [`RETIRO EN OFICINA: ${c.agencia}`, c.direccion].filter(Boolean).join(" — ")
        : [c.direccion, c.referencia].filter(Boolean).join(" — "),
      country: config.country,
      state: place.department,
      city: place.city,
      phone: nationalPhone(c.telefono, config.country),
      client_email: c.email ?? "",
      payment_method_id: 1,
      status: config.options.initialStatus,
      type: "FINAL_ORDER",
      rate_type: rateType,
      products: order.items.map((i) => ({
        id: Number(i.dropiProductId),
        price: Number(i.unitPrice),
        quantity: i.quantity,
        ...(i.dropiVariationId ? { variation_id: Number(i.dropiVariationId) } : {}),
      })),
      calculate_costs_and_shiping: true,
      shop_order_id: order.id,
    });
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

export async function applyDropiWebhook(db: Database, tenantId: string, body: unknown) {
  const ev = parseDropiWebhook(body);
  if (!ev.dropiOrderId) return { matched: false as const };
  return withTenant(db, tenantId, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.dropiOrderId, ev.dropiOrderId));
    if (!order) return { matched: false as const };
    const stage = stageFromDropi(ev.status);
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
      payload: isObj(body) ? body : { body },
    });
    return { matched: true as const, orderId: order.id, stage: stage ?? order.stage };
  });
}
