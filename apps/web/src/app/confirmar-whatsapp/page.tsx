"use client";
/**
 * Confirma tu WhatsApp: lo piden las cuentas que entraron con Google o que se crearon antes de
 * pedir el número. Por ahora solo se guarda; el código por WhatsApp llega más adelante.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PhoneField } from "@/components/PhoneField";
import { AuthShell, ErrorText } from "@/components/ui";
import { authClient, useSession } from "@/lib/auth-client";

/** Solo rutas internas del panel (evita redirigir a otro sitio). */
const safeNext = (n: string | null) => (n?.startsWith("/") && !n.startsWith("//") ? n : "/panel");

function ConfirmPhone() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const { data: session, isPending, refetch } = useSession();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isPending) return;
    if (!session) router.replace(`/entrar?next=${encodeURIComponent(next)}`);
    else if (session.user.phone) router.replace(next);
  }, [isPending, session, router, next]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!phone) return setError("Escribe tu número de WhatsApp completo.");
    setSaving(true);
    setError("");
    const r = await authClient.updateUser({ phone });
    if (r.error) {
      setSaving(false);
      return setError(r.error.message ?? "No se pudo guardar.");
    }
    await refetch();
    router.replace(next);
  }

  return (
    <AuthShell
      title="Confirma tu WhatsApp"
      subtitle="Es por donde te escribimos si algo se traba con tu tienda."
    >
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label" htmlFor="phone">
            WhatsApp
          </label>
          <PhoneField value="" onChange={setPhone} required />
        </div>
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="btn w-full" disabled={saving || !phone}>
          {saving ? "Guardando…" : "Continuar"}
        </button>
      </form>
    </AuthShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ConfirmPhone />
    </Suspense>
  );
}
