"use client";
import {
  agencyLabel,
  CHECKOUT_FIELDS,
  type CheckoutField,
  displayPhone,
  formatPhone,
  LOCAL_STAGES,
  ORDER_STAGES,
  type OrderStage,
} from "@chatea/shared";
import { Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type FingerprintData, FingerprintView } from "@/components/Fingerprint";
import {
  type OrderFormInitial,
  OrderFormPanel,
  orderFormInitial,
} from "@/components/orders/OrderForm";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import type { ConversationDetail, TeamMember } from "./types";

export function Details({
  conv,
  team,
  onChange,
  onDeleted,
}: {
  conv: ConversationDetail;
  team: TeamMember[];
  onChange: () => void;
  /** El contacto se eliminó: la bandeja cierra la conversación y recarga la lista. */
  onDeleted?: () => void;
}) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

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
                className="text-brand-700 hover:underline dark:text-brand-400"
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
        <AgentStatus run={conv.lastAgentRun} />
        <OrderData
          state={conv.checkoutState ?? {}}
          conversationId={conv.id}
          contactPhone={conv.contact.phone}
          productName={conv.productName}
          productId={conv.productId}
        />
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

      <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        Las notas internas se escriben desde el chat (pestaña «Nota interna» o Alt+N) y aparecen en
        el hilo; el cliente no las ve.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {onDeleted && <DeleteContact conv={conv} team={team} onDeleted={onDeleted} />}
    </div>
  );
}

const SKIP_REASONS: Record<string, string> = {
  ia_no_configurada:
    "La IA no está configurada: agrega un proveedor y su clave en IA → Proveedores.",
  ventana_cerrada: "Pasaron más de 24 h desde el último mensaje del cliente.",
  limite_turnos: "La IA llegó al límite de 20 respuestas por hora en esta conversación.",
  producto_no_existe: "El producto de la conversación ya no existe o está inactivo.",
  cerrada: "La conversación está cerrada.",
};

/** Si el último turno de la IA falló o no respondió, se dice por qué. */
function AgentStatus({ run }: { run?: ConversationDetail["lastAgentRun"] }) {
  if (!run || run.status === "ok") return null;
  const when = new Date(run.at).toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
  const why =
    run.status === "error"
      ? `Error del proveedor de IA: ${run.error ?? "sin detalle"}`
      : (SKIP_REASONS[run.reason] ?? run.reason);
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <div className="font-medium">La IA no respondió ({when})</div>
      <div className="mt-0.5 break-words">{why}</div>
    </div>
  );
}

/** Eliminar el contacto (solo dueño o administrador): se borran su chat y sus notas. */
function DeleteContact({
  conv,
  team,
  onDeleted,
}: {
  conv: ConversationDetail;
  team: TeamMember[];
  onDeleted: () => void;
}) {
  const { data: session } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const role = team.find((t) => t.id === session?.user.id)?.role;
  if (role !== "owner" && role !== "admin") return null;
  async function remove() {
    const who = conv.contact.name || conv.contact.profileName || formatPhone(conv.contact.phone);
    if (
      !confirm(
        `¿Eliminar a ${who}? Se borran la conversación, los mensajes y las notas. Sus pedidos se conservan. No se puede deshacer.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/contacts/${conv.contact.id}`, { method: "DELETE" });
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <section className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <button
        type="button"
        className="btn-ghost w-full text-sm text-red-600"
        disabled={busy}
        onClick={remove}
      >
        {busy ? "Eliminando…" : "Eliminar contacto"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </section>
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

/** Huella del comprador de la conversación. */
function Fingerprint({ conversationId }: { conversationId: string }) {
  const [data, setData] = useState<FingerprintData | null>(null);
  useEffect(() => {
    setData(null);
    api<FingerprintData>(`/api/conversations/${conversationId}/fingerprint`)
      .then(setData)
      .catch(() => setData(null));
  }, [conversationId]);
  return data ? <FingerprintView data={data} /> : null;
}

type LinkedOrder = {
  id: string;
  stage: OrderStage;
  dropiOrderId: string | null;
  uploadError: string | null;
  items: { name: string; quantity: number; variant?: string }[];
  total: string;
  currency: string;
};

type OrderDetail = Omit<LinkedOrder, "items"> & {
  customer: Record<string, string | undefined>;
  items: { productId?: string; name: string; quantity: number; variant?: string }[];
  rateType: string | null;
  notes: string | null;
};

/** Número nacional para el formulario (593981112222 → 0981112222). */
const nationalOf = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("593") ? `0${d.slice(3)}` : d;
};

/** Lo que juntó la conversación, como datos iniciales del formulario de pedido. */
function fromCheckout(
  st: Record<string, string>,
  contactPhone: string,
  productId: string | null,
): OrderFormInitial {
  const [nombre = "", ...rest] = (st.nombre ?? "").trim().split(/\s+/);
  const qty = Number.parseInt(st.cantidad ?? "", 10);
  return {
    customer: {
      nombre,
      apellido: rest.join(" "),
      telefono: nationalOf(st.telefono || contactPhone),
      provincia: st.provincia ?? "",
      ciudad: st.ciudad ?? "",
      direccion: st.agencia ? st.agencia : (st.direccion ?? ""),
      referencia: st.agencia ? "" : (st.referencia ?? ""),
      ...(st.agencia ? { agencia: st.agencia } : {}),
    },
    lines: productId
      ? [{ productId, quantity: qty > 0 && qty < 100 ? qty : 1, variant: st.variante ?? "" }]
      : undefined,
    notes: st.notas ?? "",
  };
}

function OrderData({
  state,
  conversationId,
  contactPhone,
  productName,
  productId,
}: {
  state: Record<string, string>;
  conversationId: string;
  contactPhone: string;
  productName: string | null;
  productId: string | null;
}) {
  const fields = (Object.keys(CHECKOUT_FIELDS) as CheckoutField[]).filter((k) => state[k]?.trim());
  const [order, setOrder] = useState<LinkedOrder | null>(null);
  const [form, setForm] = useState<{ initial: OrderFormInitial; orderId?: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const confirmed = state.etapa;
  const load = useCallback(
    () =>
      api<{ order: LinkedOrder | null }>(`/api/conversations/${conversationId}/order`)
        .then((r) => setOrder(r.order))
        .catch(() => setOrder(null)),
    [conversationId],
  );
  useEffect(() => {
    // Se vuelve a consultar cuando cambia la etapa (la IA pudo haber confirmado).
    void confirmed;
    setNotice("");
    load();
  }, [load, confirmed]);

  const open = order && order.stage !== "cancelado" ? order : null;
  const local = open && !open.dropiOrderId && LOCAL_STAGES.includes(open.stage);

  /** Abre el formulario: con lo del chat (nuevo) o con el pedido guardado (corregir y subir). */
  async function openForm() {
    setError("");
    if (!local || !open) {
      setForm({ initial: fromCheckout(state, contactPhone, productId) });
      return;
    }
    setOpening(true);
    try {
      const d = await api<OrderDetail>(`/api/orders/${open.id}`);
      setForm({ initial: orderFormInitial(d), orderId: open.id });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOpening(false);
    }
  }
  return (
    <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="font-medium">Pedido</span>
        <span
          className={`text-xs ${state.etapa === "confirmado" ? "text-brand-700 dark:text-brand-400" : "text-zinc-500"}`}
        >
          {STAGE_LABEL[state.etapa ?? "descubrimiento"] ?? state.etapa}
        </span>
      </div>
      {(order?.items.length || productName) && (
        <div className="mt-2 rounded-md bg-zinc-50 px-2 py-1.5 text-xs dark:bg-zinc-800/60">
          <span className="text-zinc-500">Producto: </span>
          {order?.items.length && order.stage !== "cancelado" ? (
            <>
              {order.items
                .map((i) => `${i.quantity}× ${i.name}${i.variant ? ` (${i.variant})` : ""}`)
                .join(", ")}
              <span className="font-medium">
                {" "}
                · {order.currency === "USD" ? "$" : `${order.currency} `}
                {Number(order.total).toFixed(2)}
              </span>
            </>
          ) : (
            <>
              {productName}
              {state.cantidad ? ` · ${state.cantidad}` : ""}
            </>
          )}
        </div>
      )}
      {fields.length ? (
        <dl className="mt-2 space-y-1 text-xs">
          {fields.map((k) => (
            <div key={k} className="flex gap-2">
              <dt className="w-24 shrink-0 text-zinc-500">{CHECKOUT_FIELDS[k]}</dt>
              <dd className="break-words">
                {k === "agencia"
                  ? agencyLabel(state[k])
                  : k === "telefono"
                    ? displayPhone(state[k], contactPhone)
                    : state[k]}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">La IA aún no registró datos.</p>
      )}
      <div className="mt-2 space-y-2 border-t border-zinc-200 pt-2 text-xs dark:border-zinc-800">
        {open && (
          <div className="flex items-center justify-between gap-2">
            <span className="badge badge-neutral">
              {ORDER_STAGES[open.stage] ?? open.stage}
              {open.dropiOrderId ? ` · Dropi #${open.dropiOrderId}` : ""}
            </span>
            <Link
              href={`/panel/pedidos?pedido=${open.id}`}
              className="text-brand-700 hover:underline dark:text-brand-400"
            >
              Ver en Pedidos →
            </Link>
          </div>
        )}
        {open?.uploadError && <p className="text-red-600 dark:text-red-400">{open.uploadError}</p>}
        {(!open || local) && (
          <button
            type="button"
            className="btn h-8 w-full text-xs"
            disabled={opening}
            onClick={openForm}
          >
            <Upload className="size-3.5" />
            {opening ? "Abriendo…" : open ? "Revisar y subir a Dropi" : "Crear pedido"}
          </button>
        )}
        {notice && <p className="text-brand-700 dark:text-brand-400">{notice}</p>}
        {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
      </div>
      {form && (
        <OrderFormPanel
          initial={form.initial}
          orderId={form.orderId}
          conversationId={conversationId}
          uploadByDefault
          title={form.orderId ? "Revisar y subir a Dropi" : "Crear pedido"}
          subtitle={
            form.orderId
              ? "Revisa los datos antes de subirlos; puedes corregir lo que haga falta."
              : "Con los datos que juntó la conversación. Revisa y corrige antes de guardar."
          }
          onClose={() => setForm(null)}
          onCreated={(_id, result) => {
            setForm(null);
            setNotice(
              !result
                ? "Pedido guardado. Queda por subir a Dropi."
                : result.status === "subido"
                  ? "Pedido subido a Dropi."
                  : result.status === "revision"
                    ? "No se subió: quedó en «Revisar» para un dueño o administrador."
                    : "Pedido guardado, pero no se pudo subir a Dropi: revisa el motivo.",
            );
            load();
          }}
        />
      )}
    </div>
  );
}
