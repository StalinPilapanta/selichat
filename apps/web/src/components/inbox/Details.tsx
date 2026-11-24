"use client";
import {
  agencyLabel,
  CHECKOUT_FIELDS,
  type CheckoutField,
  formatPhone,
  ORDER_STAGES,
  type OrderStage,
} from "@chatea/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { ConversationDetail, TeamMember } from "./types";

type Note = { id: string; body: string; createdAt: string; userId: string | null };

export function Details({
  conv,
  team,
  onChange,
}: {
  conv: ConversationDetail;
  team: TeamMember[];
  onChange: () => void;
}) {
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<Note[]>(`/api/conversations/${conv.id}/notes`)
      .then(setNotes)
      .catch(() => setNotes([]));
  }, [conv.id]);

  async function patch(body: object) {
    setError("");
    try {
      await api(`/api/conversations/${conv.id}`, { method: "PATCH", body });
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="space-y-5 p-4 text-sm">
      <section className="space-y-2">
        <div className="text-xs font-semibold text-zinc-400 uppercase">Cliente</div>
        <ClientInfo conv={conv} />
        <Fingerprint conversationId={conv.id} />
      </section>

      {(conv.productName || conv.referral) && (
        <section className="space-y-1">
          <div className="text-xs font-semibold text-zinc-400 uppercase">Origen</div>
          {conv.productName && conv.productId && (
            <div>
              Producto:{" "}
              <Link
                className="text-emerald-700 hover:underline dark:text-emerald-400"
                href={`/panel/catalogo/${conv.productId}`}
              >
                {conv.productName}
              </Link>
            </div>
          )}
          {conv.referral && (
            <div className="text-zinc-500">
              📣 Anuncio {conv.referral.sourceId ? `#${conv.referral.sourceId}` : ""}
              {conv.referral.headline ? ` — ${conv.referral.headline}` : ""}
            </div>
          )}
          {conv.ctwaClid && (
            <div className="truncate text-xs text-zinc-400" title={conv.ctwaClid}>
              ctwa_clid: {conv.ctwaClid}
            </div>
          )}
        </section>
      )}

      <section className="space-y-2">
        <div className="text-xs font-semibold text-zinc-400 uppercase">Atención</div>
        <label className="block">
          <span className="label">Asignada a</span>
          <select
            className="input"
            value={conv.assignedUserId ?? ""}
            onChange={(e) => patch({ assignedUserId: e.target.value || null })}
          >
            <option value="">Sin asignar</option>
            {team.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <span>
            Bot {conv.botPaused ? "pausado" : "activo"}
            <span className="block text-xs text-zinc-500">
              {conv.botPaused
                ? "La IA no responderá; atiende un humano."
                : "La IA responde a los mensajes del cliente."}
            </span>
            {conv.botPaused && conv.handoffReason && (
              <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                Motivo: {conv.handoffReason}
              </span>
            )}
          </span>
          <input
            type="checkbox"
            checked={!conv.botPaused}
            onChange={(e) => patch({ botPaused: !e.target.checked })}
          />
        </label>
        <OrderData state={conv.checkoutState ?? {}} conversationId={conv.id} />
        <button
          type="button"
          className="btn-ghost w-full"
          onClick={() => patch({ status: conv.status === "abierta" ? "cerrada" : "abierta" })}
        >
          {conv.status === "abierta" ? "Cerrar conversación" : "Reabrir conversación"}
        </button>
      </section>

      <section className="space-y-2">
        <div className="text-xs font-semibold text-zinc-400 uppercase">Etiquetas</div>
        <div className="flex flex-wrap gap-1">
          {conv.labels.map((l) => (
            <span
              key={l}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"
            >
              {l}
              <button
                type="button"
                aria-label={`Quitar ${l}`}
                onClick={() => patch({ labels: conv.labels.filter((x) => x !== l) })}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = label.trim();
            if (v && !conv.labels.includes(v)) patch({ labels: [...conv.labels, v] });
            setLabel("");
          }}
        >
          <input
            className="input"
            placeholder="Agregar etiqueta + Enter"
            aria-label="Agregar etiqueta"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </form>
      </section>

      <section className="space-y-2">
        <div className="text-xs font-semibold text-zinc-400 uppercase">Notas internas</div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!note.trim()) return;
            try {
              await api(`/api/conversations/${conv.id}/notes`, {
                method: "POST",
                body: { body: note },
              });
              setNote("");
              setNotes(await api<Note[]>(`/api/conversations/${conv.id}/notes`));
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
          className="space-y-2"
        >
          <textarea
            className="input"
            rows={2}
            placeholder="Solo la ve tu equipo"
            aria-label="Nueva nota"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="submit" className="btn-ghost w-full" disabled={!note.trim()}>
            Guardar nota
          </button>
        </form>
        {notes.map((n) => (
          <div key={n.id} className="rounded-lg bg-amber-50 p-2 dark:bg-amber-950">
            <div className="whitespace-pre-wrap">{n.body}</div>
            <div className="mt-1 text-[11px] text-zinc-500">
              {team.find((t) => t.id === n.userId)?.name ?? "—"} ·{" "}
              {new Date(n.createdAt).toLocaleString()}
            </div>
          </div>
        ))}
      </section>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

const STAGE_LABEL: Record<string, string> = {
  descubrimiento: "Conociendo al cliente",
  datos: "Tomando datos",
  confirmado: "Pedido confirmado",
  cancelado: "Cancelado",
};

/** Datos del pedido que la IA fue registrando en la conversación. */
/** Datos del cliente: solo lo que se conoce (de su perfil o de lo que dio en el chat). */
function ClientInfo({ conv }: { conv: ConversationDetail }) {
  const st = conv.checkoutState ?? {};
  const rows = [
    ["Teléfono", formatPhone(conv.contact.phone)],
    ["Nombre", conv.contact.name || st.nombre],
    ["Perfil WhatsApp", conv.contact.profileName],
    ["Ciudad", conv.contact.city || st.ciudad],
    ["Provincia", st.provincia],
  ].filter((r): r is [string, string] => Boolean(r[1]?.trim()));
  return (
    <dl className="space-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="w-28 shrink-0 text-zinc-500">{k}</dt>
          <dd className={k === "Teléfono" ? "font-mono" : "break-words"}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

type History = { orders: number; delivered: number; returned: number; cancelled: number };
type FingerprintData = {
  local: History;
  dropi: (History & { deliveryRate: number | null }) | null;
  /** Huella digital global de Dropi (conexión por cuenta / MCP). */
  global?: {
    found: boolean;
    buyerType: string;
    riskLabel: string;
    deliveryProbability: number | null;
    returnProbability: number | null;
  };
  dropiConnected: boolean;
  dropiError?: string;
};

/** Huella del comprador: cuántos pedidos recibió o devolvió (tienda y Dropi). */
function Fingerprint({ conversationId }: { conversationId: string }) {
  const [data, setData] = useState<FingerprintData | null>(null);
  useEffect(() => {
    setData(null);
    api<FingerprintData>(`/api/conversations/${conversationId}/fingerprint`)
      .then(setData)
      .catch(() => setData(null));
  }, [conversationId]);
  if (!data) return null;
  const d = data.dropi;
  const g = data.global;
  const finished = d ? d.delivered + d.returned : 0;
  // Sin pedidos finalizados (ambas en 0) no hay datos: no se pinta como riesgo.
  const gHasData = g?.found && ((g.deliveryProbability ?? 0) > 0 || (g.returnProbability ?? 0) > 0);
  const rate = g ? (gHasData ? g.deliveryProbability : null) : (d?.deliveryRate ?? null);
  const tone =
    rate == null
      ? "border-zinc-200 dark:border-zinc-800"
      : rate >= 70
        ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950"
        : rate >= 40
          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
          : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950";
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${tone}`}>
      <div className="mb-1 font-medium text-sm">Huella del comprador</div>
      {g ? (
        g.found ? (
          <div className="space-y-0.5">
            {(g.buyerType || g.riskLabel) && (
              <p className="font-medium">
                {[g.buyerType, g.riskLabel].filter(Boolean).join(" · ")}
              </p>
            )}
            {gHasData ? (
              <p>
                En todo Dropi recibe el {g.deliveryProbability ?? 0}% de sus pedidos y devuelve el{" "}
                {g.returnProbability ?? 0}%
                {(g.deliveryProbability ?? 0) + (g.returnProbability ?? 0) < 100
                  ? " (el resto va en camino)"
                  : ""}
                .
              </p>
            ) : (
              <p className="text-zinc-500">Aún no hay pedidos finalizados para medirlo.</p>
            )}
          </div>
        ) : (
          <p className="text-zinc-500">Dropi no tiene huella digital para este teléfono.</p>
        )
      ) : d ? (
        d.orders ? (
          <p>
            {d.orders} pedido{d.orders === 1 ? "" : "s"} en tu Dropi: {d.delivered} entregado
            {d.delivered === 1 ? "" : "s"}, {d.returned} devuelto{d.returned === 1 ? "" : "s"}
            {d.cancelled ? `, ${d.cancelled} cancelado${d.cancelled === 1 ? "" : "s"}` : ""}.
            {d.deliveryRate != null
              ? ` Recibe el ${d.deliveryRate}% (${d.delivered} de ${finished}).`
              : " Aún sin pedidos finalizados."}
          </p>
        ) : (
          <p className="text-zinc-500">Sin pedidos anteriores en tu Dropi con este teléfono.</p>
        )
      ) : data.dropiError ? (
        <p className="text-red-600 dark:text-red-400">{data.dropiError}</p>
      ) : !data.dropiConnected ? (
        <p className="text-zinc-500">
          Conecta Dropi en Integraciones para ver su historial de entregas.
        </p>
      ) : null}
      {data.local.orders > 0 && (
        <p className="mt-1 text-zinc-500">
          En Selichat: {data.local.orders} pedido{data.local.orders === 1 ? "" : "s"}
          {data.local.delivered ? `, ${data.local.delivered} entregado(s)` : ""}
          {data.local.returned ? `, ${data.local.returned} devuelto(s)` : ""}.
        </p>
      )}
    </div>
  );
}

type LinkedOrder = {
  id: string;
  stage: OrderStage;
  dropiOrderId: string | null;
  uploadError: string | null;
};

function OrderData({
  state,
  conversationId,
}: {
  state: Record<string, string>;
  conversationId: string;
}) {
  const fields = (Object.keys(CHECKOUT_FIELDS) as CheckoutField[]).filter((k) => state[k]?.trim());
  const [order, setOrder] = useState<LinkedOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmed = state.etapa;
  useEffect(() => {
    // Se vuelve a consultar cuando cambia la etapa (la IA pudo haber confirmado).
    void confirmed;
    api<{ order: LinkedOrder | null }>(`/api/conversations/${conversationId}/order`)
      .then((r) => setOrder(r.order))
      .catch(() => setOrder(null));
  }, [conversationId, confirmed]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const o = await api<LinkedOrder>(`/api/conversations/${conversationId}/order`, {
        method: "POST",
      });
      setOrder(o);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="font-medium">Pedido</span>
        <span
          className={`text-xs ${state.etapa === "confirmado" ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}`}
        >
          {STAGE_LABEL[state.etapa ?? "descubrimiento"] ?? state.etapa}
        </span>
      </div>
      {fields.length ? (
        <dl className="mt-2 space-y-1 text-xs">
          {fields.map((k) => (
            <div key={k} className="flex gap-2">
              <dt className="w-24 shrink-0 text-zinc-500">{CHECKOUT_FIELDS[k]}</dt>
              <dd className="break-words">{k === "agencia" ? agencyLabel(state[k]) : state[k]}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">La IA aún no registró datos.</p>
      )}
      <div className="mt-2 border-t border-zinc-200 pt-2 text-xs dark:border-zinc-800">
        {order && order.stage !== "cancelado" ? (
          <Link
            href="/panel/pedidos"
            className="text-emerald-700 hover:underline dark:text-emerald-400"
          >
            {ORDER_STAGES[order.stage] ?? order.stage}
            {order.dropiOrderId ? ` · Dropi #${order.dropiOrderId}` : ""} →
          </Link>
        ) : (
          <button
            type="button"
            className="text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
            disabled={busy || !fields.length}
            onClick={create}
          >
            {busy ? "Creando…" : "Crear pedido con estos datos"}
          </button>
        )}
        {order?.uploadError && order.stage !== "cancelado" && (
          <p className="mt-1 text-red-600 dark:text-red-400">{order.uploadError}</p>
        )}
        {error && <p className="mt-1 text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
