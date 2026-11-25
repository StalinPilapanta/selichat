"use client";
/**
 * Marco del panel: menú lateral con íconos (agrupado), barra y cajón en el celular, menú del
 * usuario (tema y salir) y buscador rápido (Ctrl/⌘ K) de pantallas y conversaciones.
 */
import {
  Bot,
  ChevronDown,
  FlaskConical,
  Home,
  KanbanSquare,
  LogOut,
  type LucideIcon,
  Menu,
  MessageCircle,
  Monitor,
  Moon,
  Package,
  Plug,
  Search,
  Settings,
  ShoppingBag,
  Sun,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Logo } from "@/components/ui";
import { api } from "@/lib/api";
import { INTEGRATIONS } from "@/lib/integrations";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Muestra el contador de conversaciones sin leer. */
  unread?: boolean;
  soon?: string;
};
export type NavGroup = { title: string; items: NavItem[]; collapsible?: boolean };

export const NAV: NavGroup[] = [
  {
    title: "Trabajo",
    items: [
      { href: "/panel", label: "Inicio", icon: Home },
      { href: "/panel/inbox", label: "Conversaciones", icon: MessageCircle, unread: true },
      { href: "/panel/leads", label: "Leads", icon: KanbanSquare },
      { href: "/panel/pedidos", label: "Pedidos", icon: Package },
    ],
  },
  {
    title: "Agente IA",
    items: [
      { href: "/panel/catalogo", label: "Catálogo", icon: ShoppingBag },
      { href: "/panel/prompts", label: "Prompts de la tienda", icon: Bot },
      { href: "/panel/probar-agente", label: "Probar agente", icon: FlaskConical },
    ],
  },
  {
    title: "Integraciones",
    collapsible: true,
    items: [
      { href: "/panel/integraciones", label: "Todas", icon: Plug },
      ...INTEGRATIONS.map((i) => ({
        href: i.href ?? "/panel/integraciones",
        label: i.name,
        icon: Plug,
        soon: i.href ? undefined : i.phase,
      })),
    ],
  },
  {
    title: "Tienda",
    items: [
      { href: "/panel/equipo", label: "Equipo", icon: Users },
      { href: "/panel/configuracion", label: "Configuración", icon: Settings },
    ],
  },
];

const isActive = (pathname: string, href: string) =>
  href === "/panel" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

// ---------- Tema ----------

type Theme = "claro" | "oscuro" | "sistema";
function applyTheme(t: Theme) {
  try {
    localStorage.setItem("tema", t);
  } catch {}
  const dark =
    t === "oscuro" || (t === "sistema" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
function readTheme(): Theme {
  try {
    const t = localStorage.getItem("tema");
    if (t === "claro" || t === "oscuro") return t;
  } catch {}
  return "sistema";
}

// ---------- Contador de no leídos ----------

function useUnread() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ conversations: number }>("/api/conversations/unread-count")
        .then((r) => {
          if (alive) setN(r.conversations);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return n;
}

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-brand-ink">
      {n > 99 ? "99+" : n}
    </span>
  );
}

// ---------- Menú ----------

function NavLinks({ unread, onNavigate }: { unread: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <nav className="space-y-5">
      {NAV.map((g) => {
        const anyActive = g.items.some((i) => !i.soon && isActive(pathname, i.href));
        const expanded = !g.collapsible || open[g.title] || anyActive;
        return (
          <div key={g.title}>
            {g.collapsible ? (
              <button
                type="button"
                className="mb-1 flex w-full items-center justify-between px-3 text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                onClick={() => setOpen((o) => ({ ...o, [g.title]: !expanded }))}
                aria-expanded={expanded}
              >
                {g.title}
                <ChevronDown
                  className={`size-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`}
                />
              </button>
            ) : (
              <div className="mb-1 px-3 text-xs font-semibold text-zinc-500">{g.title}</div>
            )}
            {expanded && (
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const Icon = item.icon;
                  if (item.soon)
                    return (
                      <li
                        key={item.label}
                        title={`Próximamente (${item.soon})`}
                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-zinc-400"
                      >
                        <Icon className="size-4.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                        <span className="badge badge-neutral ml-auto">pronto</span>
                      </li>
                    );
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={`${item.href}-${item.label}`}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                          active
                            ? "bg-brand-50 font-semibold text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <Icon
                          className={`size-4.5 shrink-0 ${active ? "text-brand-600 dark:text-brand-400" : "text-zinc-400"}`}
                        />
                        <span className="truncate">{item.label}</span>
                        {item.unread && <Badge n={unread} />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function initials(name: string) {
  return (
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?"
  );
}

/** Menú del usuario: tema (claro / oscuro / sistema) y cerrar sesión. */
function UserMenu({
  user,
  onSignOut,
}: {
  user: { name?: string | null; email: string };
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("sistema");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setTheme(readTheme()), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const themes: { key: Theme; label: string; icon: LucideIcon }[] = [
    { key: "claro", label: "Claro", icon: Sun },
    { key: "oscuro", label: "Oscuro", icon: Moon },
    { key: "sistema", label: "Sistema", icon: Monitor },
  ];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-expanded={open}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-800 dark:bg-brand-900 dark:text-brand-100">
          {initials(user.name || user.email)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{user.name || "Mi cuenta"}</span>
          <span className="block truncate text-xs text-zinc-500">{user.email}</span>
        </span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <div className="px-2 pt-1 pb-2 text-xs font-semibold text-zinc-500">Apariencia</div>
          <div className="grid grid-cols-3 gap-1">
            {themes.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setTheme(t.key);
                  applyTheme(t.key);
                }}
                className={`flex flex-col items-center gap-1 rounded-xl py-2 text-xs ${
                  theme === t.key
                    ? "bg-brand-50 font-semibold text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
                aria-pressed={theme === t.key}
              >
                <t.icon className="size-4" />
                {t.label}
              </button>
            ))}
          </div>
          <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          >
            <LogOut className="size-4" />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Buscador rápido (Ctrl/⌘ K) ----------

type Hit = { key: string; label: string; hint: string; href: string; icon: LucideIcon };
type ConvHit = {
  id: string;
  contact: { name: string | null; profileName: string | null; phone: string };
  lastMessagePreview: string;
};

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [convs, setConvs] = useState<ConvHit[]>([]);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) {
      setConvs([]);
      return;
    }
    const t = setTimeout(() => {
      api<ConvHit[]>(`/api/conversations?q=${encodeURIComponent(term)}`)
        .then((r) => setConvs(Array.isArray(r) ? r.slice(0, 6) : []))
        .catch(() => setConvs([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  const hits = useMemo<Hit[]>(() => {
    const term = q.trim().toLowerCase();
    const screens = NAV.flatMap((g) => g.items)
      .filter((i) => !i.soon && (!term || i.label.toLowerCase().includes(term)))
      .map((i) => ({
        key: `s:${i.href}:${i.label}`,
        label: i.label,
        hint: "Ir a",
        href: i.href,
        icon: i.icon,
      }));
    const chats = convs.map((c) => ({
      key: `c:${c.id}`,
      label: c.contact.name || c.contact.profileName || c.contact.phone,
      hint: c.lastMessagePreview || "Conversación",
      href: `/panel/inbox?c=${c.id}`,
      icon: MessageCircle,
    }));
    return [...chats, ...screens].slice(0, 12);
  }, [q, convs]);

  useEffect(() => setSel((s) => Math.min(s, Math.max(0, hits.length - 1))), [hits.length]);

  const go = useCallback(
    (h: Hit | undefined) => {
      if (!h) return;
      onClose();
      router.push(h.href);
    },
    [onClose, router],
  );

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Cerrar buscador"
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Buscar"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <Search className="size-4 text-zinc-400" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, hits.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(hits[sel]);
              } else if (e.key === "Escape") onClose();
            }}
            placeholder="Busca una pantalla, un cliente o un teléfono…"
            className="h-12 flex-1 bg-transparent text-base outline-none md:text-sm"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
          />
          <kbd className="rounded-md border border-zinc-200 px-1.5 text-[11px] text-zinc-500 dark:border-zinc-700">
            Esc
          </kbd>
        </div>
        <div id="palette-list" role="listbox" className="max-h-80 overflow-y-auto p-2">
          {hits.map((h, i) => (
            <button
              key={h.key}
              type="button"
              role="option"
              aria-selected={i === sel}
              onMouseEnter={() => setSel(i)}
              onClick={() => go(h)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm ${
                i === sel ? "bg-brand-50 dark:bg-brand-950" : ""
              }`}
            >
              <h.icon className="size-4 shrink-0 text-zinc-400" />
              <span className="truncate font-medium">{h.label}</span>
              <span className="ml-auto truncate text-xs text-zinc-500">{h.hint}</span>
            </button>
          ))}
          {!hits.length && (
            <p className="px-3 py-6 text-center text-sm text-zinc-500">Sin resultados</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Marco completo ----------

export function AppShell({
  user,
  storeName,
  storeSwitcher,
  onSignOut,
  children,
  fullBleed,
  wide,
}: {
  user: { name?: string | null; email: string };
  storeName: string;
  /** Selector de tienda si el usuario tiene varias. */
  storeSwitcher?: React.ReactNode;
  onSignOut: () => void;
  children: React.ReactNode;
  /** Sin márgenes (bandeja de conversaciones). */
  fullBleed?: boolean;
  /** Ancho completo (tableros como Leads y Pedidos). */
  wide?: boolean;
}) {
  const pathname = usePathname();
  const unread = useUnread();
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);

  // El cajón se cierra al navegar o con Escape; Ctrl/⌘ K abre el buscador.
  useEffect(() => {
    void pathname;
    setDrawer(false);
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyK") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-4 pb-3">
        <Link href="/panel" className="inline-flex">
          <Logo className="text-lg" />
        </Link>
      </div>
      <div className="px-3 pb-3">
        {storeSwitcher ?? (
          <div className="truncate rounded-xl bg-zinc-100 px-3 py-2 text-sm font-medium dark:bg-zinc-800">
            {storeName}
          </div>
        )}
      </div>
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="flex w-full items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:text-zinc-300"
        >
          <Search className="size-4" />
          Buscar…
          <kbd className="ml-auto rounded-md border border-zinc-200 px-1.5 text-[11px] dark:border-zinc-700">
            Ctrl K
          </kbd>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <NavLinks unread={unread} onNavigate={() => setDrawer(false)} />
      </div>
      <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
        <UserMenu user={user} onSignOut={onSignOut} />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Celular: barra superior + cajón. */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-zinc-200 bg-white/90 px-3 backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-900/90">
        <button
          type="button"
          className="btn-quiet btn-icon"
          onClick={() => setDrawer(true)}
          aria-label="Abrir menú"
        >
          <Menu />
        </button>
        <Logo className="text-base" />
        <span className="ml-1 truncate text-sm text-zinc-500">{storeName}</span>
        <button
          type="button"
          className="btn-quiet btn-icon ml-auto"
          onClick={() => setPalette(true)}
          aria-label="Buscar"
        >
          <Search />
        </button>
        <Link
          href="/panel/inbox"
          className="btn-quiet btn-icon relative"
          aria-label="Conversaciones"
        >
          <MessageCircle />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-brand-ink">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
      </header>
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-zinc-950/40"
            aria-label="Cerrar menú"
            onClick={() => setDrawer(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[17rem] bg-white shadow-2xl dark:bg-zinc-900">
            <button
              type="button"
              className="btn-quiet btn-icon absolute top-3 right-2"
              onClick={() => setDrawer(false)}
              aria-label="Cerrar menú"
            >
              <X />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      {/* Computadora: menú lateral fijo. */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-zinc-200 bg-white md:block dark:border-zinc-800 dark:bg-zinc-900">
        {sidebar}
      </aside>

      {fullBleed ? (
        <main className="min-w-0 flex-1">{children}</main>
      ) : (
        <main className="min-w-0 flex-1 p-4 md:p-8">
          <div className={wide ? "mx-auto max-w-[110rem]" : "mx-auto max-w-5xl"}>{children}</div>
        </main>
      )}
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
