"use client";
import Link from "next/link";
import { useState } from "react";
import { AuthShell, ErrorText } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export default function Page() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await authClient.requestPasswordReset({ email, redirectTo: "/restablecer-clave" });
    setLoading(false);
    if (res.error) return setError(res.error.message ?? "No se pudo enviar el correo");
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell
        title="Revisa tu correo"
        subtitle={`Si ${email} tiene una cuenta, te enviamos un enlace para poner una contraseña nueva. Vence en 1 hora.`}
      >
        <Link href="/entrar" className="btn-ghost block w-full text-center">
          Volver a entrar
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="¿Olvidaste tu contraseña?"
      subtitle="Escribe el correo de tu cuenta y te enviaremos un enlace para crear una nueva."
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Correo
          </label>
          <input
            id="email"
            className="input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="btn w-full" disabled={loading}>
          Enviarme el enlace
        </button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link href="/entrar" className="text-emerald-700 hover:underline dark:text-emerald-400">
          Volver a entrar
        </Link>
      </p>
    </AuthShell>
  );
}
