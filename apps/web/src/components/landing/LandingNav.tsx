"use client";
/** Barra de la página pública: secciones, «Ingresar» y «Crear cuenta» (o «Ir al panel» con sesión). */
import { Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/lib/auth-client";

const LINKS = [
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#funciones", label: "Funciones" },
  { href: "#dropi", label: "Dropi" },
  { href: "#preguntas", label: "Preguntas" },
];

export function LandingNav() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#111827]/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight text-white">
          <Image src="/logo-selichat-128.png" alt="" width={36} height={36} className="size-9" />
          <span className="text-lg">Selichat</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-zinc-300 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="hover:text-white">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          {session ? (
            <Link href="/panel" className="btn">
              Ir al panel
            </Link>
          ) : (
            <>
              <Link
                href="/entrar"
                className="rounded-full px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/5 hover:text-white"
              >
                Ingresar
              </Link>
              <Link href="/registro" className="btn">
                Crear cuenta gratis
              </Link>
            </>
          )}
        </div>
        <button
          type="button"
          className="ml-auto grid size-10 place-items-center rounded-xl text-zinc-200 hover:bg-white/5 md:hidden"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && (
        <div className="space-y-1 border-t border-white/5 px-5 py-4 md:hidden">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-zinc-200 hover:bg-white/5"
            >
              {l.label}
            </a>
          ))}
          <div className="grid grid-cols-2 gap-2 pt-3">
            {session ? (
              <Link href="/panel" className="btn col-span-2">
                Ir al panel
              </Link>
            ) : (
              <>
                <Link href="/entrar" className="btn-secondary">
                  Ingresar
                </Link>
                <Link href="/registro" className="btn">
                  Crear cuenta
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
