import { type LucideIcon, MessageCircle } from "lucide-react";

export function ErrorText({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      {children}
    </p>
  );
}

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Logo className="justify-center text-2xl" />
          <h1 className="mt-4 text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
        </div>
        <div className="card">{children}</div>
      </div>
    </main>
  );
}

/** Marca: el logo de la tienda (o una burbuja de chat) con su nombre. */
export function Logo({
  className = "",
  name = "Selichat",
  logoUrl,
}: {
  className?: string;
  name?: string;
  logoUrl?: string | null;
}) {
  return (
    <div className={`flex min-w-0 items-center gap-2 font-bold tracking-tight ${className}`}>
      {logoUrl ? (
        // biome-ignore lint/performance/noImgElement: logo subido por la tienda (dominio propio)
        <img src={logoUrl} alt="" className="size-8 shrink-0 rounded-xl object-contain" />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-600 text-brand-ink shadow-sm">
          <MessageCircle className="size-4.5" strokeWidth={2.5} />
        </span>
      )}
      <span className="truncate">{name}</span>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** Botones a la derecha del título. */
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
            <Icon className="size-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Pantalla vacía amigable: ícono, qué pasa y qué hacer. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
      <span className="grid size-12 place-items-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
        <Icon className="size-6" />
      </span>
      <h2 className="mt-3 font-semibold">{title}</h2>
      {description && <p className="mt-1 max-w-sm text-sm text-zinc-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
