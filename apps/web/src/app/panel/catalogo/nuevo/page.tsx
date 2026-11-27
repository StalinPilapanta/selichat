"use client";
import { PackagePlus, Truck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { DropiPicker } from "@/components/catalog/DropiPicker";
import { emptyProduct, ProductEditor, type ProductForm } from "@/components/catalog/ProductEditor";
import type { PromptDraft } from "@/components/PromptEditor";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { type DropiCatalogProduct, dropiSourceText, formFromDropi } from "@/lib/dropi-catalog";

type Draft = {
  name: string;
  description: string;
  price: string;
  offers: { quantity: number; totalPrice: string; label: string }[];
  faqs: { question: string; answer: string }[];
  initialMessage: string;
  entryQuestion: string;
  sections: Record<string, string>;
  variables: Record<string, string>;
};

function NewProduct() {
  const wantsAi = useSearchParams().get("ia") === "1";
  const [currency, setCurrency] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm | null>(null);
  const [prompt, setPrompt] = useState<PromptDraft | null>(null);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState(0);
  /** Producto de Dropi elegido: sus datos (ID, foto, precio, variantes) se conservan. */
  const [dropi, setDropi] = useState<DropiCatalogProduct | null>(null);
  const [showDropi, setShowDropi] = useState(false);

  function pickDropi(p: DropiCatalogProduct) {
    setDropi(p);
    setShowDropi(false);
    setForm((f) => formFromDropi(p, f ?? emptyProduct(currency ?? "USD")));
    setKey((k) => k + 1);
    // Con IA: la ficha arranca con lo que trae Dropi; se puede completar antes de generar.
    if (wantsAi) setSource((s) => (s.trim() ? s : dropiSourceText(p)));
  }

  useEffect(() => {
    api<{ currency: string; country: string } | null>("/api/settings")
      .then((s) => {
        setCurrency(s?.currency ?? "USD");
        setForm(emptyProduct(s?.currency ?? "USD"));
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const d = await api<Draft>("/api/ai/generate-product", { method: "POST", body: { source } });
      // Si se eligió de Dropi, se conservan su ID, foto y variantes.
      const base = dropi
        ? formFromDropi(dropi, emptyProduct(currency ?? "USD"))
        : emptyProduct(currency ?? "USD");
      setForm({
        ...base,
        name: d.name,
        description: d.description,
        price: d.price || base.price,
        initialMessage: d.initialMessage,
        entryQuestion: d.entryQuestion,
        offers: d.offers
          .filter((o) => o.totalPrice)
          .map((o) => ({ ...o, featured: false, freeShipping: false })),
        faqs: d.faqs,
      });
      setPrompt({ mode: "guiado", content: "", sections: d.sections, variables: d.variables });
      setKey((k) => k + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-2 text-sm">
        <Link href="/panel/catalogo" className="text-zinc-500 hover:underline">
          ← Catálogo
        </Link>
      </div>
      <PageHeader icon={PackagePlus} title={wantsAi ? "Nuevo producto con IA" : "Nuevo producto"} />
      <div className="card mb-6 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
              <Truck className="size-5" />
            </span>
            <div>
              <div className="font-medium">¿El producto está en Dropi?</div>
              <p className="text-sm text-zinc-500">
                {dropi
                  ? `Usando «${dropi.name}» (ID ${dropi.id}): nombre, precio sugerido, foto y variantes ya están cargados${wantsAi ? " y la ficha para la IA arranca con sus datos" : ""}.`
                  : "Trae su nombre, precio sugerido, foto, ID y variantes con el ID o el nombre del producto en Dropi."}
              </p>
            </div>
          </div>
          {!showDropi && (
            <button type="button" className="btn-secondary" onClick={() => setShowDropi(true)}>
              {dropi ? "Cambiar producto" : "Importar desde Dropi"}
            </button>
          )}
        </div>
        {showDropi && <DropiPicker onPick={pickDropi} actionLabel="Usar sus datos" />}
      </div>
      {wantsAi && (
        <div className="card mb-6 space-y-3">
          <div className="font-medium">Crear con IA desde la ficha</div>
          <p className="text-sm text-zinc-500">
            Pega la ficha del proveedor (descripción, beneficios, precios, modo de uso). La IA
            propone los datos, las preguntas frecuentes y un prompt guiado; revisa todo antes de
            guardar. Usa el modelo de «Tareas rápidas» (
            <Link href="/panel/integraciones/ia" className="underline">
              configurar
            </Link>
            ).
          </p>
          <textarea
            className="input"
            rows={8}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={busy || source.trim().length < 30}
            onClick={generate}
          >
            {busy ? "Generando… (puede tardar un minuto)" : "Generar"}
          </button>
          <ErrorText>{error}</ErrorText>
          {prompt && (
            <p className="text-sm text-brand-700 dark:text-brand-400">
              Listo. Revisa las pestañas; el prompt guiado se guardará como borrador al crear el
              producto.
            </p>
          )}
        </div>
      )}
      {!wantsAi && <ErrorText>{error}</ErrorText>}
      {form && <ProductEditor key={key} initial={form} initialPrompt={prompt} />}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <NewProduct />
    </Suspense>
  );
}
