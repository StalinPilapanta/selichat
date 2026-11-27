"use client";
import { Download } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { DropiPicker } from "@/components/catalog/DropiPicker";
import { emptyProduct, type ProductForm } from "@/components/catalog/ProductEditor";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { type DropiCatalogProduct, formFromDropi } from "@/lib/dropi-catalog";

type PreviewProduct = {
  slot: string;
  name: string;
  price: string;
  currency: string;
  status: string;
  triggers: number;
  media: number;
  promptMode: string | null;
  alreadyImported: boolean;
  warnings: string[];
};
type Preview = { hasCommon: boolean; hasMaster: boolean; products: PreviewProduct[] };
type Result = {
  products: { slot: string; name: string; action: string; warnings: string[] }[];
  commonUpdated: boolean;
  masterUpdated: boolean;
};

/** Importar desde Chatea Pro: productos, disparadores, multimedia, recordatorios y prompts. */
function ChateaProImport() {
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeCommon, setIncludeCommon] = useState(true);
  const [includeMaster, setIncludeMaster] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const p = await api<Preview>("/api/import/chateapro/preview", {
        method: "POST",
        body: { token },
      });
      setPreview(p);
      setSelected(new Set(p.products.map((x) => x.slot)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError("");
    try {
      setResult(
        await api<Result>("/api/import/chateapro", {
          method: "POST",
          body: { token, slots: [...selected], includeCommon, includeMaster },
        }),
      );
      setToken("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (slot: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(slot) ? n.delete(slot) : n.add(slot);
      return n;
    });

  return (
    <>
      <p className="mb-4 text-sm text-zinc-500">
        Trae tus productos, disparadores, multimedia, recordatorios y prompts. Puedes repetirlo: los
        productos ya importados se actualizan, no se duplican.
      </p>

      {!result && (
        <div className="card mb-6 space-y-3">
          <label className="label" htmlFor="token">
            Token de API de Chatea Pro
          </label>
          <input
            id="token"
            className="input font-mono"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <p className="text-xs text-zinc-500">
            En Chatea Pro: Configuración → API → token con permiso «Manage Flow». Solo se usa para
            esta importación; no se guarda.
          </p>
          <button type="button" className="btn" disabled={busy || token.length < 10} onClick={load}>
            {busy && !preview ? "Leyendo…" : "Ver qué se va a importar"}
          </button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>

      {preview && !result && (
        <div className="space-y-4">
          <div className="card divide-y divide-zinc-200 p-0 dark:divide-zinc-800">
            {preview.products.map((p) => (
              <label key={p.slot} className="flex cursor-pointer gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(p.slot)}
                  onChange={() => toggle(p.slot)}
                />
                <div className="min-w-0">
                  <div className="font-medium">
                    {p.name}{" "}
                    <span className="text-sm font-normal text-zinc-500">
                      {p.currency === "USD" ? `$${p.price}` : `${p.price} ${p.currency}`} ·{" "}
                      {p.status}
                    </span>
                    {p.alreadyImported && (
                      <span className="ml-2 rounded bg-sky-100 px-1.5 text-xs text-sky-800 dark:bg-sky-900 dark:text-sky-200">
                        se actualizará
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-zinc-500">
                    {p.slot} · {p.triggers} disparadores · {p.media} archivos · prompt{" "}
                    {p.promptMode ?? "—"}
                  </div>
                  {p.warnings.map((w) => (
                    <div key={w} className="text-xs text-amber-700 dark:text-amber-400">
                      ⚠ {w}
                    </div>
                  ))}
                </div>
              </label>
            ))}
          </div>
          <div className="card space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeCommon}
                disabled={!preview.hasCommon}
                onChange={(e) => setIncludeCommon(e.target.checked)}
              />
              Capa común de comportamiento («Configuración general 2»)
              {!preview.hasCommon && " — no encontrada"}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeMaster}
                disabled={!preview.hasMaster}
                onChange={(e) => setIncludeMaster(e.target.checked)}
              />
              Prompt maestro con variables{!preview.hasMaster && " — no encontrado"}
            </label>
          </div>
          <button
            type="button"
            className="btn"
            disabled={busy || selected.size === 0}
            onClick={run}
          >
            {busy ? "Importando…" : `Importar ${selected.size} producto(s)`}
          </button>
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="card space-y-2">
            <div className="font-medium text-brand-700 dark:text-brand-400">
              Importación terminada
            </div>
            {result.products.map((p) => (
              <div key={p.slot} className="text-sm">
                <span className="font-medium">{p.name}</span> — {p.action}
                {p.warnings.map((w) => (
                  <div key={w} className="text-xs text-amber-700 dark:text-amber-400">
                    ⚠ {w}
                  </div>
                ))}
              </div>
            ))}
            <div className="text-sm text-zinc-500">
              Capa común: {result.commonUpdated ? "actualizada" : "sin cambios"} · Prompt maestro:{" "}
              {result.masterUpdated ? "actualizado" : "sin cambios"}
            </div>
          </div>
          <Link href="/panel/catalogo" className="btn">
            Ir al catálogo
          </Link>
        </div>
      )}
    </>
  );
}

/**
 * Importar desde Dropi: cada producto elegido se crea en el catálogo con su nombre, precio
 * sugerido, foto, ID y variantes; después se completa (mensaje inicial, ofertas, disparadores).
 */
function DropiImport() {
  const [currency, setCurrency] = useState("USD");
  const [importing, setImporting] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; name: string; dropiId: string }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ currency: string } | null>("/api/settings")
      .then((s) => setCurrency(s?.currency ?? "USD"))
      .catch(() => {});
  }, []);

  async function importOne(p: DropiCatalogProduct) {
    if (done.some((d) => d.dropiId === p.id)) return;
    setImporting(p.id);
    setError("");
    try {
      const form: ProductForm = formFromDropi(p, emptyProduct(currency));
      const r = await api<{ id: string }>("/api/products", {
        method: "POST",
        body: {
          ...form,
          imageUrl: form.imageUrl || null,
          dropiProductId: form.dropiProductId || null,
        },
      });
      setDone((d) => [{ id: r.id, name: p.name, dropiId: p.id }, ...d]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setImporting(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        Busca por ID o por nombre y toca «Importar». Se crea el producto con su nombre, precio
        sugerido, foto, ID de Dropi y variantes; luego completa el mensaje inicial, las ofertas y
        los disparadores para que la IA lo venda.
      </p>
      <div className="card">
        <DropiPicker onPick={importOne} actionLabel="Importar" busyId={importing} />
      </div>
      <ErrorText>{error}</ErrorText>
      {done.length > 0 && (
        <div className="card space-y-2">
          <div className="font-medium">Importados</div>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {done.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {d.name} <span className="text-zinc-500">· ID {d.dropiId}</span>
                </span>
                <Link href={`/panel/catalogo/${d.id}`} className="btn-secondary shrink-0">
                  Completar producto
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const SOURCES = [
  { key: "dropi", label: "Desde Dropi" },
  { key: "chateapro", label: "Desde Chatea Pro" },
] as const;

function ImportPage() {
  const router = useRouter();
  const from = useSearchParams().get("desde") === "chateapro" ? "chateapro" : "dropi";
  return (
    <>
      <div className="mb-2 text-sm">
        <Link href="/panel/catalogo" className="text-zinc-500 hover:underline">
          ← Catálogo
        </Link>
      </div>
      <PageHeader
        icon={Download}
        title="Importar productos"
        description="Trae productos que ya tienes en Dropi o en Chatea Pro."
      />
      <div className="mb-5 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {SOURCES.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={from === s.key}
            onClick={() =>
              router.replace(`/panel/catalogo/importar?desde=${s.key}`, { scroll: false })
            }
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              from === s.key
                ? "border-brand-600 font-medium text-brand-800 dark:text-brand-300"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {from === "dropi" ? <DropiImport /> : <ChateaProImport />}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ImportPage />
    </Suspense>
  );
}
