"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Channel = {
  id: string;
  name: string;
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string;
  verifiedName: string;
  status: string;
  lastError: string | null;
  webhookVerifiedAt: string | null;
  lastEventAt: string | null;
  webhookUrl: string;
  verifyToken: string;
};
type Template = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejectedReason: string | null;
  components: { type: string; text?: string }[];
};

const STATUS_STYLE: Record<string, string> = {
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function Copy({ value, label }: { value: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex gap-2">
        <input className="input font-mono text-xs" readOnly value={value} aria-label={label} />
        <button
          type="button"
          className="btn-ghost shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(value);
            setOk(true);
            setTimeout(() => setOk(false), 1500);
          }}
        >
          {ok ? "Copiado ✓" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

function ConnectForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({
    name: "WhatsApp principal",
    phoneNumberId: "",
    wabaId: "",
    accessToken: "",
    appSecret: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value.trim() });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/channels", { method: "POST", body: f });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      <div className="font-medium">Conectar un número</div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-500">
        <li>
          En{" "}
          <a
            className="underline"
            href="https://developers.facebook.com/apps"
            target="_blank"
            rel="noreferrer"
          >
            Meta for Developers
          </a>{" "}
          crea una app tipo «Empresa» y agrega el producto <b>WhatsApp</b>.
        </li>
        <li>
          En WhatsApp → Configuración de la API copia el <b>Phone Number ID</b> y el <b>WABA ID</b>.
        </li>
        <li>
          En el Business Manager crea un <b>usuario del sistema</b> con permisos{" "}
          <code>whatsapp_business_messaging</code> y <code>whatsapp_business_management</code> y
          genera un token permanente.
        </li>
        <li>
          En Configuración de la app → Básica copia el <b>App Secret</b>.
        </li>
        <li>
          Guarda aquí y luego pega la URL del webhook y el token de verificación en Meta (suscribe
          «messages»).
        </li>
      </ol>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Nombre interno</span>
          <input className="input" required value={f.name} onChange={set("name")} />
        </label>
        <label className="block">
          <span className="label">Phone Number ID</span>
          <input
            className="input font-mono"
            required
            inputMode="numeric"
            value={f.phoneNumberId}
            onChange={set("phoneNumberId")}
          />
        </label>
        <label className="block">
          <span className="label">WABA ID (cuenta de WhatsApp Business)</span>
          <input
            className="input font-mono"
            required
            inputMode="numeric"
            value={f.wabaId}
            onChange={set("wabaId")}
          />
        </label>
        <label className="block">
          <span className="label">App Secret</span>
          <input
            className="input font-mono"
            required
            type="password"
            autoComplete="off"
            value={f.appSecret}
            onChange={set("appSecret")}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Token de acceso permanente</span>
          <input
            className="input font-mono"
            required
            type="password"
            autoComplete="off"
            value={f.accessToken}
            onChange={set("accessToken")}
          />
        </label>
      </div>
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn" disabled={busy}>
        {busy ? "Verificando con Meta…" : "Conectar"}
      </button>
    </form>
  );
}

function Templates({ channel }: { channel: Channel }) {
  const [list, setList] = useState<Template[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [t, setT] = useState({
    name: "",
    language: "es",
    category: "UTILITY",
    body: "",
    footer: "",
    examples: [] as string[],
  });

  const load = useCallback(() => {
    api<Template[]>(`/api/channels/${channel.id}/templates`)
      .then(setList)
      .catch((e) => setError(errorMessage(e)));
  }, [channel.id]);
  useEffect(load, [load]);

  const varCount = Math.max(0, ...[...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));

  async function sync() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/channels/${channel.id}/templates/sync`, { method: "POST" });
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/channels/${channel.id}/templates`, {
        method: "POST",
        body: { ...t, footer: t.footer || undefined, examples: t.examples.slice(0, varCount) },
      });
      setOpen(false);
      setT({ ...t, name: "", body: "", footer: "", examples: [] });
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-medium">Plantillas ({list.length})</h3>
        <button type="button" className="btn-ghost" disabled={busy} onClick={sync}>
          Sincronizar con Meta
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(!open)}>
          Nueva plantilla
        </button>
      </div>
      <p className="text-sm text-zinc-500">
        Las plantillas son los únicos mensajes que puedes enviar cuando pasaron más de 24 h desde el
        último mensaje del cliente (confirmaciones, avisos de envío, remarketing). Meta las revisa
        antes de aprobarlas.
      </p>
      <ErrorText>{error}</ErrorText>
      {open && (
        <form
          onSubmit={create}
          className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="label">Nombre</span>
              <input
                className="input font-mono"
                required
                placeholder="confirmacion_pedido"
                value={t.name}
                onChange={(e) =>
                  setT({ ...t, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })
                }
              />
            </label>
            <label className="block">
              <span className="label">Idioma</span>
              <select
                className="input"
                value={t.language}
                onChange={(e) => setT({ ...t, language: e.target.value })}
              >
                <option value="es">Español (es)</option>
                <option value="es_MX">Español México (es_MX)</option>
                <option value="es_AR">Español Argentina (es_AR)</option>
                <option value="en">English (en)</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Categoría</span>
              <select
                className="input"
                value={t.category}
                onChange={(e) => setT({ ...t, category: e.target.value })}
              >
                <option value="UTILITY">Utilidad (pedidos, envíos)</option>
                <option value="MARKETING">Marketing (promociones)</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="label">
              Texto (usa {"{{1}}"}, {"{{2}}"}… para datos variables)
            </span>
            <textarea
              className="input"
              rows={4}
              required
              placeholder="Hola {{1}}, tu pedido de {{2}} fue confirmado. Te avisaremos cuando salga a reparto."
              value={t.body}
              onChange={(e) => setT({ ...t, body: e.target.value })}
            />
          </label>
          {varCount > 0 && (
            <div className="grid gap-2 sm:grid-cols-3">
              {Array.from({ length: varCount }, (_, k) => k + 1).map((n) => (
                <label key={`ex-${n}`} className="block">
                  <span className="label">Ejemplo para {`{{${n}}}`}</span>
                  <input
                    className="input"
                    required
                    value={t.examples[n - 1] ?? ""}
                    onChange={(e) => {
                      const ex = [...t.examples];
                      ex[n - 1] = e.target.value;
                      setT({ ...t, examples: ex });
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          <label className="block">
            <span className="label">Pie (opcional)</span>
            <input
              className="input"
              maxLength={60}
              value={t.footer}
              onChange={(e) => setT({ ...t, footer: e.target.value })}
            />
          </label>
          <button type="submit" className="btn" disabled={busy}>
            Enviar a revisión de Meta
          </button>
        </form>
      )}
      <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {list.length === 0 && (
          <div className="p-4 text-sm text-zinc-500">
            Sin plantillas. Sincroniza para traer las que ya tienes en Meta.
          </div>
        )}
        {list.map((x) => (
          <div key={x.id} className="p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-medium">{x.name}</span>
              <span className="text-xs text-zinc-500">
                {x.language} · {x.category}
              </span>
              <span
                className={`ml-auto rounded px-2 py-0.5 text-xs ${STATUS_STYLE[x.status] ?? "bg-zinc-100 dark:bg-zinc-800"}`}
              >
                {x.status}
              </span>
            </div>
            <div className="mt-1 text-zinc-500">
              {x.components.find((c) => c.type.toUpperCase() === "BODY")?.text}
            </div>
            {x.rejectedReason && (
              <div className="mt-1 text-xs text-red-600">
                Motivo del rechazo: {x.rejectedReason}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelCard({ ch, onChange }: { ch: Channel; onChange: () => void }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [token, setToken] = useState("");

  async function run(fn: () => Promise<unknown>, ok: string) {
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(ok);
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="card space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">
            {ch.verifiedName || ch.name} <span className="text-zinc-500">{ch.displayPhone}</span>
          </div>
          <div className="text-xs text-zinc-500">
            Phone Number ID {ch.phoneNumberId} · WABA {ch.wabaId}
          </div>
        </div>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            ch.status === "activo"
              ? STATUS_STYLE.APPROVED
              : ch.status === "error"
                ? STATUS_STYLE.REJECTED
                : STATUS_STYLE.PENDING
          }`}
        >
          {ch.status}
        </span>
      </div>
      {ch.lastError && <ErrorText>{ch.lastError}</ErrorText>}

      <div className="space-y-3">
        <div className="text-sm font-medium">
          Webhook (pégalo en Meta → WhatsApp → Configuración)
        </div>
        <Copy label="URL de devolución de llamada" value={ch.webhookUrl} />
        <Copy label="Token de verificación" value={ch.verifyToken} />
        <div className="text-xs text-zinc-500">
          {ch.webhookVerifiedAt
            ? `✓ Verificado por Meta el ${new Date(ch.webhookVerifiedAt).toLocaleString()}`
            : "Aún no verificado por Meta."}{" "}
          {ch.lastEventAt ? `Último evento: ${new Date(ch.lastEventAt).toLocaleString()}.` : ""}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={() =>
            run(
              () => api(`/api/channels/${ch.id}/test`, { method: "POST" }),
              "Conexión con Meta OK.",
            )
          }
        >
          Probar conexión
        </button>
        <input
          className="input max-w-xs font-mono"
          type="password"
          autoComplete="off"
          placeholder="Nuevo token de acceso"
          aria-label="Nuevo token de acceso"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button
          type="button"
          className="btn-ghost"
          disabled={token.length < 20}
          onClick={() =>
            run(async () => {
              await api(`/api/channels/${ch.id}`, {
                method: "PATCH",
                body: { accessToken: token },
              });
              setToken("");
            }, "Token actualizado.")
          }
        >
          Cambiar token
        </button>
        <button
          type="button"
          className="ml-auto text-sm text-red-600 hover:underline"
          onClick={() => {
            if (
              confirm("¿Desconectar este número? Se borran también sus conversaciones en chatea.")
            ) {
              run(
                () => api(`/api/channels/${ch.id}`, { method: "DELETE" }),
                "Número desconectado.",
              );
            }
          }}
        >
          Desconectar
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
      {notice && <p className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

      <Templates channel={ch} />
    </div>
  );
}

export default function Page() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => {
    api<Channel[]>("/api/channels")
      .then(setChannels)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  return (
    <>
      <div className="mb-2 text-sm">
        <Link href="/panel/integraciones" className="text-zinc-500 hover:underline">
          ← Integraciones
        </Link>
      </div>
      <PageHeader
        title="WhatsApp"
        description="Conecta tu número de WhatsApp Business por la API oficial de Meta (Cloud API). Los mensajes llegan a Conversaciones."
      />
      <ErrorText>{error}</ErrorText>
      <div className="space-y-6">
        {channels?.map((c) => (
          <ChannelCard key={c.id} ch={c} onChange={load} />
        ))}
        {channels && (channels.length === 0 || adding) ? (
          <ConnectForm
            onDone={() => {
              setAdding(false);
              load();
            }}
          />
        ) : (
          channels && (
            <button type="button" className="btn-ghost" onClick={() => setAdding(true)}>
              Conectar otro número
            </button>
          )
        )}
      </div>
    </>
  );
}
