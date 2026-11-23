"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell, ErrorText } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

function SignUpForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/crear-tienda";
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await authClient.signUp.email(form);
    setLoading(false);
    if (res.error) return setError(res.error.message ?? "No se pudo crear la cuenta");
    router.push(next);
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <AuthShell title="Crea tu cuenta" subtitle="Empieza a vender por WhatsApp con IA">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="name">
            Nombre
          </label>
          <input
            id="name"
            className="input"
            required
            autoComplete="name"
            value={form.name}
            onChange={set("name")}
          />
        </div>
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
            value={form.email}
            onChange={set("email")}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={form.password}
            onChange={set("password")}
          />
          <p className="mt-1 text-xs text-zinc-500">Mínimo 8 caracteres.</p>
        </div>
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="btn w-full" disabled={loading}>
          Crear cuenta
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-500">
        ¿Ya tienes cuenta?{" "}
        <Link
          href={`/entrar?next=${encodeURIComponent(next)}`}
          className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Entra
        </Link>
      </p>
    </AuthShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
