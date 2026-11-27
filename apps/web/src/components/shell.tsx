"use client";
import { DEFAULT_BRAND_NAME } from "@chatea/shared";
/**
 * Marco del panel: menú lateral con íconos (agrupado, contraíble), barra superior con buscador,
 * alertas y perfil; en el celular barra y cajón.
 */
import {
  AlertTriangle,
  Bell,
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
  PanelLeftClose,
  PanelLeftOpen,
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
import { useBranding } from "@/lib/branding";
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

// ---------- Contadores, alertas y estado de conexiones ----------

type Conn = { state: "ok" | "error" | "off"; detail?: string };
type NavData = {
  unread: number;
  attention: { novedad: number; agencyOverdue: number; uploadErrors: number; revision: number };
  status: { whatsapp: Conn; dropi: Conn; ai: Conn };
};

/** Una sola consulta liviana cada 30 s para todo el marco (no llama a Meta ni a Dropi). */
function useNav() {
  const [data, setData] = useState<NavData | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<NavData>("/api/nav")
        .then((r) => {
          if (alive) setData(r);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return data;
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

function NavLinks({
  unread,
  compact,
  onNavigate,
}: {
  unread: number;
  /** Solo íconos (menú contraído). */
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <nav className={compact ? "space-y-3" : "space-y-5"}>
      {NAV.map((g) => {
        const anyActive = g.items.some((i) => !i.soon && isActive(pathname, i.href));
        // Contraído: de las integraciones solo «Todas» (el resto está en su página).
        const items = compact && g.collapsible ? g.items.slice(0, 1) : g.items;
        const expanded = compact || !g.collapsible || open[g.title] || anyActive;
        return (
          <div key={g.title}>
            {compact ? (
              <div className="mx-auto mb-1 h-px w-6 bg-zinc-200 dark:bg-zinc-800" />
            ) : g.collapsible ? (
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
                {items.map((item) => {
                  const Icon = item.icon;
                  if (item.soon && compact) return null;
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
                        title={compact ? item.label : undefined}
                        aria-label={compact ? item.label : undefined}
                        className={`relative flex items-center gap-3 rounded-xl py-2 text-sm transition-colors ${
                          compact ? "justify-center px-0" : "px-3"
                        } ${
                          active
                            ? "bg-brand-50 font-semibold text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <Icon
                          className={`size-4.5 shrink-0 ${active ? "text-brand-600 dark:text-brand-400" : "text-zinc-400"}`}
                        />
                        {compact ? (
                          item.unread &&
                          unread > 0 && (
                            <span className="absolute top-1 right-2 size-2 rounded-full bg-brand-600" />
                          )
                        ) : (
                          <>
                            <span className="truncate">{item.label}</span>
                            {item.unread && <Badge n={unread} />}
                          </>
                        )}
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
  topbar,
}: {
  user: { name?: string | null; email: string };
  onSignOut: () => void;
  /** En la barra superior: botón compacto (como Whapicommerce) y el menú se abre hacia abajo. */
  topbar?: boolean;
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
        className={
          topbar
            ? "flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            : "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
        }
        aria-expanded={open}
        aria-label="Mi perfil"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-800 dark:bg-brand-900 dark:text-brand-100">
          {initials(user.name || user.email)}
        </span>
        {topbar ? (
          <>
            <span className="max-w-40 truncate text-sm font-medium">
              {user.name?.split(" ")[0] || "Mi cuenta"}
            </span>
            <ChevronDown className="size-4 text-zinc-400" />
          </>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.name || "Mi cuenta"}</span>
            <span className="block truncate text-xs text-zinc-500">{user.email}</span>
          </span>
        )}
      </button>
      {open && (
        <div
          className={`absolute z-50 w-64 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 ${
            topbar ? "top-full right-0 mt-2" : "bottom-full left-0 mb-2"
          }`}
        >
          {topbar && (
            <div className="border-b border-zinc-200 px-2 pt-1 pb-2 dark:border-zinc-800">
              <div className="truncate text-sm font-medium">{user.name || "Mi cuenta"}</div>
              <div className="truncate text-xs text-zinc-500">{user.email}</div>
            </div>
          )}
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

// ---------- Buscador (en la barra, sin ventana flotante) ----------

type Hit = { key: string; label: string; hint: string; href: string; icon: LucideIcon };
type ConvHit = {
  id: string;
  contact: { name: string | null; profileName: string | null; phone: string };
  lastMessagePreview: string;
};

/**
 * Buscador de pantallas y conversaciones dentro de la barra: al escribir, los resultados se
 * despliegan justo debajo del campo. Ctrl/⌘ K lo enfoca.
 */
function InlineSearch({ autoFocusKey }: { autoFocusKey?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [convs, setConvs] = useState<ConvHit[]>([]);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocusKey) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyK") {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [autoFocusKey]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setConvs([]);
      return;
    }
    const t = setTimeout(() => {
      api<ConvHit[]>(`/api/conversations?q=${encodeURIComponent(term)}`)
        .then((r) => setConvs(Array.isArray(r) ? r.slice(0, 6) : []))
        .catch(() => setConvs([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const hits = useMemo<Hit[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const screens = NAV.flatMap((g) => g.items)
      .filter((i) => !i.soon && i.label.toLowerCase().includes(term))
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
    return [...chats, ...screens].slice(0, 10);
  }, [q, convs]);

  useEffect(() => setSel((v) => Math.min(v, Math.max(0, hits.length - 1))), [hits.length]);

  const go = useCallback(
    (h: Hit | undefined) => {
      if (!h) return;
      setOpen(false);
      setQ("");
      input.current?.blur();
      router.push(h.href);
    },
    [router],
  );

  const showList = open && q.trim().length > 0;
  return (
    <div ref={box} className="relative w-full">
      <div className="flex h-9 items-center gap-2 rounded-xl border border-zinc-200 px-3 focus-within:border-brand-500 dark:border-zinc-800">
        <Search className="size-4 shrink-0 text-zinc-400" />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((v) => Math.min(v + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((v) => Math.max(v - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(hits[sel]);
            } else if (e.key === "Escape") {
              setOpen(false);
              input.current?.blur();
            }
          }}
          placeholder="Buscar cliente, teléfono o pantalla…"
          aria-label="Buscar"
          role="combobox"
          aria-expanded={showList}
          aria-controls="search-results"
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        {autoFocusKey && !q && (
          <kbd className="hidden whitespace-nowrap rounded-md border border-zinc-200 px-1.5 text-[11px] text-zinc-500 lg:inline dark:border-zinc-700">
            Ctrl K
          </kbd>
        )}
      </div>
      {showList && (
        <div
          id="search-results"
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
        >
          {hits.map((h, i) => (
            <button
              key={h.key}
              type="button"
              role="option"
              aria-selected={i === sel}
              onMouseEnter={() => setSel(i)}
              onClick={() => go(h)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                i === sel ? "bg-brand-50 dark:bg-brand-950" : ""
              }`}
            >
              <h.icon className="size-4 shrink-0 text-zinc-400" />
              <span className="truncate font-medium">{h.label}</span>
              <span className="ml-auto truncate text-xs text-zinc-500">{h.hint}</span>
            </button>
          ))}
          {!hits.length && <p className="px-3 py-3 text-sm text-zinc-500">Sin resultados</p>}
        </div>
      )}
    </div>
  );
}

// ---------- Alertas ----------

const CONNECTIONS: {
  key: keyof NavData["status"];
  label: string;
  /** Aviso cuando todavía no se conectó. */
  off: string;
  href: string;
}[] = [
  {
    key: "whatsapp",
    label: "WhatsApp",
    off: "WhatsApp no está conectado",
    href: "/panel/integraciones/whatsapp",
  },
  {
    key: "dropi",
    label: "Dropi",
    off: "Dropi no está conectado",
    href: "/panel/integraciones/dropi",
  },
  {
    key: "ai",
    label: "La IA",
    off: "No hay un modelo de IA conectado",
    href: "/panel/integraciones/ia",
  },
];

type Alert = { key: string; text: string; href: string; danger: boolean; icon: LucideIcon };

/** Pedidos que requieren atención y conexiones caídas o sin conectar. */
function alertsOf(nav: NavData | null): Alert[] {
  if (!nav) return [];
  const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const a = nav.attention;
  const out: Alert[] = [];
  for (const c of CONNECTIONS) {
    const st = nav.status[c.key];
    if (st.state === "error")
      out.push({
        key: `c:${c.key}`,
        text: `${c.label} se desconectó${st.detail ? `: ${st.detail}` : ""}`,
        href: c.href,
        danger: true,
        icon: Plug,
      });
    else if (st.state === "off")
      out.push({
        key: `c:${c.key}`,
        text: c.off,
        href: c.href,
        danger: false,
        icon: Plug,
      });
  }
  if (nav.unread)
    out.push({
      key: "unread",
      text: pl(nav.unread, "conversación sin leer", "conversaciones sin leer"),
      href: "/panel/inbox",
      danger: false,
      icon: MessageCircle,
    });
  const orderRows: [number, string, string, string][] = [
    [a.novedad, "pedido con novedad", "pedidos con novedad", "novedad"],
    [a.agencyOverdue, "pedido en agencia 2+ días", "pedidos en agencia 2+ días", "en_oficina"],
    [a.uploadErrors, "pedido con error al subir", "pedidos con error al subir", "error_subida"],
    [a.revision, "pedido por revisar (riesgo)", "pedidos por revisar (riesgo)", "revision"],
  ];
  for (const [n, one, many, etapa] of orderRows)
    if (n)
      out.push({
        key: `o:${etapa}`,
        text: pl(n, one, many),
        href: `/panel/pedidos?etapa=${etapa}`,
        danger: etapa !== "revision",
        icon: AlertTriangle,
      });
  return out;
}

/** Campana: todas las alertas, con enlace a cada cosa. */
function BellMenu({ nav }: { nav: NavData | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    void pathname;
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const alerts = alertsOf(nav);
  const urgent = alerts.some((x) => x.danger);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="btn-quiet btn-icon relative"
        aria-label={`Alertas${alerts.length ? ` (${alerts.length})` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell />
        {alerts.length > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold ${
              urgent ? "bg-red-600 text-white" : "bg-amber-500 text-white"
            }`}
          >
            {alerts.length > 9 ? "9+" : alerts.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-80 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <div className="px-2 pt-1 pb-2 text-xs font-semibold text-zinc-500">Alertas</div>
          {alerts.length === 0 ? (
            <p className="px-2 pb-2 text-sm text-zinc-500">Todo en orden por ahora.</p>
          ) : (
            <ul>
              {alerts.map((x) => (
                <li key={x.key}>
                  <Link
                    href={x.href}
                    className="flex items-start gap-3 rounded-xl px-2 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <x.icon
                      className={`mt-0.5 size-4 shrink-0 ${x.danger ? "text-red-500" : "text-amber-500"}`}
                    />
                    <span>{x.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Franja roja bajo la barra cuando una conexión se cae (no solo cuando falta conectarla). */
function ConnectionBanner({ nav }: { nav: NavData | null }) {
  if (!nav) return null;
  const down = CONNECTIONS.filter((c) => nav.status[c.key].state === "error");
  if (!down.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      <AlertTriangle className="size-4 shrink-0" />
      {down.map((c) => (
        <Link key={c.key} href={c.href} className="underline-offset-2 hover:underline">
          {c.label} se desconectó{nav.status[c.key].detail ? `: ${nav.status[c.key].detail}` : ""} —
          revisar
        </Link>
      ))}
    </div>
  );
}

// ---------- Marco completo ----------

const COMPACT_KEY = "selichat:menuCompacto";

export function AppShell({
  user,
  storeName,
  storeSwitcher,
  onSignOut,
  children,
  fullBleed,
}: {
  user: { name?: string | null; email: string };
  storeName: string;
  /** Selector de tienda si el usuario tiene varias. */
  storeSwitcher?: React.ReactNode;
  onSignOut: () => void;
  children: React.ReactNode;
  /** Sin márgenes (bandeja de conversaciones). */
  fullBleed?: boolean;
  /** Antes limitaba el ancho; ahora todas las pantallas usan el ancho completo. */
  wide?: boolean;
}) {
  const pathname = usePathname();
  const nav = useNav();
  const unread = nav?.unread ?? 0;
  const brand = useBranding();
  const [drawer, setDrawer] = useState(false);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    try {
      setCompact(localStorage.getItem(COMPACT_KEY) === "1");
    } catch {}
  }, []);
  const toggleCompact = () =>
    setCompact((c) => {
      try {
        localStorage.setItem(COMPACT_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });

  // El cajón se cierra al navegar o con Escape.
  useEffect(() => {
    void pathname;
    setDrawer(false);
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Nombre de la tienda: el de su personalización (Configuración → Marca) o el de la tienda. */
  const shopName = brand.name && brand.name !== DEFAULT_BRAND_NAME ? brand.name : storeName;
  const shopChip = (
    <div className="flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-sm font-medium dark:bg-zinc-800">
      {brand.logoUrl && (
        // biome-ignore lint/performance/noImgElement: logo subido por la tienda (dominio propio)
        <img src={brand.logoUrl} alt="" className="size-5 shrink-0 rounded-md object-contain" />
      )}
      <span className="truncate">{shopName}</span>
    </div>
  );

  const sidebar = (mode: "desktop" | "drawer") => {
    const small = mode === "desktop" && compact;
    return (
      <div className="flex h-full flex-col">
        {/* Arriba siempre Selichat; debajo, la tienda con su nombre y logo personalizados. */}
        <div className={`pt-4 pb-3 ${small ? "flex justify-center px-2" : "px-3"}`}>
          <Link href="/panel" className="inline-flex max-w-full" title={DEFAULT_BRAND_NAME}>
            {small ? <Logo name="" /> : <Logo className="text-lg" name={DEFAULT_BRAND_NAME} />}
          </Link>
        </div>
        {!small && (
          <div className="space-y-2 px-3 pb-3">
            {shopChip}
            {storeSwitcher}
          </div>
        )}
        {mode === "drawer" && (
          <div className="px-3 pb-3">
            <InlineSearch />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <NavLinks unread={unread} compact={small} onNavigate={() => setDrawer(false)} />
        </div>
        {/* En computadora el perfil va en la barra superior; en el cajón del celular, aquí. */}
        {mode === "drawer" && (
          <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
            <UserMenu user={user} onSignOut={onSignOut} />
          </div>
        )}
      </div>
    );
  };

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
        <Logo className="text-base" name={DEFAULT_BRAND_NAME} />
        <span className="ml-1 truncate text-sm text-zinc-500">{shopName}</span>
        <div className="ml-auto flex items-center">
          <BellMenu nav={nav} />
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
        </div>
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
            {sidebar("drawer")}
          </aside>
        </div>
      )}

      {/* Computadora: menú lateral fijo (contraíble a solo íconos). */}
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 border-r border-zinc-200 bg-white transition-[width] md:block dark:border-zinc-800 dark:bg-zinc-900 ${
          compact ? "w-[4.5rem]" : "w-64"
        }`}
      >
        {sidebar("desktop")}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Computadora: barra superior con contraer, buscador, alertas y perfil. */}
        <header className="sticky top-0 z-30 hidden h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur md:flex dark:border-zinc-800 dark:bg-zinc-900/90">
          <button
            type="button"
            className="btn-quiet btn-icon"
            onClick={toggleCompact}
            aria-label={compact ? "Expandir menú" : "Contraer menú"}
            title={compact ? "Expandir menú" : "Contraer menú"}
          >
            {compact ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
          <div className="w-full max-w-xl">
            <InlineSearch autoFocusKey />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <BellMenu nav={nav} />
            <UserMenu user={user} onSignOut={onSignOut} topbar />
          </div>
        </header>
        <ConnectionBanner nav={nav} />

        {fullBleed ? (
          <main className="min-w-0 flex-1">{children}</main>
        ) : (
          <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
        )}
      </div>
    </div>
  );
}
