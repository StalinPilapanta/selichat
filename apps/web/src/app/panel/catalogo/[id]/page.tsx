"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ProductEditor, type ProductForm, toForm } from "@/components/catalog/ProductEditor";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

function EditProduct() {
  const { id } = useParams<{ id: string }>();
  const tab = useSearchParams().get("tab");
  const [form, setForm] = useState<ProductForm | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/api/products/${id}`)
      .then((p) => setForm(toForm(p)))
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  return (
    <>
      <div className="mb-2 text-sm">
        <Link href="/panel/catalogo" className="text-zinc-500 hover:underline">
          ← Catálogo
        </Link>
      </div>
      <PageHeader title={form?.name ?? "Producto"} />
      <ErrorText>{error}</ErrorText>
      {form && <ProductEditor productId={id} initial={form} initialTab={tab} />}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <EditProduct />
    </Suspense>
  );
}
