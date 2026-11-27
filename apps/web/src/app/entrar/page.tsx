"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { GoogleButton, OrDivider } from "@/components/GoogleButton";
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
  /** Cuenta con contraseña que aún no confirmó su correo. */
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState("");

  async function resend() {
    setResent("");
    const r = await authClient.sendVerificationEmail({ email, callbackURL: next });
    setResent(r.error ? (r.error.message ?? "No se pudo reenviar.") : "Te lo enviamos de nuevo.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setUnverified(false);
    setLoading(true);
    const res =
      mode === "password"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signIn.magicLink({ email, callbackURL: next });
    setLoading(false);
    if (res.error?.code === "EMAIL_NOT_VERIFIED") return setUnverified(true);
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
        {mode === "password" && (
          <div className="-mt-2 text-right">
            <Link
              href="/olvide-clave"
              className="text-sm text-brand-700 hover:underline dark:text-brand-400"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        {unverified && (
          <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Primero confirma tu correo con el enlace que te enviamos a <b>{email}</b>.{" "}
            <button type="button" className="font-semibold underline" onClick={resend}>
              Reenviar el correo
            </button>
            {resent && <span className="mt-1 block">{resent}</span>}
          </div>
        )}
        <button type="submit" className="btn w-full" disabled={loading}>
          {mode === "password" ? "Entrar" : "Enviarme un enlace"}
        </button>
        <button
          type="button"
          className="w-full text-sm text-brand-700 hover:underline dark:text-brand-400"
          onClick={() => setMode(mode === "password" ? "magic" : "password")}
        >
          {mode === "password"
            ? "Entrar sin contraseña (enlace por correo)"
            : "Entrar con contraseña"}
        </button>
        {googleEnabled && (
          <>
            <OrDivider />
            <GoogleButton callbackURL={next} label="Continuar con Google" />
          </>
        )}
      </form>
      <p className="mt-6 text-center text-sm text-zinc-500">
        ¿No tienes cuenta?{" "}
        <Link
          href={`/registro?next=${encodeURIComponent(next)}`}
          className="font-medium text-brand-700 hover:underline dark:text-brand-400"
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
