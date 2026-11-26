"use client";
import {
  agencyLabel,
  displayPhone,
  LOCAL_STAGES,
  ORDER_STAGES,
  type OrderStage,
} from "@chatea/shared";
import { Package, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { NotifyBanner } from "@/lib/order-alerts";

type Customer = {
  nombre: string;
  apellido: string;
  telefono: string;
  provincia: string;
  ciudad: string;
  direccion: string;
  referencia?: string;
  /** Retiro en agencia: NOMBRE---SECTOR---DIRECCIÓN. */
  agencia?: string;
};
type Order = {
  id: string;
  stage: OrderStage;
  /** Desde cuándo está en la etapa actual (según Dropi). */
  stageSince?: string | null;
  /** WhatsApp del contacto (da el código de país del teléfono del pedido). */
  contactPhone?: string | null;
  source: string;
  customer: Customer;
  items: { name: string; quantity: number; unitPrice: string; variant?: string }[];
  total: string;
  currency: string;
  rateType: string;
  dropiOrderId: string | null;
  dropiStatus: string | null;
  carrier: string | null;
  trackingCode: string | null;
  uploadError: string | null;
  risk: { deliveryRate: number | null; delivered: number; returned: number } | null;
  notes: string;
  conversationId: string | null;
  createdAt: string;
};
type Detail = Order & {
  events: {
    id: string;
    source: string;
    message: string;
    rawStatus: string | null;
    createdAt: string;
  }[];
};

/** Columnas del tablero (las etapas poco comunes se agrupan con su vecina). */
const COLUMNS: { title: string; stages: OrderStage[] }[] = [
  { title: "Por subir", stages: ["pendiente_subida", "error_subida", "revision"] },
  { title: "Por confirmar", stages: ["por_confirmar"] },
  { title: "Confirmado", stages: ["confirmado", "guia_generada"] },
  { title: "En camino", stages: ["en_transito", "en_oficina"] },
  { title: "Novedad", stages: ["novedad"] },
  { title: "Entregado", stages: ["entregado"] },
  { title: "Devuelto / cancelado", stages: ["devolucion", "cancelado"] },
];

const STAGE_STYLE: Partial<Record<OrderStage, string>> = {
  error_subida: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  revision: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  novedad: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  entregado: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  devolucion: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

const money = (o: { total: string; currency: string }) =>
  `${Number(o.total).toFixed(2)} ${o.currency}`;
const when = (d: string) =>
  new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(new Date(d));
const fullName = (c: Customer) => [c.nombre, c.apellido].filter(Boolean).join(" ") || "Sin nombre";

function StageBadge({ stage }: { stage: OrderStage }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] ${STAGE_STYLE[stage] ?? "bg-zinc-100 dark:bg-zinc-800"}`}
    >
      {ORDER_STAGES[stage] ?? stage}
    </span>
  );
}

/** Días en la agencia sin retirar: a partir de 2 se marca para llamar al cliente. */
function DaysInAgency({ since }: { since?: string | null }) {
  if (!since) return null;
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86400_000);
  const tone =
    days >= 4
      ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
      : days >= 2
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${tone}`}>
      {days === 0 ? "llegó hoy" : `${days} día${days === 1 ? "" : "s"} en agencia`}
    </span>
  );
}

function Card({ o, onOpen }: { o: Order; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border border-zinc-200 bg-white p-3 text-left text-sm hover:border-brand-400 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{fullName(o.customer)}</span>
        <span className="shrink-0 text-xs">{money(o)}</span>
      </div>
      <div className="mt-0.5 truncate text-xs text-zinc-500">
        {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")} · {o.customer.ciudad || "—"}
        {o.customer.telefono && ` · ${displayPhone(o.customer.telefono, o.contactPhone)}`}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <StageBadge stage={o.stage} />
        {o.dropiOrderId && <span className="text-[11px] text-zinc-500">#{o.dropiOrderId}</span>}
        {o.stage === "en_oficina" && <DaysInAgency since={o.stageSince} />}
      </div>
      {o.uploadError && (
        <p className="mt-1 line-clamp-2 text-[11px] text-red-600 dark:text-red-400">
          {o.uploadError}
        </p>
      )}
    </button>
  );
}

const FIELDS: { key: keyof Customer; label: string }[] = [
  { key: "nombre", label: "Nombre" },
  { key: "apellido", label: "Apellido" },
  { key: "telefono", label: "Teléfono" },
  { key: "provincia", label: "Provincia" },
  { key: "ciudad", label: "Ciudad" },
  { key: "direccion", label: "Dirección" },
  { key: "referencia", label: "Referencia" },
];

function OrderPanel({
  id,
  onClose,
  onChange,
}: {
  id: string;
  onClose: () => void;
  onChange: () => void;
}) {
  const [o, setO] = useState<Detail | null>(null);
  const [form, setForm] = useState<Customer | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<Detail>(`/api/orders/${id}`);
      setO(d);
      setForm(d.customer);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const local = o ? LOCAL_STAGES.includes(o.stage) : false;
  const dirty = o && form ? JSON.stringify(o.customer) !== JSON.stringify(form) : false;

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    setNote("");
    try {
      await fn();
      await load();
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }

  const saveData = () =>
    run("guardar", () => api(`/api/orders/${id}`, { method: "PATCH", body: { customer: form } }));
  const upload = (force = false) =>
    run("subir", async () => {
      if (dirty) await api(`/api/orders/${id}`, { method: "PATCH", body: { customer: form } });
      const r = await api<{ result: { status: string } }>(`/api/orders/${id}/upload`, {
        method: "POST",
        body: { force },
      });
      if (r.result.status === "subido") setNote("Subido a Dropi ✓");
    });
  const cancel = () => {
    if (!confirm("¿Cancelar este pedido? No se subirá a Dropi.")) return;
    run("cancelar", () => api(`/api/orders/${id}`, { method: "PATCH", body: { cancel: true } }));
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <aside className="relative h-full w-full max-w-md space-y-4 overflow-y-auto bg-white p-5 shadow-xl dark:bg-zinc-950">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{o ? fullName(o.customer) : "Pedido"}</h2>
            {o?.customer.telefono && (
              <p className="text-sm text-zinc-500">
                {displayPhone(o.customer.telefono, o.contactPhone)}
              </p>
            )}
            {o && (
              <p className="text-xs text-zinc-500">
                {when(o.createdAt)} ·{" "}
                {o.source === "ia" ? "cerrado por la IA" : "creado por un asesor"}
              </p>
            )}
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        {!o || !form ? (
          <ErrorText>{error}</ErrorText>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StageBadge stage={o.stage} />
              {o.dropiOrderId && <span>Dropi #{o.dropiOrderId}</span>}
              {o.dropiStatus && <span className="text-xs text-zinc-500">({o.dropiStatus})</span>}
            </div>
            {(o.carrier || o.trackingCode) && (
              <p className="text-sm">
                {o.carrier}
                {o.trackingCode && (
                  <>
                    {" "}
                    · guía <b>{o.trackingCode}</b>
                  </>
                )}
              </p>
            )}

            <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              {o.items.map((i) => (
                <div key={i.name} className="flex justify-between">
                  <span>
                    {i.quantity}× {i.name}
                    {i.variant ? ` (${i.variant})` : ""}
                  </span>
                  <span>{(Number(i.unitPrice) * i.quantity).toFixed(2)}</span>
                </div>
              ))}
              <div className="mt-1 flex justify-between border-t border-zinc-200 pt-1 font-medium dark:border-zinc-800">
                <span>Total ({o.rateType === "CON RECAUDO" ? "contra entrega" : "pagado"})</span>
                <span>{money(o)}</span>
              </div>
              {o.notes && <p className="mt-1 text-xs text-zinc-500">{o.notes}</p>}
            </div>

            {o.uploadError && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
                {o.uploadError}
              </div>
            )}
            {o.risk && (
              <p className="text-xs text-zinc-500">
                Huella: {o.risk.delivered} entregados, {o.risk.returned} devueltos
                {o.risk.deliveryRate != null && ` (${o.risk.deliveryRate}% de entrega)`}.
              </p>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-medium">Datos de entrega</h3>
              {o.customer.agencia && (
                <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm dark:border-sky-900 dark:bg-sky-950">
                  <span className="font-medium">Retira en agencia Servientrega:</span>{" "}
                  {agencyLabel(o.customer.agencia)}
                </p>
              )}
              {FIELDS.map((f) => (
                <label key={f.key} className="block text-sm">
                  <span className="label">
                    {f.label}
                    {f.key === "telefono" && form.telefono && (
                      <span className="ml-1 font-normal text-zinc-500">
                        ({displayPhone(form.telefono, o.contactPhone)})
                      </span>
                    )}
                  </span>
                  <input
                    className="input"
                    disabled={!local}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  />
                </label>
              ))}
              {!local && (
                <p className="text-xs text-zinc-500">
                  Ya está en Dropi: los cambios de dirección o cancelación se hacen en Dropi.
                </p>
              )}
            </div>

            <ErrorText>{error}</ErrorText>
            {note && <p className="text-sm text-brand-700 dark:text-brand-400">{note}</p>}
            {local && (
              <div className="flex flex-wrap gap-2">
                {o.stage === "revision" ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={!!busy}
                    onClick={() => upload(true)}
                  >
                    {busy === "subir" ? "Subiendo…" : "Aprobar y subir"}
                  </button>
                ) : (
                  <button type="button" className="btn" disabled={!!busy} onClick={() => upload()}>
                    {busy === "subir"
                      ? "Subiendo…"
                      : o.stage === "error_subida"
                        ? "Reintentar subida"
                        : "Subir a Dropi"}
                  </button>
                )}
                {dirty && (
                  <button type="button" className="btn-ghost" disabled={!!busy} onClick={saveData}>
                    Guardar datos
                  </button>
                )}
                <button
                  type="button"
                  className="btn-ghost text-red-600"
                  disabled={!!busy}
                  onClick={cancel}
                >
                  Cancelar pedido
                </button>
              </div>
            )}
            {o.conversationId && (
              <Link
                href={`/panel/inbox?c=${o.conversationId}`}
                className="block text-sm text-brand-700 hover:underline dark:text-brand-400"
              >
                Ver la conversación →
              </Link>
            )}

            <div>
              <h3 className="mb-2 text-sm font-medium">Historial</h3>
              <ol className="space-y-2 border-l border-zinc-200 pl-3 text-xs dark:border-zinc-800">
                {o.events.map((e) => (
                  <li key={e.id}>
                    <span className="text-zinc-500">
                      {when(e.createdAt)} · {e.source}
                    </span>
                    <div>{e.message || e.rawStatus}</div>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

type ProductRow = { id: string; name: string; price: string; currency: string; status: string };
type ProductDetail = ProductRow & {
  offers: { quantity: number; totalPrice: string; label?: string | null }[];
  variants: { name: string; price: string | null }[];
};
type Line = { productId: string; quantity: number; variant: string };

/** Precio como lo calcula el API: oferta por cantidad, si no variante/producto × cantidad. */
function linePrice(p: ProductDetail | undefined, l: Line) {
  if (!p) return 0;
  const offer = p.offers.find((o) => o.quantity === l.quantity);
  if (offer) return Number(offer.totalPrice);
  const v = p.variants.find((x) => x.name === l.variant);
  return Number(v?.price ?? p.price) * l.quantity;
}

const EMPTY_CUSTOMER = {
  nombre: "",
  apellido: "",
  telefono: "",
  provincia: "",
  ciudad: "",
  direccion: "",
  referencia: "",
};

/**
 * Pedido ingresado a mano (llamada, local, otra red): datos del cliente, productos con el
 * precio del catálogo y, si se quiere, subida a Dropi en el mismo paso.
 */
function NewOrderPanel({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (orderId: string) => void;
}) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [details, setDetails] = useState<Record<string, ProductDetail>>({});
  const [customer, setCustomer] = useState(EMPTY_CUSTOMER);
  const [lines, setLines] = useState<Line[]>([]);
  const [total, setTotal] = useState("");
  const [rateType, setRateType] = useState("CON RECAUDO");
  const [notes, setNotes] = useState("");
  const [upload, setUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<ProductRow[]>("/api/products")
      .then((rows) => {
        const list = rows.filter((r) => r.status !== "inactivo");
        setProducts(list);
        if (list[0]) setLines([{ productId: list[0].id, quantity: 1, variant: "" }]);
      })
      .catch((e) => setError(errorMessage(e)));
    // Solo dueños/admin leen la integración; si responde, se sugiere subir al guardar.
    api<{ connected?: boolean }>("/api/integrations/dropi")
      .then((d) => setUpload(Boolean(d.connected)))
      .catch(() => {});
  }, []);

  // Ofertas y variantes de cada producto elegido (para el precio y el selector).
  useEffect(() => {
    for (const l of lines)
      if (l.productId && !details[l.productId])
        api<ProductDetail>(`/api/products/${l.productId}`)
          .then((d) => setDetails((x) => ({ ...x, [d.id]: d })))
          .catch(() => {});
  }, [lines, details]);

  const computed = lines.reduce((sum, l) => sum + linePrice(details[l.productId], l), 0);
  const currency = details[lines[0]?.productId ?? ""]?.currency ?? products[0]?.currency ?? "";
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const field = (key: keyof typeof EMPTY_CUSTOMER) => ({
    value: customer[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setCustomer({ ...customer, [key]: e.target.value }),
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ order: { id: string } }>("/api/orders", {
        method: "POST",
        body: {
          customer,
          items: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            ...(l.variant ? { variant: l.variant } : {}),
          })),
          ...(total.trim() ? { total: Number(total.replace(",", ".")) } : {}),
          rateType,
          notes,
          upload,
        },
      });
      onCreated(r.order.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <form
        onSubmit={save}
        className="relative h-full w-full max-w-md space-y-4 overflow-y-auto bg-white p-5 shadow-xl dark:bg-zinc-950"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Nuevo pedido</h2>
            <p className="text-sm text-zinc-500">
              Para ventas por llamada, en el local o por otra red social.
            </p>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Cerrar">
            <X className="size-4" />
          </button>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Cliente</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">Nombre</span>
              <input className="input" required {...field("nombre")} />
            </label>
            <label className="block">
              <span className="label">Apellido</span>
              <input className="input" {...field("apellido")} />
            </label>
          </div>
          <label className="block">
            <span className="label">Teléfono / WhatsApp</span>
            <input
              className="input"
              required
              inputMode="tel"
              placeholder="0991234567"
              {...field("telefono")}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">Ciudad</span>
              <input className="input" required {...field("ciudad")} />
            </label>
            <label className="block">
              <span className="label">Provincia</span>
              <input className="input" placeholder="Opcional" {...field("provincia")} />
            </label>
          </div>
          <label className="block">
            <span className="label">Dirección</span>
            <input className="input" required minLength={3} {...field("direccion")} />
          </label>
          <label className="block">
            <span className="label">Referencia</span>
            <input className="input" placeholder="Cerca de…" {...field("referencia")} />
          </label>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Productos</h3>
          {products.length === 0 && (
            <p className="text-sm text-zinc-500">
              No hay productos en el catálogo.{" "}
              <Link href="/panel/catalogo" className="underline">
                Crea uno primero
              </Link>
              .
            </p>
          )}
          {lines.map((l, i) => {
            const d = details[l.productId];
            const offer = d?.offers.find((o) => o.quantity === l.quantity);
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: líneas sin id propio
                key={i}
                className="space-y-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800"
              >
                <div className="flex gap-2">
                  <select
                    className="input min-w-0 flex-1"
                    aria-label="Producto"
                    value={l.productId}
                    onChange={(e) => setLine(i, { productId: e.target.value, variant: "" })}
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input w-20"
                    type="number"
                    min={1}
                    max={99}
                    aria-label="Cantidad"
                    value={l.quantity}
                    onChange={(e) =>
                      setLine(i, { quantity: Math.max(1, Number(e.target.value) || 1) })
                    }
                  />
                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="btn-ghost"
                      aria-label="Quitar producto"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                {d && d.variants.length > 0 && (
                  <select
                    className="input"
                    aria-label="Variante"
                    value={l.variant}
                    onChange={(e) => setLine(i, { variant: e.target.value })}
                  >
                    <option value="">Sin variante</option>
                    {d.variants.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                        {v.price ? ` · ${Number(v.price).toFixed(2)}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                <div className="text-xs text-zinc-500">
                  {d
                    ? `${linePrice(d, l).toFixed(2)} ${d.currency}${offer ? ` · oferta ${offer.label || `${offer.quantity} unidades`}` : ""}`
                    : "Calculando precio…"}
                </div>
              </div>
            );
          })}
          {products.length > 0 && lines.length < 10 && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() =>
                setLines((ls) => [
                  ...ls,
                  { productId: products[0]?.id ?? "", quantity: 1, variant: "" },
                ])
              }
            >
              <Plus className="size-4" /> Otro producto
            </button>
          )}
        </section>

        <section className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">Total a cobrar</span>
              <input
                className="input"
                inputMode="decimal"
                placeholder={computed ? computed.toFixed(2) : "0.00"}
                value={total}
                onChange={(e) => setTotal(e.target.value)}
              />
              <span className="mt-1 block text-xs text-zinc-500">
                Vacío = {computed.toFixed(2)} {currency} del catálogo
              </span>
            </label>
            <label className="block">
              <span className="label">Cobro</span>
              <select
                className="input"
                value={rateType}
                onChange={(e) => setRateType(e.target.value)}
              >
                <option value="CON RECAUDO">Contra entrega</option>
                <option value="SIN RECAUDO">Ya pagado</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="label">Notas</span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={upload} onChange={(e) => setUpload(e.target.checked)} />
            Subir a Dropi al guardar
          </label>
        </section>

        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <button type="submit" className="btn" disabled={busy || lines.length === 0}>
            {busy ? (upload ? "Guardando y subiendo…" : "Guardando…") : "Crear pedido"}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

/** Suma de los pedidos de una columna (con su moneda). */
function columnTotal(list: Order[]) {
  if (!list.length) return "";
  const sum = list.reduce((s, o) => s + Number(o.total), 0);
  return `${sum.toFixed(2)} ${list[0]?.currency ?? ""}`;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  /** Etapas a mostrar cuando se llega desde el Inicio (?etapa=novedad,en_oficina). */
  const [only, setOnly] = useState<OrderStage[] | null>(null);

  // Enlaces desde el Inicio y los avisos: ?etapa=…, ?pedido=…, ?nuevo=1.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const stages = (p.get("etapa") ?? "")
      .split(",")
      .filter((x): x is OrderStage => x in ORDER_STAGES);
    if (stages.length) setOnly(stages);
    const pedido = p.get("pedido");
    if (pedido) setOpen(pedido);
    if (p.get("nuevo")) setCreating(true);
  }, []);
  const clearFilter = () => {
    setOnly(null);
    window.history.replaceState(null, "", "/panel/pedidos");
  };

  const load = useCallback(async () => {
    try {
      setOrders(await api<Order[]>("/api/orders"));
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const needle = q.trim().toLowerCase();
  const byStage = only ? orders.filter((o) => only.includes(o.stage)) : orders;
  const shown = needle
    ? byStage.filter((o) =>
        [fullName(o.customer), o.customer.telefono, o.customer.ciudad, o.dropiOrderId ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    : byStage;
  const pending = orders.filter((o) => LOCAL_STAGES.includes(o.stage)).length;

  return (
    <>
      <PageHeader
        icon={Package}
        title="Pedidos"
        description="Ventas cerradas por la IA o por tu equipo, su subida a Dropi y su estado logístico."
        actions={
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Nuevo pedido
          </button>
        }
      />
      <NotifyBanner />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          className="input max-w-xs"
          placeholder="Buscar por nombre, teléfono, ciudad o #Dropi"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn-ghost" onClick={load}>
          Actualizar
        </button>
        {only && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-800 dark:bg-brand-950 dark:text-brand-200">
            Solo: {only.map((s) => ORDER_STAGES[s]).join(", ")}
            <button type="button" aria-label="Ver todos" onClick={clearFilter}>
              <X className="size-3.5" />
            </button>
          </span>
        )}
        {pending > 0 && (
          <span className="text-sm text-amber-700 dark:text-amber-400">
            {pending} pedido{pending === 1 ? "" : "s"} sin subir a Dropi
          </span>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      {!orders.length && !error && (
        <p className="text-sm text-zinc-500">
          Aún no hay pedidos. Se crean cuando un cliente confirma con la IA, desde la bandeja con
          «Crear pedido» o aquí con «Nuevo pedido».
        </p>
      )}
      {orders.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {COLUMNS.map((col) => {
            const list = shown.filter((o) => col.stages.includes(o.stage));
            return (
              <section key={col.title} className="w-64 shrink-0">
                <h2 className="mb-2 text-sm font-medium">
                  <span className="flex items-center justify-between">
                    {col.title}
                    <span className="text-xs text-zinc-500">{list.length}</span>
                  </span>
                  {list.length > 0 && (
                    <span className="block text-xs font-normal text-brand-700 dark:text-brand-400">
                      {columnTotal(list)}
                    </span>
                  )}
                </h2>
                <div className="space-y-2">
                  {list.map((o) => (
                    <Card key={o.id} o={o} onOpen={() => setOpen(o.id)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {open && <OrderPanel id={open} onClose={() => setOpen(null)} onChange={load} />}
      {creating && (
        <NewOrderPanel
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            // Que el pedido nuevo se vea aunque se viniera filtrando por otra etapa.
            clearFilter();
            load();
            setOpen(id);
          }}
        />
      )}
    </>
  );
}
