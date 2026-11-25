import type { Metadata } from "next";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Selichat",
  description: "CRM de ventas por WhatsApp con IA",
};

/**
 * Tema antes de pintar (sin parpadeo): «claro», «oscuro» o «sistema» (por defecto), guardado
 * en este navegador.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("tema")||"sistema";var d=t==="oscuro"||(t==="sistema"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}})();`;

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
