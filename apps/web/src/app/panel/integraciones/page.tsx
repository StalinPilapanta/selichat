import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { INTEGRATIONS } from "@/lib/integrations";

export default function Page() {
  return (
    <>
      <PageHeader
        title="Integraciones"
        description="Conecta los servicios que usan tus agentes. Las credenciales se guardan cifradas."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {INTEGRATIONS.map((i) => {
          const body = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{i.name}</span>
                {i.phase ? (
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                    Próximamente · {i.phase}
                  </span>
                ) : (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    Disponible
                  </span>
                )}
              </div>
              <div className="mt-1 text-sm text-zinc-500">{i.description}</div>
            </>
          );
          return i.href ? (
            <Link key={i.key} href={i.href} className="card hover:border-emerald-500">
              {body}
            </Link>
          ) : (
            <div key={i.key} className="card opacity-70">
              {body}
            </div>
          );
        })}
      </div>
    </>
  );
}
