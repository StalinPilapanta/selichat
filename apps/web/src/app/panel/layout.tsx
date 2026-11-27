"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell, type ContentWidth } from "@/components/shell";

/**
 * Ancho del contenido según la pantalla: tableros y listas a todo el ancho; formularios y
 * pantallas de pocas tarjetas, centrados (en monitores anchos no se estiran las líneas).
 */
function widthFor(pathname: string): ContentWidth {
  const p = pathname.replace(/\/$/, "");
  if (p === "/panel/integraciones" || p === "/panel/integraciones/ia") return "lg";
  if (["/panel/integraciones/whatsapp", "/panel/configuracion", "/panel/equipo"].includes(p))
    return "md";
  if (p === "/panel/integraciones/dropi" || p === "/panel/perfil") return "sm";
  return "full";
}

import {
  authClient,
  useActiveOrganization,
  useListOrganizations,
  useSession,
} from "@/lib/auth-client";
import { BrandingProvider } from "@/lib/branding";
import { OrderNotifier } from "@/lib/order-alerts";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = useSession();
  const { data: orgs, isPending: orgsPending } = useListOrganizations();
  const { data: active } = useActiveOrganization();

  useEffect(() => {
    if (isPending) return;
    if (!session) return router.replace(`/entrar?next=${encodeURIComponent(pathname)}`);
    // Sin WhatsApp del dueño (entró con Google o cuenta anterior): se pide una vez.
    if (!session.user.phone)
      return router.replace(`/confirmar-whatsapp?next=${encodeURIComponent(pathname)}`);
    if (orgsPending || !orgs) return;
    // Sin tiendas: a crear una. Si la sesión ya tiene tienda activa, la lista está desactualizada.
    if (orgs.length === 0 && !session.session.activeOrganizationId)
      return router.replace("/crear-tienda");
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
    <BrandingProvider tenantId={active.id}>
      <AppShell
        user={{
          name: session.user.name,
          email: session.user.email,
          role: active.members?.find((m) => m.userId === session.user.id)?.role ?? null,
        }}
        storeName={active.name}
        storeSwitcher={switcher}
        fullBleed={pathname.startsWith("/panel/inbox")}
        width={widthFor(pathname)}
        onSignOut={async () => {
          await authClient.signOut();
          router.replace("/entrar");
        }}
      >
        <OrderNotifier tenantId={active.id} />
        {children}
      </AppShell>
    </BrandingProvider>
  );
}
