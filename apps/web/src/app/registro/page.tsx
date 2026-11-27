"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { GoogleButton, OrDivider } from "@/components/GoogleButton";
import { PhoneField } from "@/components/PhoneField";
import { AuthShell, ErrorText } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";

function SignUpForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/crear-tienda";
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  /** Cuenta creada: falta confirmar el correo con el enlace que le llegó. */
  const [sentTo, setSentTo] = useState("");
  const [resent, setResent] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!phone) return setError("Escribe tu número de WhatsApp completo.");
    setLoading(true);
    const res = await authClient.signUp.email({
      ...form,
      phone,
      // Al confirmar el correo entra directo aquí.
      callbackURL: next,
    });
    setLoading(false);
    if (res.error) return setError(res.error.message ?? "No se pudo crear la cuenta");
    // Sin sesión: hay que confirmar el correo primero.
    if (!res.data?.token) return setSentTo(form.email);
    router.push(next);
  }

  async function resend() {
    setResent("");
    const r = await authClient.sendVerificationEmail({ email: sentTo, callbackURL: next });
    setResent(r.error ? (r.error.message ?? "No se pudo reenviar.") : "Te lo enviamos de nuevo.");
  }

  if (sentTo)
    return (
      <AuthShell title="Revisa tu correo" subtitle={`Te enviamos un enlace a ${sentTo}`}>
        <div className="space-y-4 text-sm text-zinc-600 dark:text-zinc-400">
          <p>
            Ábrelo para confirmar tu correo y entrar a Selichat. Si no lo ves, revisa la carpeta de
            spam o promociones. El enlace vence en 24 horas.
          </p>
          <button type="button" className="btn-secondary w-full" onClick={resend}>
            Reenviar el correo
          </button>
          {resent && <p className="text-center text-brand-700 dark:text-brand-400">{resent}</p>}
          <p className="text-center">
            ¿Te equivocaste de correo?{" "}
            <button
              type="button"
              className="font-medium text-brand-700 hover:underline dark:text-brand-400"
              onClick={() => setSentTo("")}
            >
              Corrígelo
            </button>
          </p>
        </div>
      </AuthShell>
    );

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
          <label className="label" htmlFor="phone">
            WhatsApp
          </label>
          <PhoneField value={phone} onChange={setPhone} required />
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
        {googleEnabled && (
          <>
            <OrDivider />
            <GoogleButton callbackURL={next} label="Registrarme con Google" />
          </>
        )}
      </form>
      <p className="mt-6 text-center text-sm text-zinc-500">
        ¿Ya tienes cuenta?{" "}
        <Link
          href={`/entrar?next=${encodeURIComponent(next)}`}
          className="font-medium text-brand-700 hover:underline dark:text-brand-400"
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
