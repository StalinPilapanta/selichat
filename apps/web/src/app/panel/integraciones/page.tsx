import { ChevronRight, Plug } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { INTEGRATIONS, type IntegrationInfo } from "@/lib/integrations";

function Card({ i }: { i: IntegrationInfo }) {
  const ready = Boolean(i.href);
  const body = (
    <div className="flex items-start gap-3">
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-xl ${
          ready
            ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
            : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
        }`}
      >
        <i.icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{i.name}</span>
          {ready ? (
            <ChevronRight className="size-4 text-zinc-400 transition-transform group-hover:translate-x-0.5" />
          ) : (
            <span className="badge badge-neutral">{i.phase}</span>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-500">{i.description}</p>
      </div>
    </div>
  );
  return i.href ? (
    <Link href={i.href} className="card group p-5 transition-colors hover:border-brand-500">
      {body}
    </Link>
  ) : (
    <div className="card p-5 opacity-60">{body}</div>
  );
}

/** Integraciones: primero las que ya se pueden conectar, luego las de próximas fases. */
export default function Page() {
  const ready = INTEGRATIONS.filter((i) => i.href);
  const soon = INTEGRATIONS.filter((i) => !i.href);
  return (
    <>
      <PageHeader
        icon={Plug}
        title="Integraciones"
        description="Conecta los servicios que usan tus agentes. Las credenciales se guardan cifradas."
      />
      <h2 className="mb-3 text-sm font-semibold text-zinc-500">Disponibles</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ready.map((i) => (
          <Card key={i.key} i={i} />
        ))}
      </div>
      {soon.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-sm font-semibold text-zinc-500">Próximamente</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {soon.map((i) => (
              <Card key={i.key} i={i} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
