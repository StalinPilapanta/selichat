"use client";
/**
 * Aviso de escritorio cuando entra un pedido, aunque la pestaña esté de fondo.
 * El panel consulta el último pedido cada 30 s; el permiso se pide una vez por equipo.
 */
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

export type NoticeState = "activo" | "pedir" | "bloqueado" | "no_soportado";

/** Estado de los avisos de escritorio en este navegador, y cómo activarlos. */
export function useBrowserNotices() {
  const [state, setState] = useState<NoticeState>("no_soportado");
  useEffect(() => {
    if (!supported()) return;
    const read = () => {
      const p = Notification.permission;
      setState(p === "granted" ? "activo" : p === "denied" ? "bloqueado" : "pedir");
    };
    read();
    // Si se cambia el permiso desde el candado del navegador, se ve al volver a la pestaña.
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, []);
  const enable = async () => {
    if (!supported()) return;
    const p = await Notification.requestPermission();
    setState(p === "granted" ? "activo" : p === "denied" ? "bloqueado" : "pedir");
    if (p === "granted")
      new Notification("Avisos activados", {
        body: "Te avisaremos aquí cada vez que entre un pedido.",
      });
  };
  return { state, enable };
}
