"use client";
import {
  formatPhone,
  LEAD_HIDE_HOURS,
  LEAD_SOLD,
  LEAD_STAGE_KEYS,
  LEAD_STAGES,
  type LeadStage,
  LOST_REASON_KEYS,
  LOST_REASONS,
  ORDER_STAGES,
  type OrderStage,
} from "@chatea/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Lead = {
  id: string;
  stage: LeadStage;
  stageAt: string;
  lostReason: string | null;
  name: string | null;
  profileName: string | null;
  phone: string;
  productName: string | null;
  orderTotal: string | null;
  order: {
    stage: OrderStage;
    dropiStatus: string | null;
    dropiOrderId: string | null;
    trackingCode: string | null;
  } | null;
  price: string | null;
  currency: string;
  assignedName: string | null;
  fromAd: boolean;
  adHeadline: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  botPaused: boolean;
  unreadCount: number;
};

const COLUMN_STYLE: Record<LeadStage, string> = {
  interesado: "border-t-sky-500",
  datos: "border-t-amber-500",
  ganado: "border-t-emerald-500",
  en_agencia: "border-t-violet-500",
  cerrado: "border-t-zinc-400",
  perdido: "border-t-red-500",
};

const COLUMN_HINT: Partial<Record<LeadStage, string>> = {
  ganado: "Con pedido: guía, en camino y novedades",
  en_agencia: "Para retiro en agencia Servientrega",
  cerrado: `Entregados · se borran a las ${LEAD_HIDE_HOURS.cerrado} h`,
  perdido: `Sin respuesta o cancelados · se borran a las ${LEAD_HIDE_HOURS.perdido} h`,
};

/** Valor del lead: el pedido; si no hay, el precio del producto (estimado). */
const leadValue = (l: Lead) => Number(l.orderTotal ?? l.price ?? 0);
const isEstimate = (l: Lead) => !l.orderTotal && Boolean(l.price);
const money = (n: number, currency: string) =>
  `${currency === "USD" ? "$" : `${currency} `}${n.toFixed(2)}`;
const nameOf = (l: Lead) => l.name || l.profileName || formatPhone(l.phone);
const daysSince = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400_000);

function Card({
  l,
  onMove,
  onDragStart,
}: {
  l: Lead;
  onMove: (stage: LeadStage) => void;
  onDragStart: () => void;
}) {
  const days = daysSince(l.stageAt);
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", l.id);
        onDragStart();
      }}
      className="rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/panel/inbox?c=${l.id}`}
          className="truncate font-medium hover:text-emerald-700 dark:hover:text-emerald-400"
        >
          {nameOf(l)}
        </Link>
        {leadValue(l) > 0 && (
          <span
            className="shrink-0 text-xs font-medium"
            title={isEstimate(l) ? "Estimado: precio del producto" : "Total del pedido"}
          >
            {isEstimate(l) ? "~" : ""}
            {money(leadValue(l), l.currency)}
          </span>
        )}
      </div>
      <div className="mt-0.5 truncate text-xs text-zinc-500">
        {l.productName ?? "Sin producto"}
        {l.assignedName ? ` · ${l.assignedName}` : ""}
      </div>
      {l.order && LEAD_SOLD.includes(l.stage) && (
        <div className="mt-1 truncate text-xs">
          <span className="font-medium">{ORDER_STAGES[l.order.stage] ?? l.order.stage}</span>
          {l.order.dropiOrderId ? ` · #${l.order.dropiOrderId}` : ""}
          {l.order.trackingCode ? ` · guía ${l.order.trackingCode}` : ""}
        </div>
      )}
      {l.lastMessagePreview && (
        <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
          {l.lastMessagePreview}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
        <span
          className={`rounded-full px-1.5 py-0.5 ${
            l.stage === "en_agencia" && days >= 4
              ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
              : (l.stage === "en_agencia" && days >= 2) ||
                  (days >= 1 && (l.stage === "datos" || l.stage === "interesado"))
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          {days === 0 ? "hoy" : `${days} día${days === 1 ? "" : "s"}`}
          {l.stage === "en_agencia" ? " en agencia" : ""}
        </span>
        {l.fromAd && (
          <span
            className="rounded-full bg-violet-100 px-1.5 py-0.5 text-violet-800 dark:bg-violet-950 dark:text-violet-200"
            title={l.adHeadline ?? "Vino de un anuncio"}
          >
            📣 Anuncio
          </span>
        )}
        {l.botPaused && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Humano
          </span>
        )}
        {l.unreadCount > 0 && (
          <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-white">
            {l.unreadCount}
          </span>
        )}
        {l.stage === "perdido" && l.lostReason && (
          <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-red-800 dark:bg-red-950 dark:text-red-200">
            {LOST_REASONS[l.lostReason as keyof typeof LOST_REASONS] ?? l.lostReason}
          </span>
        )}
      </div>
      <label className="mt-2 block">
        <span className="sr-only">Mover a</span>
        <select
          className="w-full rounded border border-zinc-200 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-700"
          value=""
          onChange={(e) => e.target.value && onMove(e.target.value as LeadStage)}
        >
          <option value="">Mover a…</option>
          {LEAD_STAGE_KEYS.filter((s) => s !== l.stage).map((s) => (
            <option key={s} value={s}>
              {LEAD_STAGES[s]}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}

/** Al pasar a «Perdido» se pide el motivo (para saber dónde y por qué se pierden). */
function LostDialog({
  lead,
  onCancel,
  onConfirm,
}: {
  lead: Lead;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-sm space-y-3">
        <h2 className="font-medium">¿Por qué se perdió {nameOf(lead)}?</h2>
        <div className="space-y-1">
          {LOST_REASON_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="lost-reason"
                checked={reason === k}
                onChange={() => setReason(k)}
              />
              {LOST_REASONS[k]}
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn"
            disabled={!reason}
            onClick={() => onConfirm(reason)}
          >
            Marcar como perdido
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<LeadStage | null>(null);
  const [losing, setLosing] = useState<Lead | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      setLeads(await api<Lead[]>(`/api/leads?${params}`));
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoaded(true);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    const i = setInterval(load, 30_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [load, q]);

  async function move(lead: Lead, stage: LeadStage, lostReason?: string) {
    if (stage === "perdido" && !lostReason) {
      setLosing(lead);
      return;
    }
    // Optimista: se mueve ya y se corrige si el servidor falla.
    const prev = leads;
    setLeads((ls) =>
      ls.map((l) =>
        l.id === lead.id
          ? { ...l, stage, stageAt: new Date().toISOString(), lostReason: lostReason ?? null }
          : l,
      ),
    );
    try {
      await api(`/api/leads/${lead.id}`, { method: "PATCH", body: { stage, lostReason } });
    } catch (e) {
      setLeads(prev);
      setError(errorMessage(e));
    }
  }

  const open = leads.filter((l) => l.stage === "interesado" || l.stage === "datos");
  const currency = leads[0]?.currency ?? "USD";
  const pipeline = open.reduce((s, l) => s + leadValue(l), 0);
  const won = leads.filter((l) => LEAD_SOLD.includes(l.stage));
  const lost = leads.filter((l) => l.stage === "perdido");
  const finished = won.length + lost.length;
  const rate = finished ? Math.round((won.length / finished) * 100) : null;

  return (
    <>
      <PageHeader
        title="Leads"
        description="Cada conversación es un lead: avanza solo con la IA y con el estado del pedido en Dropi, y puedes moverlo a mano."
      />
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <div className="card py-2">
          <div className="text-xs text-zinc-500">En el embudo</div>
          <div className="text-lg font-semibold">
            {open.length} · {money(pipeline, currency)}
          </div>
        </div>
        <div className="card py-2">
          <div className="text-xs text-zinc-500">Vendidos (ganado, en agencia, cerrado)</div>
          <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">
            {won.length} ·{" "}
            {money(
              won.reduce((s, l) => s + leadValue(l), 0),
              currency,
            )}
          </div>
        </div>
        <div className="card py-2">
          <div className="text-xs text-zinc-500">
            Perdidos (últimas {LEAD_HIDE_HOURS.perdido} h)
          </div>
          <div className="text-lg font-semibold text-red-700 dark:text-red-400">{lost.length}</div>
        </div>
        <div className="card py-2">
          <div className="text-xs text-zinc-500">Cierre (ganados / finalizados)</div>
          <div className="text-lg font-semibold">{rate == null ? "—" : `${rate}%`}</div>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          className="input max-w-xs"
          placeholder="Buscar por nombre, teléfono o producto"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn-ghost" onClick={load}>
          Actualizar
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
      {loaded && !leads.length && !error && (
        <p className="text-sm text-zinc-500">
          Aún no hay leads. Aparecen solos cuando un cliente escribe por WhatsApp.
        </p>
      )}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {LEAD_STAGE_KEYS.map((stage) => {
          const list = leads.filter((l) => l.stage === stage);
          const total = list.reduce((s, l) => s + leadValue(l), 0);
          return (
            <section
              key={stage}
              aria-label={LEAD_STAGES[stage]}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(stage);
              }}
              onDragLeave={() => setOver((o) => (o === stage ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const lead = leads.find((l) => l.id === e.dataTransfer.getData("text/plain"));
                if (lead && lead.stage !== stage) move(lead, stage);
                setDragging(null);
              }}
              className={`w-64 shrink-0 rounded-lg border-t-4 bg-zinc-50 p-2 dark:bg-zinc-950 ${COLUMN_STYLE[stage]} ${
                over === stage && dragging ? "ring-2 ring-emerald-400" : ""
              }`}
            >
              <h2 className="mb-2 flex items-center justify-between text-sm font-medium">
                {LEAD_STAGES[stage]}
                <span className="text-xs font-normal text-zinc-500">
                  {list.length}
                  {total > 0 ? ` · ${money(total, currency)}` : ""}
                </span>
              </h2>
              {COLUMN_HINT[stage] && (
                <p className="-mt-1 mb-2 text-[11px] text-zinc-500">{COLUMN_HINT[stage]}</p>
              )}
              <div className="space-y-2">
                {list.map((l) => (
                  <Card
                    key={l.id}
                    l={l}
                    onMove={(s) => move(l, s)}
                    onDragStart={() => setDragging(l.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {losing && (
        <LostDialog
          lead={losing}
          onCancel={() => setLosing(null)}
          onConfirm={(reason) => {
            const l = losing;
            setLosing(null);
            move(l, "perdido", reason);
          }}
        />
      )}
    </>
  );
}
