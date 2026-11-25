"use client";
import { FlaskConical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ErrorText, PageHeader } from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";

type Msg = { role: "cliente" | "agente"; text: string; tools?: string[] };
type Product = { id: string; name: string; status: string };
type Verdict = {
  passed: boolean;
  resumen: string;
  checks: { criterio: string; cumple: boolean; detalle: string }[];
};
type SimResult = {
  transcript: Msg[];
  checkout: Record<string, string>;
  handedOff: boolean;
  verdict: Verdict;
  usage: { input: number; output: number };
  model: string;
};

const PERSONAS = [
  "Mujer de 45 años interesada, pregunta el precio y si es contra entrega, y compra 2 unidades.",
  "Cliente desconfiado: pregunta si es original, si tiene registro sanitario y si puede pagar al recibir. Compra solo si lo convencen.",
  "Cliente apurado que solo quiere el precio y luego deja de responder con evasivas.",
  "Cliente que da todos sus datos de una vez en el primer mensaje y quiere confirmar rápido.",
];

const friendly = (e: unknown) =>
  e instanceof ApiError && e.code === "ia_no_configurada"
    ? "Asigna un modelo al agente «Ventas» en Integraciones → Modelos de IA."
    : errorMessage(e);

function Bubble({ m }: { m: Msg }) {
  const mine = m.role === "agente";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
          mine
            ? "bg-brand-100 text-brand-950 dark:bg-brand-900 dark:text-brand-50"
            : "bg-zinc-100 dark:bg-zinc-800"
        }`}
      >
        {m.text}
        {m.tools?.length ? (
          <div className="mt-1 text-[11px] opacity-60">🔧 {m.tools.join(", ")}</div>
        ) : null}
      </div>
    </div>
  );
}

function OrderBox({ state }: { state: Record<string, string> }) {
  const entries = Object.entries(state).filter(([, v]) => v);
  if (!entries.length) return null;
  return (
    <div className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
      <div className="mb-1 font-medium">Datos del pedido que registró la IA</div>
      {entries.map(([k, v]) => (
        <div key={k}>
          <span className="text-zinc-500">{k}:</span> {v}
        </div>
      ))}
    </div>
  );
}

function ManualChat({ productId }: { productId: string }) {
  const [history, setHistory] = useState<Msg[]>([]);
  const [checkout, setCheckout] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  // Al cambiar de producto: reinicia y muestra el embudo inicial.
  useEffect(() => {
    setHistory([]);
    setCheckout({});
    setError("");
    if (!productId) return;
    api<{ replies: Msg[] }>("/api/agent/chat", {
      method: "POST",
      body: { productId, history: [] },
    })
      .then((r) => setHistory(r.replies))
      .catch((e) => setError(friendly(e)));
  }, [productId]);

  useEffect(() => {
    if (history.length) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [history]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    const next = [...history, { role: "cliente" as const, text: text.trim() }];
    setHistory(next);
    setText("");
    setBusy(true);
    setError("");
    try {
      const r = await api<{
        replies: Msg[];
        checkout: Record<string, string>;
        handedOff?: boolean;
      }>("/api/agent/chat", {
        method: "POST",
        body: { productId, history: next, checkout },
      });
      const paused: Msg[] = r.handedOff
        ? [{ role: "agente", text: "⏸️ La IA pasó la conversación a un humano." }]
        : [];
      setHistory([...next, ...r.replies, ...paused]);
      setCheckout(r.checkout);
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    // Vuelve al embudo inicial (lo que hay antes del primer mensaje del cliente).
    setHistory((h) => {
      const i = h.findIndex((m) => m.role === "cliente");
      return i < 0 ? h : h.slice(0, i);
    });
    setCheckout({});
    setError("");
  }

  return (
    <section className="flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h2 className="font-medium">Chat de prueba</h2>
        <button
          type="button"
          className="text-sm text-brand-700 hover:underline dark:text-brand-400"
          onClick={restart}
        >
          Reiniciar
        </button>
      </div>
      <div className="h-[28rem] space-y-2 overflow-y-auto p-4">
        {history.map((m, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: el historial solo crece
          <Bubble key={i} m={m} />
        ))}
        {busy && <p className="text-xs text-zinc-500">La IA está escribiendo…</p>}
        <div ref={end} />
      </div>
      <div className="space-y-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <OrderBox state={checkout} />
        <ErrorText>{error}</ErrorText>
        <form onSubmit={send} className="flex gap-2">
          <input
            className="input"
            placeholder="Escribe como si fueras el cliente…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn" disabled={busy || !text.trim()}>
            Enviar
          </button>
        </form>
        <p className="text-xs text-zinc-500">
          Usa el prompt publicado del producto y el modelo del agente Ventas. No se envía nada por
          WhatsApp ni se guarda.
        </p>
      </div>
    </section>
  );
}

function Simulation({ productId }: { productId: string }) {
  const [persona, setPersona] = useState(PERSONAS[0] ?? "");
  const [maxTurns, setMaxTurns] = useState(6);
  const [checks, setChecks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SimResult | null>(null);

  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await api<SimResult>("/api/agent/simulate", {
        method: "POST",
        body: {
          productId,
          persona,
          maxTurns,
          checks: checks
            .split("\n")
            .map((c) => c.trim())
            .filter(Boolean),
        },
      });
      setResult(r);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">Prueba automática</h2>
      <p className="text-sm text-zinc-500">
        Una IA hace de cliente con el perfil que elijas, conversa con tu agente y otra IA revisa si
        cumplió los criterios. Úsalo después de cambiar un prompt.
      </p>
      <label className="block text-sm">
        <span className="label">Perfil del cliente</span>
        <select
          className="input mb-2"
          value={PERSONAS.includes(persona) ? persona : ""}
          onChange={(e) => e.target.value && setPersona(e.target.value)}
        >
          {PERSONAS.map((p) => (
            <option key={p} value={p}>
              {p.length > 70 ? `${p.slice(0, 70)}…` : p}
            </option>
          ))}
          <option value="">Personalizado</option>
        </select>
        <textarea
          className="input"
          rows={3}
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <label className="block text-sm">
          <span className="label">Turnos máx.</span>
          <input
            className="input"
            type="number"
            min={2}
            max={10}
            value={maxTurns}
            onChange={(e) => setMaxTurns(Math.min(10, Math.max(2, Number(e.target.value) || 2)))}
          />
        </label>
        <label className="block text-sm">
          <span className="label">Criterios extra (uno por línea, opcional)</span>
          <textarea
            className="input"
            rows={2}
            placeholder="Ej.: Ofrece la promo de 2 frascos antes de pedir datos"
            value={checks}
            onChange={(e) => setChecks(e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        className="btn"
        disabled={busy || persona.trim().length < 5}
        onClick={run}
      >
        {busy ? "Simulando… (puede tardar 1 minuto)" : "Correr prueba"}
      </button>
      <ErrorText>{error}</ErrorText>

      {result && (
        <div className="space-y-3">
          <div
            className={`rounded-lg p-3 text-sm ${
              result.verdict.passed
                ? "bg-brand-50 text-brand-900 dark:bg-brand-950 dark:text-brand-100"
                : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
            }`}
          >
            <div className="font-medium">
              {result.verdict.passed
                ? "✅ Pasó todos los criterios"
                : "⚠️ Hay criterios por mejorar"}
            </div>
            <p className="mt-1">{result.verdict.resumen}</p>
          </div>
          <ul className="space-y-1 text-sm">
            {result.verdict.checks.map((c) => (
              <li key={c.criterio}>
                {c.cumple ? "✅" : "❌"} <span className="font-medium">{c.criterio}</span>
                <span className="block pl-6 text-xs text-zinc-500">{c.detalle}</span>
              </li>
            ))}
          </ul>
          <OrderBox state={result.checkout} />
          <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
            <summary className="cursor-pointer px-3 py-2 text-sm">
              Ver conversación ({result.transcript.length} mensajes)
            </summary>
            <div className="space-y-2 p-3">
              {result.transcript.map((m, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: transcripción fija
                <Bubble key={i} m={m} />
              ))}
            </div>
          </details>
          <p className="text-xs text-zinc-500">
            {result.model} · {result.usage.input.toLocaleString()} tokens de entrada ·{" "}
            {result.usage.output.toLocaleString()} de salida
          </p>
        </div>
      )}
    </section>
  );
}

export default function Page() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<Product[]>("/api/products")
      .then((list) => {
        const active = list.filter((p) => p.status === "activo");
        setProducts(active);
        if (active[0]) setProductId(active[0].id);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <>
      <PageHeader
        icon={FlaskConical}
        title="Probar agente"
        description="Conversa con tu agente de ventas o deja que una IA lo pruebe por ti, antes de que hable con clientes reales."
      />
      <label className="mb-4 block max-w-md text-sm">
        <span className="label">Producto</span>
        <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <ErrorText>{error}</ErrorText>
      {!products.length && !error && (
        <p className="text-sm text-zinc-500">Crea un producto activo en Catálogo para probarlo.</p>
      )}
      {productId && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ManualChat productId={productId} />
          <Simulation productId={productId} />
        </div>
      )}
    </>
  );
}
