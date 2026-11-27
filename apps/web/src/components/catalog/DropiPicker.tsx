"use client";
/**
 * Buscador del catálogo de Dropi por ID o nombre. Muestra foto, precios y stock, y devuelve el
 * producto elegido para precargarlo o importarlo.
 */
import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ErrorText } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { DropiCatalogProduct } from "@/lib/dropi-catalog";

type SearchResult = {
  products: DropiCatalogProduct[];
  mode: "token" | "mcp" | null;
  unavailable?: "sin_dropi" | "sin_busqueda";
};

const price = (n: number | null) => (n != null ? n.toFixed(2) : "—");

export function DropiPicker({
  onPick,
  actionLabel = "Usar este",
  busyId,
}: {
  onPick: (p: DropiCatalogProduct) => void;
  actionLabel?: string;
  /** Producto que se está importando (deshabilita su botón). */
  busyId?: string | null;
}) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    const text = q.trim();
    if (text.length < 2) return;
    setBusy(true);
    setError("");
    try {
      setResult(await api<SearchResult>(`/api/dropi/products?q=${encodeURIComponent(text)}`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={search} className="flex gap-2">
        <input
          className="input"
          placeholder="ID del producto en Dropi (p. ej. 140635) o parte del nombre"
          aria-label="Buscar en Dropi"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="btn shrink-0" disabled={busy || q.trim().length < 2}>
          <Search className="size-4" />
          {busy ? "Buscando…" : "Buscar"}
        </button>
      </form>
      <ErrorText>{error}</ErrorText>
      {result?.unavailable === "sin_dropi" && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Conecta tu cuenta de Dropi para buscar sus productos.{" "}
          <Link href="/panel/integraciones/dropi" className="underline">
            Conectar Dropi
          </Link>
        </p>
      )}
      {result && !result.unavailable && result.products.length === 0 && (
        <p className="text-sm text-zinc-500">
          {result.mode === "token" && !/^\d+$/.test(q.trim())
            ? "Con la conexión por token solo se busca por ID: escribe el número del producto en Dropi."
            : "No encontramos productos con esa búsqueda en Dropi."}
        </p>
      )}
      {result && result.products.length > 0 && (
        <ul className="max-h-[26rem] divide-y divide-zinc-200 overflow-y-auto rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {result.products.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-3">
              {p.imageUrl ? (
                // biome-ignore lint/performance/noImgElement: foto del catálogo de Dropi (dominio externo)
                <img
                  src={p.imageUrl}
                  alt=""
                  className="size-14 shrink-0 rounded-lg bg-zinc-100 object-cover dark:bg-zinc-800"
                />
              ) : (
                <span className="size-14 shrink-0 rounded-lg bg-zinc-100 dark:bg-zinc-800" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                  <span>ID {p.id}</span>
                  <span>Proveedor {price(p.cost)}</span>
                  <span>Sugerido {price(p.suggestedPrice)}</span>
                  <span>Stock {p.stock ?? "—"}</span>
                  {p.variations.length > 0 && <span>{p.variations.length} variantes</span>}
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary shrink-0"
                disabled={busyId === p.id}
                onClick={() => onPick(p)}
              >
                {busyId === p.id ? "Importando…" : actionLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
