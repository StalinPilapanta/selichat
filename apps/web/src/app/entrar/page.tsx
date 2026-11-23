"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell, ErrorText } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/panel";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res =
      mode === "password"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signIn.magicLink({ email, callbackURL: next });
    setLoading(false);
    if (res.error) return setError(res.error.message ?? "No se pudo iniciar sesión");
    if (mode === "magic") return setSent(true);
    router.push(next);
  }

  if (sent) {
    return (
      <AuthShell title="Revisa tu correo" subtitle={`Enviamos un enlace de acceso a ${email}`}>
        <button type="button" className="btn-ghost w-full" onClick={() => setSent(false)}>
          Volver
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Entrar a tu cuenta">
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
        {mode === "password" && (
          <div>
            <label className="label" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              className="input"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="btn w-full" disabled={loading}>
          {mode === "password" ? "Entrar" : "Enviarme un enlace"}
        </button>
        <button
          type="button"
          className="w-full text-sm text-emerald-700 hover:underline dark:text-emerald-400"
          onClick={() => setMode(mode === "password" ? "magic" : "password")}
        >
          {mode === "password"
            ? "Entrar sin contraseña (enlace por correo)"
            : "Entrar con contraseña"}
        </button>
        {googleEnabled && (
          <button
            type="button"
            className="btn-ghost w-full"
            onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}
          >
            Continuar con Google
          </button>
        )}
      </form>
      <p className="mt-6 text-center text-sm text-zinc-500">
        ¿No tienes cuenta?{" "}
        <Link
          href={`/registro?next=${encodeURIComponent(next)}`}
          className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Regístrate
        </Link>
      </p>
    </AuthShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
