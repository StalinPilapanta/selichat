"use client";
import { CHECKOUT_FIELDS, type CheckoutField, formatPhone } from "@chatea/shared";
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
  const [name, setName] = useState(conv.contact.name ?? "");
  const [city, setCity] = useState(conv.contact.city ?? "");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setName(conv.contact.name ?? "");
    setCity(conv.contact.city ?? "");
    api<Note[]>(`/api/conversations/${conv.id}/notes`)
      .then(setNotes)
      .catch(() => setNotes([]));
  }, [conv.id, conv.contact.name, conv.contact.city]);

  async function patch(body: object) {
    setError("");
    try {
      await api(`/api/conversations/${conv.id}`, { method: "PATCH", body });
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function saveContact() {
    try {
      await api(`/api/contacts/${conv.contact.id}`, {
        method: "PATCH",
        body: { name: name || null, city: city || null },
      });
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="space-y-5 p-4 text-sm">
      <section className="space-y-2">
        <div className="text-xs font-semibold text-zinc-400 uppercase">Cliente</div>
        <div className="font-mono text-zinc-500">{formatPhone(conv.contact.phone)}</div>
        {conv.contact.profileName && (
          <div className="text-zinc-500">Perfil: {conv.contact.profileName}</div>
        )}
        <input
          className="input"
          placeholder="Nombre"
          aria-label="Nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveContact}
        />
        <input
          className="input"
          placeholder="Ciudad"
          aria-label="Ciudad"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          onBlur={saveContact}
        />
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
        <OrderData state={conv.checkoutState ?? {}} />
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
function OrderData({ state }: { state: Record<string, string> }) {
  const fields = (Object.keys(CHECKOUT_FIELDS) as CheckoutField[]).filter((k) => state[k]?.trim());
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
              <dd className="break-words">{state[k]}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">La IA aún no registró datos.</p>
      )}
    </div>
  );
}
