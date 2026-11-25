"use client";
/**
 * Marca de la tienda en el navegador: colores (`--brand-*`), ícono de la pestaña y título.
 * Se guarda en este navegador para aplicarla antes de pintar en la próxima carga
 * (lo hace el script del layout raíz), así no parpadea el verde por defecto.
 */
import { brandCssVars, DEFAULT_BRAND_NAME } from "@chatea/shared";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

export type BrandInfo = { name: string; color: string | null; logoUrl: string | null };

const DEFAULT: BrandInfo = { name: DEFAULT_BRAND_NAME, color: null, logoUrl: null };

/** Ícono de la pestaña: el logo, o la inicial sobre el color de la marca. */
function iconFor(b: BrandInfo, vars: Record<string, string>) {
  if (b.logoUrl) return b.logoUrl;
  const letter = (b.name.trim()[0] ?? "S").toUpperCase().replace(/[<>&"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${vars["--brand-600"]}"/><text x="32" y="43" font-family="Arial,sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="${vars["--brand-ink"]}">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function applyBranding(b: BrandInfo) {
  const vars = brandCssVars(b.color);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  const icon = iconFor(b, vars);
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = icon;
  document.title = b.name || DEFAULT_BRAND_NAME;
  try {
    localStorage.setItem("marca", JSON.stringify({ vars, icon, name: b.name }));
  } catch {}
}

type Ctx = BrandInfo & { reload: () => Promise<void>; set: (b: BrandInfo) => void };
const BrandingContext = createContext<Ctx>({ ...DEFAULT, reload: async () => {}, set: () => {} });
export const useBranding = () => useContext(BrandingContext);

type Settings = { brandName: string | null; brandColor: string | null; logoUrl: string | null };

/** Carga la marca de la tienda activa (cambia al cambiar de tienda). */
export function BrandingProvider({
  tenantId,
  children,
}: {
  tenantId: string;
  children: React.ReactNode;
}) {
  const [brand, setBrand] = useState<BrandInfo>(DEFAULT);

  const set = useCallback((b: BrandInfo) => {
    setBrand(b);
    applyBranding(b);
  }, []);

  const reload = useCallback(async () => {
    try {
      const s = await api<Settings | null>("/api/settings");
      set({
        name: s?.brandName?.trim() || DEFAULT_BRAND_NAME,
        color: s?.brandColor ?? null,
        logoUrl: s?.logoUrl ?? null,
      });
    } catch {
      // Sin marca guardada (o sin red): queda la de Selichat.
    }
  }, [set]);

  useEffect(() => {
    void tenantId;
    reload();
  }, [tenantId, reload]);

  return (
    <BrandingContext.Provider value={{ ...brand, reload, set }}>
      {children}
    </BrandingContext.Provider>
  );
}
