import type { Metadata } from "next";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Selichat",
  description: "CRM de ventas por WhatsApp con IA",
};

/**
 * Antes de pintar (sin parpadeo): el tema («claro», «oscuro» o «sistema», por defecto) y los
 * colores de la marca de la tienda guardados en este navegador.
 */
const THEME_SCRIPT = `(function(){try{var r=document.documentElement;var t=localStorage.getItem("tema")||"sistema";var d=t==="oscuro"||(t==="sistema"&&matchMedia("(prefers-color-scheme: dark)").matches);r.dataset.theme=d?"dark":"light";var m=JSON.parse(localStorage.getItem("marca")||"null");if(m&&m.vars){for(var k in m.vars){if(/^--brand-[a-z0-9]+$/.test(k)&&/^#[0-9a-f]{6}$/i.test(m.vars[k]))r.style.setProperty(k,m.vars[k])}}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: script fijo del tema, sin datos del usuario */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
