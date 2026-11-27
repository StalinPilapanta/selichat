"use client";
import {
  agencyLabel,
  displayPhone,
  LOCAL_STAGES,
  ORDER_STAGES,
  type OrderStage,
} from "@chatea/shared";
import { KanbanSquare, List, Package, Plus, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { OrderFormPanel, orderFormInitial } from "@/components/orders/OrderForm";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

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
  { title: "En camino", stages: ["en_transito"] },
  { title: "En agencia", stages: ["en_oficina"] },
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
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  /**
   * Formulario para corregir y subir. Un pedido que aún no está en Dropi se abre directo en el
   * formulario; al cerrarlo queda el detalle (historial, aprobar o cancelar).
   */
  const [editing, setEditing] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<Detail>(`/api/orders/${id}`);
      setO(d);
      setEditing((e) => (e === null ? LOCAL_STAGES.includes(d.stage) && !d.dropiOrderId : e));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const local = o ? LOCAL_STAGES.includes(o.stage) && !o.dropiOrderId : false;

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

  const upload = (force = false) =>
    run("subir", async () => {
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
        {!o ? (
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
              <dl className="space-y-1 text-sm">
                {FIELDS.filter((f) => o.customer[f.key]?.trim()).map((f) => (
                  <div key={f.key} className="flex gap-2">
                    <dt className="w-24 shrink-0 text-zinc-500">{f.label}</dt>
                    <dd className="min-w-0 break-words">
                      {f.key === "telefono"
                        ? displayPhone(o.customer.telefono ?? "", o.contactPhone)
                        : o.customer[f.key]}
                    </dd>
                  </div>
                ))}
              </dl>
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
                <button
                  type="button"
                  className="btn"
                  disabled={!!busy}
                  onClick={() => setEditing(true)}
                >
                  <Upload className="size-4" />
                  Revisar y subir a Dropi
                </button>
                {o.stage === "revision" && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!!busy}
                    onClick={() => upload(true)}
                  >
                    {busy === "subir" ? "Subiendo…" : "Aprobar y subir"}
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

            {editing && local && (
              <OrderFormPanel
                initial={orderFormInitial(o)}
                orderId={o.id}
                uploadByDefault
                title="Revisar y subir a Dropi"
                subtitle={
                  o.uploadError
                    ? `No se subió: ${o.uploadError}`
                    : "Revisa los datos antes de subirlos; puedes corregir lo que haga falta."
                }
                onClose={() => setEditing(false)}
                onCreated={async (_id, result) => {
                  setEditing(false);
                  setNote(
                    !result
                      ? "Datos guardados. Queda por subir a Dropi."
                      : result.status === "subido"
                        ? "Subido a Dropi ✓"
                        : result.status === "revision"
                          ? "No se subió: quedó en «Revisar» para un dueño o administrador."
                          : "Datos guardados, pero no se pudo subir: revisa el motivo.",
                  );
                  await load();
                  onChange();
                }}
              />
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

/** Suma de los pedidos de una columna (con su moneda). */
function columnTotal(list: Order[]) {
  if (!list.length) return "";
  const sum = list.reduce((s, o) => s + Number(o.total), 0);
  return `${sum.toFixed(2)} ${list[0]?.currency ?? ""}`;
}

// ---------- Vista Lista ----------

type Period = "hoy" | "7" | "30" | "rango";
const PERIODS: [Exclude<Period, "rango">, string][] = [
  ["hoy", "Hoy"],
  ["7", "7 días"],
  ["30", "30 días"],
];
/** Fecha local YYYY-MM-DD para los campos de fecha. */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Rango [desde, hasta) en hora local; «hasta» incluye el día elegido completo. */
function rangeOf(p: Period, from: string, to: string): { desde: Date; hasta: Date } | null {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (p === "hoy") return { desde: start, hasta: new Date(start.getTime() + 86_400_000) };
  if (p !== "rango") {
    const d = new Date(start);
    d.setDate(d.getDate() - Number(p) + 1);
    return { desde: d, hasta: new Date(start.getTime() + 86_400_000) };
  }
  if (!from || !to || from > to) return null;
  const end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { desde: new Date(`${from}T00:00:00`), hasta: end };
}

/**
 * Lista de pedidos: pestañas por estado con su contador, filtros por fecha y producto,
 * y una fila por pedido que abre el mismo panel de detalle del tablero. Pide al servidor solo
 * los pedidos del rango de fechas, así no se cargan todos de golpe.
 */
function OrdersList({
  match,
  version,
  onOpen,
}: {
  /** Buscador y etapa que vienen de la página (los mismos del tablero). */
  match: (o: Order) => boolean;
  /** Cambia en cada «Actualizar» o cambio de un pedido: vuelve a pedir la lista. */
  version: number;
  onOpen: (id: string) => void;
}) {
  const [tab, setTab] = useState<string>("Todos");
  const [period, setPeriod] = useState<Period>("30");
  const [from, setFrom] = useState(() => ymd(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(() => ymd(new Date()));
  const [product, setProduct] = useState("");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState("");

  const range = rangeOf(period, from, to);
  const desde = range?.desde.toISOString();
  const hasta = range?.hasta.toISOString();
  // biome-ignore lint/correctness/useExhaustiveDependencies: version fuerza la recarga
  useEffect(() => {
    if (!desde || !hasta) return;
    let alive = true;
    api<Order[]>(
      `/api/orders?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
    )
      .then((r) => {
        if (!alive) return;
        setOrders(r);
        setError("");
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [desde, hasta, version]);

  const all = orders ?? [];
  const productNames = [...new Set(all.flatMap((o) => o.items.map((i) => i.name)))].sort();
  // Buscador y producto primero; las pestañas cuentan sobre ese resultado.
  const filtered = all.filter(
    (o) => match(o) && (!product || o.items.some((i) => i.name === product)),
  );
  const tabs = [
    { title: "Todos", stages: null as OrderStage[] | null },
    ...COLUMNS.map((c) => ({ title: c.title, stages: c.stages as OrderStage[] | null })),
  ];
  const current = tabs.find((t) => t.title === tab) ?? tabs[0];
  const rows = current?.stages
    ? filtered.filter((o) => current.stages?.includes(o.stage))
    : filtered;
  const sum = rows.reduce((acc, o) => acc + Number(o.total), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="flex rounded-xl border border-zinc-200 p-0.5 dark:border-zinc-800">
          {([...PERIODS, ["rango", "Fechas"]] as [Period, string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={period === k}
              onClick={() => setPeriod(k)}
              className={`rounded-lg px-2.5 py-1 ${
                period === k
                  ? "bg-brand-600 text-brand-ink"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {period === "rango" && (
          <span className="flex items-center gap-1.5">
            <input
              type="date"
              className="input w-auto"
              aria-label="Desde"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-zinc-500">a</span>
            <input
              type="date"
              className="input w-auto"
              aria-label="Hasta"
              value={to}
              min={from}
              max={ymd(new Date())}
              onChange={(e) => setTo(e.target.value)}
            />
          </span>
        )}
        <select
          className="input w-auto"
          aria-label="Producto"
          value={product}
          onChange={(e) => setProduct(e.target.value)}
        >
          <option value="">Todos los productos</option>
          {productNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {(period !== "30" || product) && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setPeriod("30");
              setProduct("");
            }}
          >
            Quitar filtros
          </button>
        )}
      </div>
      {period === "rango" && !range && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Elige una fecha de inicio anterior a la fecha final.
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      {all.length >= 1000 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Se muestran los 1000 pedidos más recientes del rango. Acorta las fechas para ver el resto.
        </p>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((t) => {
          const n = t.stages
            ? filtered.filter((o) => t.stages?.includes(o.stage)).length
            : filtered.length;
          const active = t.title === current?.title;
          return (
            <button
              key={t.title}
              type="button"
              onClick={() => setTab(t.title)}
              aria-pressed={active}
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
                active
                  ? "border-brand-600 font-medium text-brand-800 dark:text-brand-300"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {t.title}
              <span className="rounded-full bg-zinc-100 px-1.5 text-xs dark:bg-zinc-800">{n}</span>
            </button>
          );
        })}
      </div>

      {orders === null ? (
        <p className="py-6 text-center text-sm text-zinc-500">Cargando pedidos…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No hay pedidos con estos filtros.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Ciudad</th>
                <th className="px-3 py-2 font-medium">Productos</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Origen</th>
                <th className="px-3 py-2 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => onOpen(o.id)}
                  className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-left font-medium hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(o.id);
                      }}
                    >
                      {fullName(o.customer)}
                    </button>
                    {o.customer.telefono && (
                      <div className="text-xs text-zinc-500">
                        {displayPhone(o.customer.telefono, o.contactPhone)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">{o.customer.ciudad || "—"}</td>
                  <td className="max-w-64 px-3 py-2">
                    <div className="truncate">
                      {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                    </div>
                    {o.customer.agencia && (
                      <div className="truncate text-xs text-zinc-500">Retiro en agencia</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{money(o)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <StageBadge stage={o.stage} />
                      {o.stage === "en_oficina" && <DaysInAgency since={o.stageSince} />}
                      {o.dropiOrderId && (
                        <span className="text-[11px] text-zinc-500">#{o.dropiOrderId}</span>
                      )}
                    </div>
                    {o.uploadError && (
                      <div className="mt-0.5 max-w-56 truncate text-[11px] text-red-600 dark:text-red-400">
                        {o.uploadError}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {o.source === "ia" ? "IA" : "Asesor"}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap text-zinc-500">
                    {when(o.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-zinc-50 text-sm dark:bg-zinc-900">
              <tr>
                <td className="px-3 py-2 text-zinc-500" colSpan={3}>
                  {rows.length} pedido{rows.length === 1 ? "" : "s"}
                </td>
                <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  {sum.toFixed(2)} {rows[0]?.currency ?? ""}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/** useSearchParams necesita un Suspense para que la página se pueda prerenderizar. */
export default function OrdersPageRoute() {
  return (
    <Suspense>
      <OrdersPage />
    </Suspense>
  );
}

function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  /** Etapas a mostrar cuando se llega desde el Inicio (?etapa=novedad,en_oficina). */
  const [only, setOnly] = useState<OrderStage[] | null>(null);
  /** Tablero o lista; se recuerda en este equipo. */
  const [view, setView] = useState<"tablero" | "lista">("tablero");
  useEffect(() => {
    try {
      if (localStorage.getItem("selichat:vistaPedidos") === "lista") setView("lista");
    } catch {}
  }, []);
  const switchView = (v: "tablero" | "lista") => {
    setView(v);
    try {
      localStorage.setItem("selichat:vistaPedidos", v);
    } catch {}
  };

  const params = useSearchParams();
  const router = useRouter();
  // Enlaces desde el Inicio, la barra superior y los avisos: ?etapa=…, ?pedido=…, ?nuevo=1.
  // Se leen en vivo: funcionan aunque ya se esté en Pedidos.
  useEffect(() => {
    const stages = (params.get("etapa") ?? "")
      .split(",")
      .filter((x): x is OrderStage => x in ORDER_STAGES);
    setOnly(stages.length ? stages : null);
    const pedido = params.get("pedido");
    const nuevo = params.get("nuevo");
    if (pedido) setOpen(pedido);
    if (nuevo) setCreating(true);
    // Acciones de una sola vez: se quitan de la dirección para poder repetirlas.
    if (pedido || nuevo) {
      const etapa = params.get("etapa");
      router.replace(etapa ? `/panel/pedidos?etapa=${etapa}` : "/panel/pedidos", {
        scroll: false,
      });
    }
  }, [params, router]);
  const clearFilter = () => {
    setOnly(null);
    router.replace("/panel/pedidos", { scroll: false });
  };

  /** Sube en cada recarga para que la vista Lista vuelva a pedir sus pedidos. */
  const [version, setVersion] = useState(0);
  const load = useCallback(async () => {
    setVersion((v) => v + 1);
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
  const matches = (o: Order) =>
    (!only || only.includes(o.stage)) &&
    (!needle ||
      [fullName(o.customer), o.customer.telefono, o.customer.ciudad, o.dropiOrderId ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle));
  const shown = orders.filter(matches);
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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl border border-zinc-200 p-0.5 dark:border-zinc-800">
          {(
            [
              ["tablero", "Tablero", KanbanSquare],
              ["lista", "Lista", List],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              aria-pressed={view === k}
              onClick={() => switchView(k)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${
                view === k
                  ? "bg-brand-600 text-brand-ink"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
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
      {orders.length > 0 && view === "lista" && (
        <OrdersList match={matches} version={version} onOpen={setOpen} />
      )}
      {orders.length > 0 && view === "tablero" && (
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
        <OrderFormPanel
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
