"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  authClient,
  useActiveOrganization,
  useListOrganizations,
  useSession,
} from "@/lib/auth-client";
import { INTEGRATIONS } from "@/lib/integrations";

const NAV_SECTIONS: { title?: string; items: { href: string; label: string; soon?: string }[] }[] =
  [
    {
      items: [
        { href: "/panel", label: "Inicio" },
        { href: "/panel/inbox", label: "Conversaciones" },
        { href: "/panel/leads", label: "Leads" },
        { href: "/panel/pedidos", label: "Pedidos" },
        { href: "/panel/catalogo", label: "Catálogo" },
        { href: "/panel/prompts", label: "Prompts de la tienda" },
        { href: "/panel/probar-agente", label: "Probar agente" },
      ],
    },
    {
      title: "Integraciones",
      items: [
        ...INTEGRATIONS.map((i) => ({
          href: i.href ?? "/panel/integraciones",
          label: i.name,
          soon: i.href ? undefined : i.phase,
        })),
      ],
    },
    {
      title: "Tienda",
      items: [
        { href: "/panel/equipo", label: "Equipo" },
        { href: "/panel/configuracion", label: "Configuración" },
      ],
    },
  ];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = useSession();
  const { data: orgs, isPending: orgsPending } = useListOrganizations();
  const { data: active } = useActiveOrganization();

  useEffect(() => {
    if (isPending) return;
    if (!session) return router.replace(`/entrar?next=${encodeURIComponent(pathname)}`);
    if (orgsPending || !orgs) return;
    if (orgs.length === 0) return router.replace("/crear-tienda");
    const first = orgs[0];
    if (!session.session.activeOrganizationId && first) {
      authClient.organization.setActive({ organizationId: first.id });
    }
  }, [isPending, session, orgsPending, orgs, router, pathname]);

  if (isPending || !session || !active) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-zinc-500">
        Cargando…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-zinc-200 bg-white p-4 md:w-60 md:border-r md:border-b-0 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 text-xl font-bold text-emerald-600">chatea</div>
        {orgs && orgs.length > 1 ? (
          <select
            className="input mb-4"
            value={active.id}
            onChange={async (e) => {
              await authClient.organization.setActive({ organizationId: e.target.value });
              router.refresh();
            }}
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {orgs.filter((x) => x.name === o.name).length > 1
                  ? `${o.name} (${o.slug})`
                  : o.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="mb-4 truncate text-sm font-medium">{active.name}</div>
        )}
        <nav className="flex gap-1 overflow-x-auto md:flex-col md:gap-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title ?? "main"} className="flex gap-1 md:flex-col">
              {section.title &&
                (section.title === "Integraciones" ? (
                  <Link
                    href="/panel/integraciones"
                    className="hidden px-3 pt-1 text-xs font-semibold tracking-wide text-zinc-400 uppercase hover:text-emerald-600 md:block"
                  >
                    {section.title}
                  </Link>
                ) : (
                  <span className="hidden px-3 pt-1 text-xs font-semibold tracking-wide text-zinc-400 uppercase md:block">
                    {section.title}
                  </span>
                ))}
              {section.items.map((n) =>
                n.soon ? (
                  <span
                    key={n.label}
                    title={`Próximamente (${n.soon})`}
                    className="hidden items-center justify-between rounded-lg px-3 py-1.5 text-sm text-zinc-400 md:flex"
                  >
                    {n.label}
                    <span className="text-[10px] uppercase">pronto</span>
                  </span>
                ) : (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`rounded-lg px-3 py-2 text-sm whitespace-nowrap ${
                      (n.href === "/panel" ? pathname === n.href : pathname.startsWith(n.href))
                        ? "bg-emerald-50 font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {n.label}
                  </Link>
                ),
              )}
            </div>
          ))}
        </nav>
        <div className="mt-6 hidden border-t border-zinc-200 pt-4 text-xs text-zinc-500 md:block dark:border-zinc-800">
          <div className="truncate">{session.user.email}</div>
          <button
            type="button"
            className="mt-2 hover:underline"
            onClick={async () => {
              await authClient.signOut();
              router.replace("/entrar");
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      {pathname.startsWith("/panel/inbox") ? (
        <main className="min-w-0 flex-1">{children}</main>
      ) : (
        <main className="flex-1 p-4 md:p-8">
          <div className="mx-auto max-w-4xl">{children}</div>
        </main>
      )}
    </div>
  );
}
