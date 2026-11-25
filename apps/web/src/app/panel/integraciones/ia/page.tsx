"use client";
import {
  type AgentKind,
  AI_PROVIDER_KINDS,
  AI_PROVIDER_LABELS,
  type AiProviderKind,
  MODEL_CATALOG,
  MODEL_TIER_LABELS,
  recommendedModel,
} from "@chatea/shared";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Provider = {
  id: string;
  kind: AiProviderKind;
  name: string;
  apiKeyHint: string;
  baseUrl: string | null;
};
type AgentConfig = {
  agent: AgentKind;
  providerId: string | null;
  model: string | null;
  temperature: number;
};
/** Modelos de la cuenta: lista, {error} si la API falló, undefined mientras carga. */
type Live = Record<string, string[] | { error: string } | undefined>;

const AGENT_INFO: Record<AgentKind, { label: string; hint: string }> = {
  ventas: {
    label: "Ventas",
    hint: "Conversa con el cliente y cierra el pedido. Es donde más rinde un buen modelo.",
  },
  confirmacion: { label: "Confirmaciones", hint: "Confirma o corrige pedidos antes del despacho." },
  seguimiento: { label: "Seguimiento", hint: "Avisos de guía, reparto, oficina y entrega." },
  novedades: {
    label: "Novedades",
    hint: "Resuelve novedades de la transportadora con el cliente.",
  },
  utilidad: {
    label: "Tareas rápidas",
    hint: "Clasificar, extraer datos, generar productos con IA. Un modelo barato basta.",
  },
};

const PROVIDER_HELP: Record<AiProviderKind, { keyUrl: string; placeholder: string }> = {
  anthropic: { keyUrl: "https://console.anthropic.com/settings/keys", placeholder: "sk-ant-…" },
  openai: { keyUrl: "https://platform.openai.com/api-keys", placeholder: "sk-…" },
  xai: { keyUrl: "https://console.x.ai", placeholder: "xai-…" },
  google: { keyUrl: "https://aistudio.google.com/apikey", placeholder: "AIza…" },
  openai_compatible: { keyUrl: "https://openrouter.ai/keys", placeholder: "Token del servicio" },
};

const LIVE_ERRORS: Record<string, string> = {
  ia_api_key_invalida: "El proveedor rechazó la API key",
  proveedor_no_responde: "El proveedor no respondió",
  url_privada: "URL no permitida",
};

const OTHER = "__otro__";

function ProviderCard({
  kind,
  connected,
  live,
  onChange,
}: {
  kind: AiProviderKind;
  connected: Provider[];
  live: Live;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/ai-providers", {
        method: "POST",
        body: { kind, name: AI_PROVIDER_LABELS[kind], apiKey, baseUrl: baseUrl || undefined },
      });
      setApiKey("");
      setBaseUrl("");
      setOpen(false);
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Provider) {
    if (!confirm(`¿Desconectar ${p.name}? Los agentes que lo usan quedarán sin modelo.`)) return;
    try {
      await api(`/api/ai-providers/${p.id}`, { method: "DELETE" });
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{AI_PROVIDER_LABELS[kind]}</span>
        {connected.length ? (
          <span className="rounded bg-brand-100 px-2 py-0.5 text-xs text-brand-800 dark:bg-brand-900 dark:text-brand-200">
            Conectado
          </span>
        ) : (
          <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
            Sin conectar
          </span>
        )}
      </div>
      {connected.map((p) => {
        const l = live[p.id];
        return (
          <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
            <div className="min-w-0 text-zinc-500">
              <div className="truncate">
                {p.apiKeyHint}
                {p.baseUrl ? ` · ${p.baseUrl}` : ""}
              </div>
              <div className="text-xs">
                {l === undefined
                  ? "Consultando modelos…"
                  : Array.isArray(l)
                    ? `${l.length} modelos disponibles en tu cuenta`
                    : `⚠ ${LIVE_ERRORS[l.error] ?? l.error}`}
              </div>
            </div>
            <button
              type="button"
              className="text-xs text-red-600 hover:underline"
              onClick={() => remove(p)}
            >
              Desconectar
            </button>
          </div>
        );
      })}
      {MODEL_CATALOG[kind].length > 0 && (
        <div className="text-xs text-zinc-500">
          Recomendados: {MODEL_CATALOG[kind].map((m) => m.label).join(", ")}
        </div>
      )}
      {open ? (
        <form onSubmit={connect} className="space-y-2">
          {kind === "openai_compatible" && (
            <input
              className="input"
              type="url"
              required
              placeholder="https://openrouter.ai/api/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          )}
          <input
            className="input"
            type="password"
            required
            autoComplete="off"
            aria-label={`API key de ${AI_PROVIDER_LABELS[kind]}`}
            placeholder={PROVIDER_HELP[kind].placeholder}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="submit" className="btn" disabled={busy}>
              Conectar
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
          <a
            href={PROVIDER_HELP[kind].keyUrl}
            target="_blank"
            rel="noreferrer"
            className="block text-xs text-brand-700 hover:underline dark:text-brand-400"
          >
            ¿Dónde obtengo la API key?
          </a>
        </form>
      ) : (
        <button type="button" className="btn-ghost mt-auto" onClick={() => setOpen(true)}>
          {connected.length ? "Conectar otra key" : "Conectar"}
        </button>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function AgentCard({
  config,
  providers,
  live,
  onSaved,
}: {
  config: AgentConfig;
  providers: Provider[];
  live: Live;
  onSaved: (c: AgentConfig) => void;
}) {
  const current = providers.find((p) => p.id === config.providerId);
  const [kind, setKind] = useState<AiProviderKind>(current?.kind ?? "anthropic");
  const [providerId, setProviderId] = useState<string | null>(config.providerId);
  const [model, setModel] = useState(config.model ?? "");
  const [custom, setCustom] = useState(false);
  const [temperature, setTemperature] = useState(Math.round(config.temperature * 100) / 100);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const ofKind = providers.filter((p) => p.kind === kind);
  const pid =
    providerId && ofKind.some((p) => p.id === providerId) ? providerId : (ofKind[0]?.id ?? null);
  const liveList = pid ? live[pid] : undefined;
  const available = Array.isArray(liveList) ? new Set(liveList) : null;
  const catalog = MODEL_CATALOG[kind];
  const rec = recommendedModel(kind, config.agent);
  const inCatalog = catalog.some((m) => m.id === model);
  const extra = available ? [...available].filter((id) => !catalog.some((m) => m.id === id)) : [];
  const showCustom = custom || (model !== "" && !inCatalog && !available?.has(model));
  const selected = catalog.find((m) => m.id === model);
  const isSaved =
    pid === config.providerId &&
    model === (config.model ?? "") &&
    temperature === Math.round(config.temperature * 100) / 100;

  function pickKind(k: AiProviderKind) {
    setKind(k);
    setProviderId(providers.find((p) => p.kind === k)?.id ?? null);
    const r = recommendedModel(k, config.agent);
    setModel(r?.id ?? "");
    setCustom(!r);
    setSaved(false);
  }

  async function save() {
    setError("");
    try {
      const row = await api<AgentConfig>(`/api/agent-configs/${config.agent}`, {
        method: "PUT",
        body: { providerId: pid, model: model || null, temperature },
      });
      onSaved(row);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">{AGENT_INFO[config.agent].label}</div>
          <div className="text-sm text-zinc-500">{AGENT_INFO[config.agent].hint}</div>
        </div>
        {config.model && (
          <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            En uso: {config.model}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_7rem]">
        <div>
          <label className="label" htmlFor={`k-${config.agent}`}>
            Proveedor
          </label>
          <select
            id={`k-${config.agent}`}
            className="input"
            value={kind}
            onChange={(e) => pickKind(e.target.value as AiProviderKind)}
          >
            {AI_PROVIDER_KINDS.map((k) => (
              <option key={k} value={k}>
                {AI_PROVIDER_LABELS[k]}
                {providers.some((p) => p.kind === k) ? "" : " (sin conectar)"}
              </option>
            ))}
          </select>
          {ofKind.length > 1 && (
            <select
              className="input mt-2"
              aria-label="Cuenta"
              value={pid ?? ""}
              onChange={(e) => setProviderId(e.target.value)}
            >
              {ofKind.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.apiKeyHint}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="label" htmlFor={`m-${config.agent}`}>
            Modelo
          </label>
          <select
            id={`m-${config.agent}`}
            className="input"
            value={showCustom ? OTHER : model}
            onChange={(e) => {
              if (e.target.value === OTHER) {
                setCustom(true);
                setModel("");
              } else {
                setCustom(false);
                setModel(e.target.value);
              }
              setSaved(false);
            }}
          >
            <option value="">— Elegir modelo —</option>
            {catalog.length > 0 && (
              <optgroup label="Recomendados">
                {[...catalog]
                  .sort((a, b) => Number(b.id === rec?.id) - Number(a.id === rec?.id))
                  .map((m) => (
                    <option
                      key={m.id}
                      value={m.id}
                      disabled={Boolean(available && !available.has(m.id))}
                    >
                      {m.id === rec?.id ? "★ " : ""}
                      {m.label} · {MODEL_TIER_LABELS[m.tier]}
                      {available && !available.has(m.id) ? " — no disponible en tu cuenta" : ""}
                    </option>
                  ))}
              </optgroup>
            )}
            {extra.length > 0 && (
              <optgroup label="Otros modelos de tu cuenta">
                {extra.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={OTHER}>Escribir otro ID…</option>
          </select>
          {showCustom && (
            <input
              className="input mt-2 font-mono text-sm"
              aria-label="ID del modelo"
              placeholder="ID exacto del modelo"
              list={`live-${config.agent}`}
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setSaved(false);
              }}
            />
          )}
          <datalist id={`live-${config.agent}`}>
            {(Array.isArray(liveList) ? liveList : []).map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="label" htmlFor={`t-${config.agent}`}>
            Temperatura
          </label>
          <input
            id={`t-${config.agent}`}
            className="input"
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={temperature}
            onChange={(e) => {
              setTemperature(Number(e.target.value));
              setSaved(false);
            }}
          />
        </div>
      </div>

      {selected && <p className="text-sm text-zinc-500">{selected.note}</p>}
      {!pid && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Conecta tu API key de {AI_PROVIDER_LABELS[kind]} arriba para usar este proveedor.
        </p>
      )}
      {model && available && !available.has(model) && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Este modelo no aparece en tu cuenta de {AI_PROVIDER_LABELS[kind]}.
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="btn" disabled={!pid || !model || isSaved} onClick={save}>
          {saved ? "Guardado ✓" : isSaved ? "Guardado" : "Guardar"}
        </button>
        {rec && model !== rec.id && (!available || available.has(rec.id)) && (
          <button
            type="button"
            className="text-sm text-brand-700 hover:underline dark:text-brand-400"
            onClick={() => {
              setModel(rec.id);
              setCustom(false);
              setSaved(false);
            }}
          >
            Usar el recomendado: {rec.label}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [configs, setConfigs] = useState<AgentConfig[] | null>(null);
  const [live, setLive] = useState<Live>({});
  const [error, setError] = useState("");

  const loadProviders = useCallback(async () => {
    try {
      const p = await api<Provider[]>("/api/ai-providers");
      setProviders(p);
      for (const prov of p) {
        api<{ models: string[] }>(`/api/ai-providers/${prov.id}/models`)
          .then((r) => setLive((l) => ({ ...l, [prov.id]: r.models })))
          .catch((e: { code?: string }) =>
            setLive((l) => ({ ...l, [prov.id]: { error: e.code ?? "proveedor_no_responde" } })),
          );
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    loadProviders();
    api<AgentConfig[]>("/api/agent-configs")
      .then(setConfigs)
      .catch((e) => setError(errorMessage(e)));
  }, [loadProviders]);

  return (
    <>
      <div className="mb-2 text-sm">
        <Link href="/panel/integraciones" className="text-zinc-500 hover:underline">
          ← Integraciones
        </Link>
      </div>
      <PageHeader
        icon={Sparkles}
        title="Modelos de IA"
        description="Conecta tus cuentas y elige el modelo de cada agente. Puedes mezclar proveedores: por ejemplo Claude para vender y un modelo barato para los avisos. Las API keys se guardan cifradas y nunca se vuelven a mostrar."
      />
      <ErrorText>{error}</ErrorText>

      <h2 className="mb-3 font-medium">Proveedores</h2>
      <div className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {AI_PROVIDER_KINDS.map((k) => (
          <ProviderCard
            key={k}
            kind={k}
            connected={providers.filter((p) => p.kind === k)}
            live={live}
            onChange={loadProviders}
          />
        ))}
      </div>

      <h2 className="mb-1 font-medium">Modelo por agente</h2>
      <p className="mb-3 text-sm text-zinc-500">
        ★ = recomendado para ese agente. Los modelos que no existan en tu cuenta aparecen
        deshabilitados.
      </p>
      <div className="space-y-3">
        {configs?.map((c) => (
          <AgentCard
            key={`${c.agent}-${providers.map((p) => p.id).join()}`}
            config={c}
            providers={providers}
            live={live}
            onSaved={(row) =>
              setConfigs((cs) => cs?.map((x) => (x.agent === row.agent ? row : x)) ?? null)
            }
          />
        ))}
      </div>
    </>
  );
}
