"use client";
import { ORDER_STAGES, type OrderStage } from "@chatea/shared";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Package,
  Plus,
  ShoppingBag,
  TrendingUp,
  Truck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useActiveOrganization, useSession } from "@/lib/auth-client";

type Dashboard = {
  currency: string;
  today: { orders: number; amount: number };
  last30: {
    orders: number;
    amount: number;
    delivered: number;
    deliveredAmount: number;
    returned: number;
    deliveryRate: number | null;
  };
  stages: Record<OrderStage, { count: number; amount: number }>;
  attention: {
    novedad: number;
    agencyOverdue: number;
    revision: number;
    uploadErrors: number;
    toUpload: number;
  };
  leads: { open: number };
  recent: {
    id: string;
    stage: OrderStage;
    customer: { nombre?: string; apellido?: string; ciudad?: string };
    items: { name: string; quantity: number }[];
    total: string;
    currency: string;
    source: string;
    createdAt: string;
  }[];
  setup: Record<"team" | "ai" | "settings" | "products" | "whatsapp" | "dropi", boolean>;
};

const STEPS: { key: keyof Dashboard["setup"]; title: string; desc: string; href: string }[] = [
  {
    key: "whatsapp",
    title: "Conecta WhatsApp",
    desc: "Tu número de WhatsApp Business; los mensajes llegan a Conversaciones.",
    href: "/panel/integraciones/whatsapp",
  },
  {
    key: "ai",
    title: "Conecta un modelo de IA",
    desc: "Claude, OpenAI, Grok, Gemini u OpenRouter para que la IA venda por ti.",
    href: "/panel/integraciones/ia",
  },
  {
    key: "products",
    title: "Carga tus productos",
    desc: "A mano, con IA desde la ficha o importados desde Chatea Pro.",
    href: "/panel/catalogo",
  },
  {
    key: "dropi",
    title: "Conecta Dropi",
    desc: "Los pedidos confirmados se suben solos y su estado vuelve aquí.",
    href: "/panel/integraciones/dropi",
  },
  {
    key: "settings",
    title: "Define país, moneda y horario",
    desc: "Horario en el que la IA puede escribir a tus clientes.",
    href: "/panel/configuracion",
  },
  {
    key: "team",
    title: "Invita a tu equipo",
    desc: "Asesores y logística con su propio rol.",
    href: "/panel/equipo",
  },
];

/** Tramos del envío: cada uno abre Pedidos filtrado por sus etapas. */
const TRAMOS: { title: string; stages: OrderStage[]; tone?: string }[] = [
  { title: "Por subir", stages: ["pendiente_subida", "error_subida", "revision"] },
  { title: "Por confirmar", stages: ["por_confirmar"] },
  { title: "Confirmado", stages: ["confirmado", "guia_generada"] },
  { title: "En camino", stages: ["en_transito"] },
  { title: "En agencia", stages: ["en_oficina"] },
  { title: "Con novedad", stages: ["novedad"], tone: "text-amber-600 dark:text-amber-400" },
];

const ordersLink = (stages: OrderStage[]) => `/panel/pedidos?etapa=${stages.join(",")}`;

function formatMoney(currency: string) {
  return (n: number) => {
    try {
      return new Intl.NumberFormat("es-EC", { style: "currency", currency }).format(n);
    } catch {
      return `${n.toFixed(2)} ${currency}`;
    }
  };
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  href,
}: {
  icon: typeof Package;
  label: string;
  value: string;
  hint: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <span className="grid size-8 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
          <Icon className="size-4" />
        </span>
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{hint}</div>
    </>
  );
  return href ? (
    <Link href={href} className="card hover:border-brand-500">
      {body}
    </Link>
  ) : (
    <div className="card">{body}</div>
  );
}

function Setup({ setup }: { setup: Dashboard["setup"] }) {
  const done = STEPS.filter((s) => setup[s.key]).length;
  if (done === STEPS.length) return null;
  return (
    <section className="card p-0">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <h2 className="font-medium">Primeros pasos</h2>
          <p className="text-sm text-zinc-500">
            {done} de {STEPS.length} listos
          </p>
        </div>
        <div className="h-2 w-32 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full bg-brand-600"
            style={{ width: `${(done / STEPS.length) * 100}%` }}
          />
        </div>
      </div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {STEPS.map((s) => {
          const ok = setup[s.key];
          return (
            <li key={s.key}>
              <Link
                href={s.href}
                className="flex items-center gap-3 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                {ok ? (
                  <CheckCircle2 className="size-5 shrink-0 text-brand-600" />
                ) : (
                  <Circle className="size-5 shrink-0 text-zinc-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className={`font-medium ${ok ? "text-zinc-400 line-through" : ""}`}>
                    {s.title}
                  </div>
                  <div className="text-sm text-zinc-500">{s.desc}</div>
                </div>
                {!ok && <ChevronRight className="size-4 shrink-0 text-zinc-400" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Attention({ a }: { a: Dashboard["attention"] }) {
  const rows: { n: number; text: string; href: string; danger?: boolean }[] = [
    {
      n: a.novedad,
      text: "con novedad: responde al cliente para no perder la venta",
      href: ordersLink(["novedad"]),
      danger: true,
    },
    {
      n: a.agencyOverdue,
      text: "en agencia hace 2 días o más sin retirar: llama al cliente",
      href: ordersLink(["en_oficina"]),
      danger: true,
    },
    {
      n: a.uploadErrors,
      text: "con error al subir a Dropi: revisa los datos y reintenta",
      href: ordersLink(["error_subida"]),
      danger: true,
    },
    {
      n: a.revision,
      text: "por revisar por riesgo del comprador",
      href: ordersLink(["revision"]),
    },
    {
      n: a.toUpload,
      text: "sin subir a Dropi",
      href: ordersLink(["pendiente_subida"]),
    },
  ].filter((r) => r.n > 0);

  return (
    <section className="card">
      <h2 className="mb-3 flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 text-amber-500" /> Requiere atención
      </h2>
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <CheckCircle2 className="size-4 text-brand-600" /> Todo en orden por ahora.
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.href}>
              <Link
                href={r.href}
                className="flex items-center gap-3 rounded-lg p-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span
                  className={`grid h-7 min-w-7 place-items-center rounded-full px-2 text-xs font-semibold ${
                    r.danger
                      ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                  }`}
                >
                  {r.n}
                </span>
                <span className="flex-1">
                  {r.n === 1 ? "Pedido" : "Pedidos"} {r.text}
                </span>
                <ChevronRight className="size-4 text-zinc-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Page() {
  const { data: session } = useSession();
  const { data: org } = useActiveOrganization();
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Dashboard>("/api/dashboard")
        .then((x) => {
          if (alive) setD(x);
        })
        .catch((e) => {
          if (alive) setError(errorMessage(e));
        });
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const money = formatMoney(d?.currency ?? "USD");
  const firstName = session?.user.name?.split(" ")[0] ?? "";

  return (
    <>
      <PageHeader
        title={`Hola${firstName ? `, ${firstName}` : ""}`}
        description={`Así va ${org?.name ?? "tu tienda"} hoy.`}
        actions={
          <Link href="/panel/pedidos?nuevo=1" className="btn">
            <Plus className="size-4" /> Nuevo pedido
          </Link>
        }
      />
      <ErrorText>{error}</ErrorText>
      {!d ? (
        !error && <p className="text-sm text-zinc-500">Cargando…</p>
      ) : (
        <div className="space-y-4">
          <Setup setup={d.setup} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              icon={ShoppingBag}
              label="Pedidos de hoy"
              value={String(d.today.orders)}
              hint={money(d.today.amount)}
              href="/panel/pedidos"
            />
            <Kpi
              icon={TrendingUp}
              label="Vendido en 30 días"
              value={money(d.last30.amount)}
              hint={`${d.last30.orders} pedido${d.last30.orders === 1 ? "" : "s"} sin cancelar`}
            />
            <Kpi
              icon={Package}
              label="Entregado en 30 días"
              value={money(d.last30.deliveredAmount)}
              hint={
                d.last30.deliveryRate === null
                  ? `${d.last30.delivered} entregados`
                  : `${d.last30.delivered} entregados · ${Math.round(d.last30.deliveryRate * 100)}% de entrega`
              }
              href={ordersLink(["entregado"])}
            />
            <Kpi
              icon={Users}
              label="Leads abiertos"
              value={String(d.leads.open)}
              hint="Interesados y con datos"
              href="/panel/leads"
            />
          </div>

          <section className="card">
            <h2 className="mb-1 flex items-center gap-2 font-medium">
              <Truck className="size-4 text-brand-600" /> Envíos en curso
            </h2>
            <p className="mb-3 text-sm text-zinc-500">Toca un tramo para ver esos pedidos.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {TRAMOS.map((t) => {
                const count = t.stages.reduce((s, k) => s + d.stages[k].count, 0);
                const amount = t.stages.reduce((s, k) => s + d.stages[k].amount, 0);
                return (
                  <Link
                    key={t.title}
                    href={ordersLink(t.stages)}
                    className="rounded-xl border border-zinc-200 p-3 hover:border-brand-500 dark:border-zinc-800"
                  >
                    <div className={`text-2xl font-semibold ${count ? (t.tone ?? "") : ""}`}>
                      {count}
                    </div>
                    <div className="text-sm">{t.title}</div>
                    <div className="text-xs text-zinc-500">{money(amount)}</div>
                  </Link>
                );
              })}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Attention a={d.attention} />
            <section className="card">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-medium">Pedidos recientes</h2>
                <Link
                  href="/panel/pedidos"
                  className="text-sm text-brand-700 hover:underline dark:text-brand-400"
                >
                  Ver todos
                </Link>
              </div>
              {d.recent.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Todavía no hay pedidos. Llegan cuando un cliente confirma con la IA, o créalo tú
                  con «Nuevo pedido».
                </p>
              ) : (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {d.recent.map((o) => (
                    <li key={o.id}>
                      <Link
                        href={`/panel/pedidos?pedido=${o.id}`}
                        className="flex items-center gap-3 py-2 text-sm hover:opacity-80"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">
                            {[o.customer.nombre, o.customer.apellido].filter(Boolean).join(" ") ||
                              "Sin nombre"}
                          </div>
                          <div className="truncate text-xs text-zinc-500">
                            {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                            {o.customer.ciudad ? ` · ${o.customer.ciudad}` : ""}
                            {o.source === "ia" ? " · IA" : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div>{money(Number(o.total))}</div>
                          <div className="text-xs text-zinc-500">{ORDER_STAGES[o.stage]}</div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
