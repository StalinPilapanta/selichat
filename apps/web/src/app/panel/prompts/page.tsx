"use client";
import { Bot } from "lucide-react";
import { useState } from "react";
import { PromptEditor } from "@/components/PromptEditor";
import { PageHeader } from "@/components/ui";

const TABS = {
  common: {
    label: "Capa común",
    help: "Reglas de comportamiento que aplican a TODOS los productos: tono humano, manejo de URLs de media, cuántos mensajes enviar, qué no repetir.",
  },
  master: {
    label: "Prompt maestro",
    help: "Plantilla de ventas con {{variables}}. Se usa en los productos en modo «guiado»: cada producto completa las variables y las secciones.",
  },
} as const;

export default function Page() {
  const [tab, setTab] = useState<keyof typeof TABS>("common");
  return (
    <>
      <PageHeader
        icon={Bot}
        title="Prompts de la tienda"
        description="Capas que comparten todos tus productos. Cada guardado crea una versión; puedes volver a cualquier versión anterior."
      />
      <div className="mb-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(Object.keys(TABS) as (keyof typeof TABS)[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === k
                ? "border-brand-600 font-medium text-brand-700 dark:text-brand-400"
                : "border-transparent text-zinc-500"
            }`}
          >
            {TABS[k].label}
          </button>
        ))}
      </div>
      <PromptEditor key={tab} scope={tab} help={TABS[tab].help} />
    </>
  );
}
