"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/shell";
import {
  authClient,
  useActiveOrganization,
  useListOrganizations,
  useSession,
} from "@/lib/auth-client";

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
      <div className="flex min-h-dvh items-center justify-center gap-2 text-sm text-zinc-500">
        <span className="size-2 animate-pulse rounded-full bg-brand-500" />
        Cargando…
      </div>
    );
  }

  const switcher =
    orgs && orgs.length > 1 ? (
      <select
        className="input"
        aria-label="Tienda"
        value={active.id}
        onChange={async (e) => {
          await authClient.organization.setActive({ organizationId: e.target.value });
          router.refresh();
        }}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {orgs.filter((x) => x.name === o.name).length > 1 ? `${o.name} (${o.slug})` : o.name}
          </option>
        ))}
      </select>
    ) : undefined;

  return (
    <AppShell
      user={{ name: session.user.name, email: session.user.email }}
      storeName={active.name}
      storeSwitcher={switcher}
      fullBleed={pathname.startsWith("/panel/inbox")}
      wide={pathname.startsWith("/panel/leads") || pathname.startsWith("/panel/pedidos")}
      onSignOut={async () => {
        await authClient.signOut();
        router.replace("/entrar");
      }}
    >
      {children}
    </AppShell>
  );
}
