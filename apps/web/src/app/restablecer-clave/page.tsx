"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell, ErrorText } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <AuthShell
        title="Enlace inválido o vencido"
        subtitle="Pide un enlace nuevo para restablecer tu contraseña."
      >
        <Link href="/olvide-clave" className="btn block w-full text-center">
          Pedir otro enlace
        </Link>
      </AuthShell>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("Las contraseñas no coinciden");
    setError("");
    setLoading(true);
    const res = await authClient.resetPassword({ newPassword: password, token: token ?? "" });
    setLoading(false);
    if (res.error)
      return setError(
        res.error.message ?? "No se pudo cambiar la contraseña. Pide un enlace nuevo.",
      );
    router.push("/entrar");
  }

  return (
    <AuthShell title="Crea tu contraseña nueva" subtitle="Mínimo 8 caracteres.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="password">
            Contraseña nueva
          </label>
          <input
            id="password"
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="confirm">
            Repite la contraseña
          </label>
          <input
            id="confirm"
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="btn w-full" disabled={loading}>
          Guardar contraseña
        </button>
      </form>
    </AuthShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
