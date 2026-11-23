"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { emptyProduct, ProductEditor, type ProductForm } from "@/components/catalog/ProductEditor";
import type { PromptDraft } from "@/components/PromptEditor";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

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
      const base = emptyProduct(currency ?? "USD");
      setForm({
        ...base,
        name: d.name,
        description: d.description,
        price: d.price,
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
      <PageHeader title="Nuevo producto" />
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
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
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
