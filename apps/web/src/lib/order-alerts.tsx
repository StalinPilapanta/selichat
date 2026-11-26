"use client";
/**
 * Aviso de escritorio cuando entra un pedido, aunque la pestaña esté de fondo.
 * El panel consulta el último pedido cada 30 s; el permiso se pide una vez por equipo.
 */
import { Bell, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Latest = {
  id: string;
  customer: { nombre?: string; apellido?: string };
  total: string;
  currency: string;
  source: string;
};

const seenKey = (tenantId: string) => `selichat:ultimoPedido:${tenantId}`;
const HIDDEN_KEY = "selichat:avisoPedidosOculto";
const supported = () => typeof window !== "undefined" && "Notification" in window;

/** Se monta una vez en el panel; no dibuja nada. */
export function OrderNotifier({ tenantId }: { tenantId: string }) {
  useEffect(() => {
    if (!supported()) return;
    let alive = true;
    const check = async () => {
      if (Notification.permission !== "granted") return;
      try {
        const { order } = await api<{ order: Latest | null }>("/api/orders/latest");
        if (!alive || !order) return;
        const seen = localStorage.getItem(seenKey(tenantId));
        localStorage.setItem(seenKey(tenantId), order.id);
        // La primera vez solo se recuerda: no avisar de un pedido viejo.
        if (!seen || seen === order.id) return;
        const name =
          [order.customer.nombre, order.customer.apellido].filter(Boolean).join(" ") || "Cliente";
        const n = new Notification("Nuevo pedido", {
          body: `${name} · ${Number(order.total).toFixed(2)} ${order.currency}${order.source === "ia" ? " · cerrado por la IA" : ""}`,
          // Con varias pestañas abiertas, el mismo pedido avisa una sola vez.
          tag: order.id,
        });
        n.onclick = () => {
          window.focus();
          window.location.href = `/panel/pedidos?pedido=${order.id}`;
        };
      } catch {
        // Sin conexión o sesión vencida: se reintenta en la próxima vuelta.
      }
    };
    check();
    const t = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tenantId]);
  return null;
}

/** Franja para activar los avisos en este equipo (se oculta si ya están activos). */
export function NotifyBanner() {
  const [state, setState] = useState<"oculto" | "pedir" | "bloqueado">("oculto");
  useEffect(() => {
    if (!supported() || localStorage.getItem(HIDDEN_KEY)) return;
    const p = Notification.permission;
    setState(p === "default" ? "pedir" : p === "denied" ? "bloqueado" : "oculto");
  }, []);
  if (state === "oculto") return null;

  const enable = async () => {
    const p = await Notification.requestPermission();
    setState(p === "granted" ? "oculto" : p === "denied" ? "bloqueado" : "pedir");
    if (p === "granted")
      new Notification("Avisos activados", {
        body: "Te avisaremos aquí cada vez que entre un pedido.",
      });
  };
  const hide = () => {
    localStorage.setItem(HIDDEN_KEY, "1");
    setState("oculto");
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-3 text-sm dark:border-brand-900 dark:bg-brand-950/30">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-600 text-brand-ink">
        <Bell className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">Entérate del pedido en el momento</div>
        <div className="text-zinc-600 dark:text-zinc-400">
          {state === "pedir"
            ? "Te llega un aviso en cuanto entra uno, aunque tengas Selichat de fondo. Se activa en cada equipo."
            : "El navegador bloqueó los avisos. Actívalos en el candado junto a la dirección → Notificaciones → Permitir, y recarga."}
        </div>
      </div>
      {state === "pedir" && (
        <button type="button" className="btn" onClick={enable}>
          Activar avisos
        </button>
      )}
      <button type="button" className="btn-ghost" aria-label="Ocultar este aviso" onClick={hide}>
        <X className="size-4" />
      </button>
    </div>
  );
}
