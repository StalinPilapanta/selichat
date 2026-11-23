"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Row = {
  id: string;
  name: string;
  status: string;
  price: string;
  currency: string;
  imageUrl: string | null;
  dropiProductId: string | null;
  triggers: number;
  offers: number;
};

export default function Page() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    api<Row[]>("/api/products")
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const shown = rows?.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())) ?? [];

  return (
    <>
      <PageHeader
        title="Catálogo"
        description="Productos que venden tus agentes, con sus ofertas, multimedia, disparadores y prompt."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/panel/catalogo/nuevo" className="btn">
          Nuevo producto
        </Link>
        <Link href="/panel/catalogo/nuevo?ia=1" className="btn-ghost">
          Crear con IA desde la ficha
        </Link>
        <Link href="/panel/catalogo/importar" className="btn-ghost">
          Importar desde Chatea Pro
        </Link>
      </div>
      <ErrorText>{error}</ErrorText>
      {rows && rows.length > 5 && (
        <input
          className="input mb-3"
          placeholder="Buscar producto…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      {rows?.length === 0 && (
        <div className="card text-sm text-zinc-500">
          Aún no tienes productos. Crea el primero o impórtalos desde Chatea Pro.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((r) => (
          <Link
            key={r.id}
            href={`/panel/catalogo/${r.id}`}
            className="card flex gap-4 p-4 hover:border-emerald-500"
          >
            {r.imageUrl ? (
              // biome-ignore lint/performance/noImgElement: imagen externa del producto
              <img src={r.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="h-16 w-16 shrink-0 rounded-lg bg-zinc-100 dark:bg-zinc-800" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{r.name}</span>
                {r.status !== "activo" && (
                  <span className="rounded bg-zinc-200 px-1.5 text-xs dark:bg-zinc-700">
                    inactivo
                  </span>
                )}
              </div>
              <div className="text-sm text-zinc-500">
                {r.currency === "USD" ? `$${r.price}` : `${r.price} ${r.currency}`} · {r.offers}{" "}
                ofertas · {r.triggers} disparadores
              </div>
              {r.dropiProductId && (
                <div className="text-xs text-zinc-400">Dropi #{r.dropiProductId}</div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
