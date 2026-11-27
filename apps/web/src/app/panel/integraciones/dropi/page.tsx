"use client";
import {
  DROPI_COUNTRIES,
  type DropiCountry,
  type DropiOptions,
  dropiOptionsSchema,
  NOTICE_INFO,
  NOTICE_KINDS,
  NOTICE_TEMPLATE_PARAMS,
  NOTICE_VARIABLES,
  type NoticeKind,
  renderNotice,
} from "@chatea/shared";
import { Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Info = {
  connected: boolean;
  /** token = token de integración; mcp = cuenta Dropi autorizada. */
  mode?: "token" | "mcp";
  /** Dropi revocó o venció la autorización: hay que volver a autorizar. */
  authError?: string | null;
  country?: DropiCountry;
  options: DropiOptions;
  tokenHint?: string;
  webhookUrl?: string | null;
};

const DEFAULTS: DropiOptions = dropiOptionsSchema.parse({});

export default function DropiPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [token, setToken] = useState("");
  const [country, setCountry] = useState<DropiCountry>("EC");
  const [options, setOptions] = useState<DropiOptions>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [copied, setCopied] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  // Vuelta desde Dropi tras autorizar: muestra el resultado y limpia la URL.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("dropi") === "conectado") setSaved("¡Tu cuenta de Dropi quedó conectada!");
    const err = q.get("dropi_error");
    if (err) setError(err);
    if (q.has("dropi") || err) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const load = useCallback(async () => {
    try {
      const i = await api<Info>("/api/integrations/dropi");
      setInfo(i);
      if (i.country) setCountry(i.country);
      setOptions({
        ...DEFAULTS,
        ...i.options,
        risk: { ...DEFAULTS.risk, ...i.options?.risk },
        // El API ya devuelve los avisos en el formato nuevo (migra la configuración anterior).
        notices: dropiOptionsSchema.shape.notices.parse(i.options?.notices ?? {}),
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await api("/api/integrations/dropi", {
        method: "PUT",
        body: { token: token.trim() || undefined, country, options },
      });
      setToken("");
      setSaved(info?.connected ? "Cambios guardados." : "¡Dropi conectado!");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function connectAccount() {
    setError("");
    setSaved("");
    setRedirecting(true);
    try {
      const { url } = await api<{ url: string }>("/api/integrations/dropi/oauth/start", {
        method: "POST",
        body: { country, options },
      });
      window.location.href = url;
    } catch (err) {
      setError(errorMessage(err));
      setRedirecting(false);
    }
  }

  async function disconnect() {
    if (!confirm("¿Desconectar Dropi? Los pedidos nuevos ya no se subirán.")) return;
    try {
      await api("/api/integrations/dropi", { method: "DELETE" });
      setSaved("");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const set = <K extends keyof DropiOptions>(k: K, v: DropiOptions[K]) =>
    setOptions((o) => ({ ...o, [k]: v }));
  const setRisk = (patch: Partial<DropiOptions["risk"]>) =>
    setOptions((o) => ({ ...o, risk: { ...o.risk, ...patch } }));
  const setNotices = (patch: Partial<DropiOptions["notices"]>) =>
    setOptions((o) => ({ ...o, notices: { ...o.notices, ...patch } }));

  if (!info) return <ErrorText>{error}</ErrorText>;
  const mcp = info.connected && info.mode === "mcp";

  return (
    <>
      <div className="mb-2 text-sm">
        <Link href="/panel/integraciones" className="text-zinc-500 hover:underline">
          ← Integraciones
        </Link>
      </div>
      <PageHeader
        icon={Truck}
        title="Dropi"
        description="Cuando el cliente confirma con la IA, el pedido se sube a Dropi y su estado vuelve aquí."
      />
      <form onSubmit={save} className="space-y-6">
        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Conexión</h2>
            {info.connected ? (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-800 dark:bg-brand-900 dark:text-brand-200">
                {mcp
                  ? info.authError
                    ? "Requiere volver a autorizar"
                    : "Conectado con tu cuenta Dropi"
                  : `Conectado · token ${info.tokenHint}`}
              </span>
            ) : (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                Sin conectar
              </span>
            )}
          </div>
          <label className="block text-sm">
            <span className="label">País de tu cuenta Dropi</span>
            <select
              className="input"
              value={country}
              onChange={(e) => setCountry(e.target.value as DropiCountry)}
            >
              {Object.entries(DROPI_COUNTRIES).map(([k, c]) => (
                <option key={k} value={k}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {mcp && info.authError && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              <b>Dropi revocó el acceso de Selichat.</b> Los pedidos no se pueden subir hasta que
              pulses «Volver a autorizar» e inicies sesión en Dropi otra vez. Después, en Pedidos,
              usa «Reintentar» en los que quedaron con error.
            </div>
          )}
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-sm">
              <b>Con tu cuenta de Dropi</b> (recomendado): inicias sesión en Dropi y autorizas a
              Selichat. No hay que copiar tokens, y además se usa la huella digital de Dropi
              (historial del comprador en todas las tiendas).
            </p>
            <button
              type="button"
              className={`${info.connected && !info.authError ? "btn-ghost" : "btn"} mt-2`}
              disabled={redirecting}
              onClick={connectAccount}
            >
              {redirecting
                ? "Abriendo Dropi…"
                : mcp
                  ? "Volver a autorizar"
                  : info.connected
                    ? "Cambiar a mi cuenta Dropi"
                    : "Conectar con mi cuenta Dropi"}
            </button>
          </div>

          {!mcp && !info.connected && !showToken ? (
            <button
              type="button"
              className="text-xs text-zinc-500 underline"
              onClick={() => setShowToken(true)}
            >
              Prefiero usar un token de integración
            </button>
          ) : (
            (!mcp || showToken) && (
              <div className="space-y-2">
                <label className="block text-sm">
                  <span className="label">
                    Token de integración{" "}
                    {info.connected && !mcp && "(déjalo vacío para mantener el actual)"}
                  </span>
                  <input
                    className="input font-mono text-xs"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      info.connected && !mcp ? "••••••••" : "Pega aquí el token de Dropi"
                    }
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </label>
                <p className="text-xs text-zinc-500">
                  Es el token de una integración de tipo API en Dropi (Mis integraciones). Las de
                  WooCommerce o Shopify piden la URL de una tienda y su token no siempre sirve aquí:
                  si no funciona, usa «Conectar con mi cuenta Dropi». Se guarda cifrado y la IA
                  nunca lo ve.
                </p>
              </div>
            )
          )}
          {mcp && !showToken && (
            <button
              type="button"
              className="text-xs text-zinc-500 underline"
              onClick={() => setShowToken(true)}
            >
              Usar un token de integración en su lugar
            </button>
          )}
        </section>

        <section className="card space-y-3">
          <h2 className="font-medium">Cómo se suben los pedidos</h2>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={options.autoUpload}
              onChange={(e) => set("autoUpload", e.target.checked)}
            />
            <span>
              Subir a Dropi apenas el cliente confirme con la IA
              <span className="block text-xs text-zinc-500">
                Si lo apagas, los pedidos quedan en Pedidos → «Por subir» para que un asesor los
                revise y suba.
              </span>
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="label">Tipo de cobro</span>
              <select
                className="input"
                value={options.rateType}
                onChange={(e) => set("rateType", e.target.value as DropiOptions["rateType"])}
              >
                <option value="CON RECAUDO">Contra entrega (con recaudo)</option>
                <option value="SIN RECAUDO">Pago anticipado (sin recaudo)</option>
              </select>
            </label>
            {!mcp && (
              <label className="block text-sm">
                <span className="label">Estado inicial en Dropi</span>
                <select
                  className="input"
                  value={options.initialStatus}
                  onChange={(e) =>
                    set("initialStatus", e.target.value as DropiOptions["initialStatus"])
                  }
                >
                  <option value="PENDIENTE CONFIRMACION">Pendiente confirmación</option>
                  <option value="PENDIENTE">Pendiente (ya confirmado)</option>
                </select>
              </label>
            )}
          </div>
        </section>

        <section className="card space-y-3">
          <h2 className="font-medium">Huella del comprador</h2>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={options.risk.enabled}
              onChange={(e) => setRisk({ enabled: e.target.checked })}
            />
            <span>
              Revisar el historial del comprador antes de subir
              <span className="block text-xs text-zinc-500">
                {mcp
                  ? "Se consulta la huella digital de Dropi por teléfono (sus pedidos en todas las tiendas). Si recibe muy pocos, el pedido queda en «Revisar (riesgo)» y un dueño o administrador decide. Sin pedidos finalizados nunca se bloquea."
                  : "Se buscan sus pedidos anteriores en tu tienda de Dropi por teléfono. Si recibe muy pocos, el pedido queda en «Revisar (riesgo)» y un dueño o administrador decide."}
              </span>
            </span>
          </label>
          {options.risk.enabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="label">% mínimo de pedidos entregados</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  value={options.risk.minDeliveryRate}
                  onChange={(e) =>
                    setRisk({
                      minDeliveryRate: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                    })
                  }
                />
              </label>
              {!mcp && (
                <label className="block text-sm">
                  <span className="label">Aplicar desde (pedidos finalizados)</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={50}
                    value={options.risk.minOrders}
                    onChange={(e) =>
                      setRisk({ minOrders: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })
                    }
                  />
                </label>
              )}
            </div>
          )}
        </section>

        <section className="card space-y-3">
          <h2 className="font-medium">Antes de subir a Dropi</h2>
          <label className="block text-sm">
            <span className="label">
              No subir si ya hay un pedido activo con el mismo teléfono en los últimos
            </span>
            <select
              className="input"
              value={options.duplicateDays}
              onChange={(e) => set("duplicateDays", Number(e.target.value))}
            >
              <option value={0}>No revisar duplicados</option>
              {[1, 2, 3, 5, 7, 15].map((d) => (
                <option key={d} value={d}>
                  {d} día{d === 1 ? "" : "s"}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-zinc-500">
              El pedido queda en «Revisar» con el número del que ya existe; un dueño o administrador
              decide si se sube igual.
            </span>
          </label>
          {mcp && (
            <>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={options.quoteBeforeUpload}
                  onChange={(e) => set("quoteBeforeUpload", e.target.checked)}
                />
                <span>
                  Cotizar el envío antes de subir
                  <span className="block text-xs text-zinc-500">
                    Confirma cobertura y guarda el costo de envío. Si retira en agencia, exige que
                    Servientrega cotice.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={options.checkStock}
                  onChange={(e) => set("checkStock", e.target.checked)}
                />
                <span>
                  Revisar stock y costo de proveedor
                  <span className="block text-xs text-zinc-500">
                    No sube si no hay stock suficiente o si el precio por unidad queda por debajo
                    del costo del proveedor (Dropi lo rechazaría).
                  </span>
                </span>
              </label>
            </>
          )}
        </section>

        <NoticesCard notices={options.notices} onChange={setNotices} />

        {mcp && (
          <section className="card space-y-1">
            <h2 className="font-medium">Estados de vuelta</h2>
            <p className="text-sm text-zinc-500">
              Con la cuenta conectada no hace falta configurar webhooks: Selichat consulta en Dropi
              cada 10 minutos el estado de los pedidos en curso (guía, en reparto, entregado,
              novedad…).
            </p>
          </section>
        )}

        {!mcp && info.webhookUrl && (
          <section className="card space-y-2">
            <h2 className="font-medium">Estados de vuelta (webhook)</h2>
            <p className="text-sm text-zinc-500">
              Pega esta URL en Dropi, en la configuración de webhooks de tu integración, para que
              los cambios de estado (guía, en reparto, entregado, novedad…) lleguen solos.
            </p>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                readOnly
                value={info.webhookUrl}
                aria-label="URL del webhook"
              />
              <button
                type="button"
                className="btn-ghost shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(info.webhookUrl ?? "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copiado ✓" : "Copiar"}
              </button>
            </div>
            <p className="text-xs text-zinc-500">No la compartas: identifica a tu tienda.</p>
          </section>
        )}

        <ErrorText>{error}</ErrorText>
        {saved && <p className="text-sm text-brand-700 dark:text-brand-400">{saved}</p>}
        <div className="flex items-center gap-3">
          {(info.connected || token.trim()) && (
            <button
              type="submit"
              className="btn"
              disabled={busy || (!info.connected && !token.trim())}
            >
              {busy
                ? "Verificando con Dropi…"
                : info.connected
                  ? token.trim()
                    ? "Guardar y usar este token"
                    : "Guardar cambios"
                  : "Conectar con token"}
            </button>
          )}
          {info.connected && (
            <button type="button" className="btn-ghost text-red-600" onClick={disconnect}>
              Desconectar
            </button>
          )}
        </div>
      </form>
      <AgencyFinder />
    </>
  );
}

type AgencyMode = "off" | "opcion" | "solo";

const AGENCY_OPTIONS: { value: AgencyMode; label: string; hint: string }[] = [
  {
    value: "solo",
    label: "Todo a agencia Servientrega",
    hint: "No hay entrega a domicilio: la IA pide ciudad y sector, le muestra las agencias donde puede retirar y registra la elegida. El pedido sube a Dropi con Servientrega y la dirección de la agencia.",
  },
  {
    value: "opcion",
    label: "Domicilio o agencia",
    hint: "La IA ofrece retirar en una agencia Servientrega cercana como alternativa a la entrega a domicilio.",
  },
  { value: "off", label: "Solo entrega a domicilio", hint: "No se ofrecen agencias." },
];

/** Modo de entrega: la IA ofrece (o exige) retiro en agencia Servientrega. */
function AgencyFinder() {
  const [state, setState] = useState<{ available: boolean; mode: AgencyMode } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ available: boolean; mode: AgencyMode }>("/api/integrations/servientrega")
      .then(setState)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  async function choose(mode: AgencyMode) {
    setError("");
    try {
      await api("/api/integrations/servientrega", { method: "PUT", body: { mode } });
      setState((s) => (s ? { ...s, mode } : s));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  if (!state?.available) return null;
  return (
    <section className="card mt-6 space-y-3">
      <div>
        <h2 className="font-medium">Entrega y agencias Servientrega</h2>
        <p className="text-xs text-zinc-500">
          Se aplica a todos los productos: no hace falta cambiar cada prompt. Solo se ofrecen
          agencias que entregan paquetes en oficina.
        </p>
      </div>
      <div className="space-y-2">
        {AGENCY_OPTIONS.map((o) => (
          <label key={o.value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="agency-mode"
              className="mt-1"
              checked={state.mode === o.value}
              onChange={() => choose(o.value)}
            />
            <span>
              {o.label}
              <span className="block text-xs text-zinc-500">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

/** Ejemplo para la vista previa de los avisos. */
const SAMPLE: Record<string, string> = {
  nombre: "Ana",
  producto: "Mega Red",
  guia: "1800456789",
  seguimiento: "https://www.servientrega.com.ec/Tracking/?guia=1800456789&tipo=GUIA",
  transportadora: "Servientrega",
  agencia: "la agencia Servientrega *AMBATO CENTRO*",
  direccion_agencia: "Av. Cevallos y Montalvo",
  horario: "Lunes a viernes 08:00 a 18:00 · sábados 09:00 a 13:00",
  total: "$49.99",
  ciudad: "Ambato",
  estado: "no se encontró al destinatario",
  tienda: "NatureVita",
};

type Notices = DropiOptions["notices"];

/** Texto con el formato de WhatsApp: *negrita* y _cursiva_. */
function WhatsAppText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((part, i) =>
        /^\*.+\*$/.test(part) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: trozos fijos del mismo texto
          <strong key={i}>{part.slice(1, -1)}</strong>
        ) : /^_.+_$/.test(part) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: trozos fijos del mismo texto
          <em key={i}>{part.slice(1, -1)}</em>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Agente logístico: avisos por estado del pedido, cada uno con texto editable y plantilla. */
function NoticesCard({
  notices,
  onChange,
}: {
  notices: Notices;
  onChange: (patch: Partial<Notices>) => void;
}) {
  const [open, setOpen] = useState<NoticeKind | null>(null);
  const [templates, setTemplates] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const channels = await api<{ id: string }[]>("/api/channels");
        const lists = await Promise.all(
          channels.map((c) =>
            api<{ name: string; status: string }[]>(`/api/channels/${c.id}/templates`).catch(
              () => [],
            ),
          ),
        );
        const names = lists
          .flat()
          .filter((t) => t.status === "APPROVED")
          .map((t) => t.name);
        setTemplates([...new Set(names)].sort());
      } catch {
        setTemplates([]);
      }
    })();
  }, []);
  const setEvent = (k: NoticeKind, patch: Partial<Notices["events"][NoticeKind]>) =>
    onChange({ events: { ...notices.events, [k]: { ...notices.events[k], ...patch } } });
  const active = NOTICE_KINDS.filter((k) => notices.events[k].enabled).length;
  // Desde la campana («Configurar avisos al cliente»): la sección se pinta después de cargar.
  useEffect(() => {
    if (window.location.hash === "#avisos")
      document.getElementById("avisos")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <section id="avisos" className="card scroll-mt-20 space-y-3">
      <div>
        <h2 className="font-medium">Avisos al cliente por WhatsApp (agente logístico)</h2>
        <p className="text-sm text-zinc-500">
          Cuando cambia el estado del pedido en Dropi, Selichat le escribe al cliente. {active} de{" "}
          {NOTICE_KINDS.length} avisos activos.
        </p>
      </div>
      <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {NOTICE_KINDS.map((k) => (
          <NoticeRow
            key={k}
            kind={k}
            ev={notices.events[k]}
            open={open === k}
            onToggle={() => setOpen(open === k ? null : k)}
            onChange={(patch) => setEvent(k, patch)}
            templates={templates}
            extra={
              k === "recordatorio" ? (
                <p className="text-sm text-zinc-500">
                  Se envía una vez al día, por la mañana al abrir tu horario de envío, desde el día
                  siguiente a la llegada y hasta que el cliente lo retire. Pasadas 24 h desde su
                  último mensaje, solo sale con la plantilla aprobada.
                </p>
              ) : null
            }
          />
        ))}
      </ul>
      <label className="block text-sm">
        <span className="label">Enlace de seguimiento de la guía</span>
        <input
          className="input font-mono text-xs"
          value={notices.trackingUrl}
          onChange={(e) => onChange({ trackingUrl: e.target.value })}
          placeholder="https://…{guia}…"
        />
        <span className="mt-1 block text-xs text-zinc-500">
          Se usa en la variable {"{seguimiento}"}; {"{guia}"} se reemplaza por el número de guía.
          Vacío = no se comparte enlace.
        </span>
      </label>
      <p className="text-xs text-zinc-500">
        Se envían solo dentro del horario de la tienda (Configuración); fuera de horario quedan en
        espera y salen al abrir. Dentro de las 24 h del último mensaje del cliente se envía el
        texto; después, solo la plantilla aprobada (sin plantilla queda anotado en el historial del
        pedido). Cada aviso sale una sola vez por pedido.
      </p>
    </section>
  );
}

function NoticeRow({
  kind,
  ev,
  open,
  onToggle,
  onChange,
  templates,
  extra,
}: {
  kind: NoticeKind;
  ev: Notices["events"][NoticeKind];
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<Notices["events"][NoticeKind]>) => void;
  templates: string[];
  extra: React.ReactNode;
}) {
  const info = NOTICE_INFO[kind];
  const text = ev.text || info.defaultText;
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (key: string) => {
    const el = ref.current;
    const token = `{${key}}`;
    if (!el) return onChange({ text: text + token });
    const next = text.slice(0, el.selectionStart) + token + text.slice(el.selectionEnd);
    onChange({ text: next });
    requestAnimationFrame(() => {
      el.focus();
      const pos = el.selectionStart + token.length;
      el.setSelectionRange(pos, pos);
    });
  };
  return (
    <li className="p-3">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          aria-label={`Activar aviso ${info.label}`}
          checked={ev.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-medium">{info.label}</span>
          <span className="block text-xs text-zinc-500">{info.when}</span>
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={onToggle}>
          {open ? "Cerrar" : "Editar"}
        </button>
      </div>
      {open && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            {extra}
            <label className="block text-sm">
              <span className="label">Mensaje (dentro de las 24 h)</span>
              <textarea
                ref={ref}
                className="input min-h-36 text-sm"
                value={text}
                onChange={(e) => onChange({ text: e.target.value })}
              />
            </label>
            <div className="flex flex-wrap gap-1">
              {NOTICE_VARIABLES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  title={v.label}
                  className="rounded-full border border-zinc-200 px-2 py-0.5 font-mono text-[11px] hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  onClick={() => insert(v.key)}
                >
                  {`{${v.key}}`}
                </button>
              ))}
            </div>
            {ev.text && (
              <button
                type="button"
                className="text-xs text-zinc-500 underline"
                onClick={() => onChange({ text: "" })}
              >
                Volver al texto sugerido
              </button>
            )}
            <label className="block text-sm">
              <span className="label">Plantilla aprobada (más de 24 h)</span>
              <input
                className="input font-mono text-xs"
                list={`tpl-${kind}`}
                placeholder="nombre_de_la_plantilla"
                value={ev.template}
                onChange={(e) => onChange({ template: e.target.value })}
              />
              <datalist id={`tpl-${kind}`}>
                {templates.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <span className="mt-1 block text-xs text-zinc-500">
                Variables en orden:{" "}
                {NOTICE_TEMPLATE_PARAMS.map((p, i) => `{{${i + 1}}} ${p}`).join(", ")}. Se envían
                tantas como pida la plantilla.
              </span>
            </label>
          </div>
          <div>
            <span className="label">Vista previa</span>
            <div className="chat-bg rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="ml-auto max-w-[90%] rounded-2xl rounded-tr-md border border-brand-100 bg-brand-50 px-3 py-2 text-sm whitespace-pre-wrap shadow-sm dark:border-brand-900 dark:bg-brand-950">
                <WhatsAppText text={renderNotice(text, SAMPLE)} />
              </div>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
