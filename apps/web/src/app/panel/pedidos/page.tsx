"use client";
import { agencyLabel, LOCAL_STAGES, ORDER_STAGES, type OrderStage } from "@chatea/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
      className="w-full rounded-lg border border-zinc-200 bg-white p-3 text-left text-sm hover:border-emerald-400 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{fullName(o.customer)}</span>
        <span className="shrink-0 text-xs">{money(o)}</span>
      </div>
      <div className="mt-0.5 truncate text-xs text-zinc-500">
        {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")} · {o.customer.ciudad || "—"}
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
                  <span className="label">{f.label}</span>
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
            {note && <p className="text-sm text-emerald-700 dark:text-emerald-400">{note}</p>}
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
                className="block text-sm text-emerald-700 hover:underline dark:text-emerald-400"
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

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");

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
  const shown = needle
    ? orders.filter((o) =>
        [fullName(o.customer), o.customer.telefono, o.customer.ciudad, o.dropiOrderId ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    : orders;
  const pending = orders.filter((o) => LOCAL_STAGES.includes(o.stage)).length;

  return (
    <>
      <PageHeader
        title="Pedidos"
        description="Ventas cerradas por la IA o por tu equipo, su subida a Dropi y su estado logístico."
      />
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
        {pending > 0 && (
          <span className="text-sm text-amber-700 dark:text-amber-400">
            {pending} pedido{pending === 1 ? "" : "s"} sin subir a Dropi
          </span>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      {!orders.length && !error && (
        <p className="text-sm text-zinc-500">
          Aún no hay pedidos. Se crean cuando un cliente confirma con la IA o desde la bandeja con
          «Crear pedido».
        </p>
      )}
      {orders.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {COLUMNS.map((col) => {
            const list = shown.filter((o) => col.stages.includes(o.stage));
            return (
              <section key={col.title} className="w-64 shrink-0">
                <h2 className="mb-2 flex items-center justify-between text-sm font-medium">
                  {col.title}
                  <span className="text-xs text-zinc-500">{list.length}</span>
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
    </>
  );
}
