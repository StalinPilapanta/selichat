/**
 * Página pública de Selichat: qué hace, cómo funciona y con qué se conecta. Arriba, «Ingresar»
 * y «Crear cuenta». Siempre en modo oscuro y con el verde de Selichat (no el de una tienda).
 */
import { brandCssVars } from "@chatea/shared";
import {
  BellRing,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  KanbanSquare,
  MapPin,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LandingNav } from "@/components/landing/LandingNav";

export const metadata: Metadata = {
  title: "Selichat — Vende por WhatsApp con IA y despacha con Dropi",
  description:
    "La IA de Selichat atiende a tus clientes por WhatsApp, cierra la venta y sube el pedido a Dropi. Tú solo revisas.",
  icons: { icon: "/logo-selichat-64.png", apple: "/logo-selichat-256.png" },
};

const CONNECTS = [
  "WhatsApp (API oficial de Meta)",
  "Dropi",
  "Servientrega",
  "Claude",
  "OpenAI",
  "Gemini",
  "Grok",
  "Chatea Pro",
];

const STEPS = [
  {
    n: 1,
    title: "El cliente escribe",
    text: "Desde tu anuncio de clic a WhatsApp o directo. Selichat detecta el producto por el anuncio o una palabra clave.",
  },
  {
    n: 2,
    title: "La IA vende",
    text: "Resuelve dudas con tu guion, ofrece tus ofertas, pide los datos y confirma el pedido.",
  },
  {
    n: 3,
    title: "Se sube a Dropi",
    text: "Antes revisa ciudad, stock, huella del comprador y pedidos duplicados para no perder envíos.",
  },
  {
    n: 4,
    title: "Tu cliente sabe dónde va",
    text: "Le avisamos por WhatsApp: guía generada, en camino, llegó a la agencia y entregado.",
  },
];

const FEATURES = [
  {
    icon: Bot,
    title: "Una IA que cierra ventas",
    text: "Aprende tu catálogo, tus precios y tus reglas. Si un asesor entra al chat, la IA se aparta.",
  },
  {
    icon: MapPin,
    title: "Agencias Servientrega",
    text: "Le ofrece al cliente la agencia más cercana a su barrio para retirar y pagar allí.",
  },
  {
    icon: ShieldCheck,
    title: "Controles antes de subir",
    text: "Ciudad válida, stock, precio sobre el costo, huella del comprador y duplicados.",
  },
  {
    icon: BellRing,
    title: "Avisos y recordatorios",
    text: "Avisa la llegada a la agencia y recuerda cada mañana hasta que retire.",
  },
  {
    icon: KanbanSquare,
    title: "Tablero de pedidos",
    text: "Por subir, por confirmar, en camino, en agencia y entregado, con alertas de lo urgente.",
  },
  {
    icon: Users,
    title: "Bandeja para tu equipo",
    text: "Todos los chats en un sitio, con asignaciones, notas internas y roles.",
  },
];

const FAQ = [
  {
    q: "¿Necesito WhatsApp Business?",
    a: "Sí, conectas tu número con la API oficial de Meta (WhatsApp Cloud API). Te guiamos paso a paso desde Integraciones.",
  },
  {
    q: "¿Funciona con Dropi?",
    a: "Sí. Conectas tu cuenta de Dropi con un clic, importas productos con su ID y los pedidos confirmados se suben solos, con sus estados de vuelta en Selichat.",
  },
  {
    q: "¿Qué inteligencia artificial usa?",
    a: "La que elijas: Claude, OpenAI, Grok o Gemini, con tu propia cuenta. Puedes usar un modelo para vender y otro para las tareas rápidas.",
  },
  {
    q: "¿Y si quiero responder yo?",
    a: "Entras al chat y respondes: la IA se pausa en esa conversación. También puede pasarte el chat cuando el cliente pide hablar con una persona.",
  },
  {
    q: "¿Puedo traer mis productos de Chatea Pro?",
    a: "Sí, desde Catálogo → Importar traes productos, disparadores, multimedia, recordatorios y prompts.",
  },
];

function Shot({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl shadow-black/50 ring-1 ring-brand-500/10">
      <Image src={src} alt={alt} width={1280} height={760} className="h-auto w-full" />
    </div>
  );
}

export default function Home() {
  return (
    <div
      data-theme="dark"
      style={brandCssVars(null) as React.CSSProperties}
      className="min-h-dvh bg-[#111827] text-zinc-100"
    >
      <LandingNav />

      {/* Portada */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 right-0 size-[36rem] rounded-full bg-brand-500/10 blur-3xl" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 md:py-24 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <span className="badge badge-brand">IA para vender por WhatsApp</span>
            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-white md:text-6xl">
              Vende por WhatsApp <span className="text-brand-400">mientras la IA atiende</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-zinc-300">
              Selichat responde a tus clientes, cierra la venta y sube el pedido a Dropi. Tú solo
              revisas lo importante.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/registro" className="btn btn-lg">
                Crear mi cuenta gratis
              </Link>
              <a href="#como-funciona" className="btn-secondary btn-lg">
                Ver cómo funciona
              </a>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-400">
              {["Entras con tu correo o con Google", "Sin programar ni armar flujos"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-brand-400" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <Shot src="/ayuda/img/bandeja.png" alt="Conversación atendida por la IA en Selichat" />
        </div>
      </section>

      {/* Se conecta con */}
      <section className="border-y border-white/5 bg-[#172033]">
        <div className="mx-auto max-w-6xl px-5 py-8">
          <p className="text-center text-xs font-semibold tracking-widest text-zinc-500 uppercase">
            Se conecta con lo que ya usas
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {CONNECTS.map((c) => (
              <span
                key={c}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-zinc-200"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section id="como-funciona" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
        <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
          De un mensaje a un pedido despachado
        </h2>
        <p className="mt-3 max-w-2xl text-zinc-400">
          Cuatro pasos y casi todos automáticos. Tú entras, revisas y confirmas.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-white/10 bg-[#1b2537] p-6">
              <span className="grid size-10 place-items-center rounded-full bg-brand-500 text-lg font-extrabold text-zinc-950">
                {s.n}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-white">{s.title}</h3>
              <p className="mt-2 text-sm text-zinc-400">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Funciones */}
      <section id="funciones" className="scroll-mt-20 border-t border-white/5 bg-[#172033]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            No es un bot de preguntas frecuentes.{" "}
            <span className="text-brand-400">Cierra la venta.</span>
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-white/10 bg-[#1b2537] p-6">
                <span className="grid size-11 place-items-center rounded-xl bg-brand-500/15 text-brand-400">
                  <f.icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm text-zinc-400">{f.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-12">
            <Shot src="/ayuda/img/pedidos.png" alt="Tablero de pedidos de Selichat" />
          </div>
        </div>
      </section>

      {/* Dropi */}
      <section id="dropi" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <span className="badge badge-brand">Para dropshippers</span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-white md:text-4xl">
              Hecho para vender con Dropi
            </h2>
            <ul className="mt-6 space-y-4">
              {[
                {
                  icon: Sparkles,
                  t: "Importa con el ID del producto",
                  d: "Nombre, precio sugerido, foto y variantes; la IA lee las fotos y escribe la descripción.",
                },
                {
                  icon: ClipboardCheck,
                  t: "Pedidos sin copiar nada",
                  d: "El pedido que confirma la IA se sube con los datos del chat; lo revisas antes si quieres.",
                },
                {
                  icon: Truck,
                  t: "Estados de vuelta en tu tablero",
                  d: "Guía, en camino, en agencia, novedad o entregado: todo llega solo.",
                },
                {
                  icon: PackageCheck,
                  t: "Menos devoluciones",
                  d: "Huella del comprador, duplicados y recordatorios de retiro para que el paquete no vuelva.",
                },
              ].map((x) => (
                <li key={x.t} className="flex gap-3">
                  <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-brand-400">
                    <x.icon className="size-4.5" />
                  </span>
                  <div>
                    <div className="font-semibold text-white">{x.t}</div>
                    <div className="text-sm text-zinc-400">{x.d}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <Shot src="/ayuda/img/avisos.png" alt="Avisos automáticos al cliente por WhatsApp" />
        </div>
      </section>

      {/* Preguntas */}
      <section id="preguntas" className="scroll-mt-20 border-t border-white/5 bg-[#172033]">
        <div className="mx-auto max-w-3xl px-5 py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight text-white md:text-4xl">
            Preguntas frecuentes
          </h2>
          <div className="mt-10 space-y-3">
            {FAQ.map((f) => (
              <details
                key={f.q}
                className="group rounded-2xl border border-white/10 bg-[#1b2537] px-5 py-4"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-white">
                  {f.q}
                  <span className="text-brand-400 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm text-zinc-400">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Llamado final */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="rounded-3xl border border-brand-500/30 bg-gradient-to-br from-brand-900/60 to-[#1b2537] px-6 py-14 text-center">
          <Image
            src="/logo-selichat-128.png"
            alt=""
            width={64}
            height={64}
            className="mx-auto size-16"
          />
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-white md:text-4xl">
            Deja que Selichat atienda por ti
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-zinc-300">
            Crea tu cuenta, conecta tu WhatsApp, tu IA y tu Dropi, y empieza a vender.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/registro" className="btn btn-lg">
              Crear mi cuenta gratis
            </Link>
            <Link href="/entrar" className="btn-secondary btn-lg">
              Ingresar
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-zinc-500">
          <span>© {new Date().getFullYear()} Selichat</span>
          <nav className="flex flex-wrap gap-5">
            <Link href="/ayuda/flujo.html" className="hover:text-zinc-300">
              Cómo funciona
            </Link>
            <Link href="/privacidad" className="hover:text-zinc-300">
              Privacidad
            </Link>
            <Link href="/terminos" className="hover:text-zinc-300">
              Términos
            </Link>
            <Link href="/eliminacion-de-datos" className="hover:text-zinc-300">
              Eliminación de datos
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
