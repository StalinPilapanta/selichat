import Link from "next/link";

/** Contacto legal configurable (LEGAL_EMAIL en el servidor web). */
export function legalContact() {
  return process.env.LEGAL_EMAIL?.trim() || null;
}

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-xl font-bold text-brand-600">
        selichat
      </Link>
      <h1 className="mt-6 text-3xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-zinc-500">Última actualización: {updated}</p>
      <div className="prose-legal mt-8 space-y-5 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
        {children}
      </div>
      <footer className="mt-12 flex gap-4 border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800">
        <Link href="/privacidad" className="hover:underline">
          Política de privacidad
        </Link>
        <Link href="/eliminacion-de-datos" className="hover:underline">
          Eliminación de datos
        </Link>
      </footer>
    </main>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="pt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{children}</h2>
  );
}
