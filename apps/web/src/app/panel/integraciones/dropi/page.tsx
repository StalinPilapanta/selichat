"use client";
import { DROPI_COUNTRIES, type DropiCountry, type DropiOptions } from "@chatea/shared";
import { useCallback, useEffect, useState } from "react";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Info = {
  connected: boolean;
  country?: DropiCountry;
  options: DropiOptions;
  tokenHint?: string;
  webhookUrl?: string | null;
};

const DEFAULTS: DropiOptions = {
  autoUpload: true,
  rateType: "CON RECAUDO",
  initialStatus: "PENDIENTE CONFIRMACION",
  risk: { enabled: false, minDeliveryRate: 50, minOrders: 2 },
};

export default function DropiPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [token, setToken] = useState("");
  const [country, setCountry] = useState<DropiCountry>("EC");
  const [options, setOptions] = useState<DropiOptions>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const i = await api<Info>("/api/integrations/dropi");
      setInfo(i);
      if (i.country) setCountry(i.country);
      setOptions({ ...DEFAULTS, ...i.options, risk: { ...DEFAULTS.risk, ...i.options?.risk } });
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

  if (!info) return <ErrorText>{error}</ErrorText>;

  return (
    <>
      <PageHeader
        title="Dropi"
        description="Cuando el cliente confirma con la IA, el pedido se sube a Dropi y su estado vuelve aquí."
      />
      <form onSubmit={save} className="max-w-2xl space-y-6">
        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Conexión</h2>
            {info.connected ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                Conectado · token {info.tokenHint}
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
          <label className="block text-sm">
            <span className="label">
              Token de integración {info.connected && "(déjalo vacío para mantener el actual)"}
            </span>
            <input
              className="input font-mono text-xs"
              type="password"
              autoComplete="off"
              placeholder={info.connected ? "••••••••" : "Pega aquí el token de Dropi"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <p className="text-xs text-zinc-500">
            En Dropi: <b>Mis integraciones → Nueva integración</b> (tipo API o WooCommerce) y copia
            el token. Se guarda cifrado y la IA nunca lo ve.
          </p>
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
                Se buscan sus pedidos anteriores en tu tienda de Dropi por teléfono. Si recibe muy
                pocos, el pedido queda en «Revisar (riesgo)» y un dueño o administrador decide.
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
            </div>
          )}
        </section>

        {info.webhookUrl && (
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
        {saved && <p className="text-sm text-emerald-700 dark:text-emerald-400">{saved}</p>}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="btn"
            disabled={busy || (!info.connected && !token.trim())}
          >
            {busy
              ? "Verificando con Dropi…"
              : info.connected
                ? "Guardar cambios"
                : "Conectar Dropi"}
          </button>
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

/** Buscador de agencias Servientrega: la IA ofrece retiro en oficina cerca del cliente. */
function AgencyFinder() {
  const [state, setState] = useState<{ available: boolean; enabled: boolean } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ available: boolean; enabled: boolean }>("/api/integrations/servientrega")
      .then(setState)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  async function toggle(enabled: boolean) {
    setError("");
    try {
      await api("/api/integrations/servientrega", { method: "PUT", body: { enabled } });
      setState((s) => (s ? { ...s, enabled } : s));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  if (!state?.available) return null;
  return (
    <section className="card mt-6 max-w-2xl space-y-2">
      <h2 className="font-medium">Agencias Servientrega</h2>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={state.enabled}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span>
          Ofrecer retiro en agencia
          <span className="block text-xs text-zinc-500">
            Cuando el cliente dé su ciudad y sector, la IA le muestra las agencias de Servientrega
            más cercanas (dirección y horario, solo las que entregan en oficina). Si elige una, el
            pedido sube a Dropi como «retiro en oficina».
          </span>
        </span>
      </label>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
