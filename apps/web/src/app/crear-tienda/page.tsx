"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell, ErrorText } from "@/components/ui";
import { authClient, useSession } from "@/lib/auth-client";

function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

export default function Page() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isPending && !session) router.replace("/entrar?next=/crear-tienda");
  }, [isPending, session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const suffix = Math.random().toString(36).slice(2, 6);
    const res = await authClient.organization.create({ name, slug: `${slugify(name)}-${suffix}` });
    if (res.error) {
      setLoading(false);
      return setError(res.error.message ?? "No se pudo crear la tienda");
    }
    await authClient.organization.setActive({ organizationId: res.data.id });
    router.push("/panel");
  }

  return (
    <AuthShell
      title="Crea tu tienda"
      subtitle="Cada tienda tiene su propio equipo, productos, WhatsApp y configuración de IA."
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="name">
            Nombre de la tienda o marca
          </label>
          <input
            id="name"
            className="input"
            required
            maxLength={80}
            placeholder="Ej. VitashopEc"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="btn w-full" disabled={loading || !name.trim()}>
          Crear tienda
        </button>
      </form>
    </AuthShell>
  );
}
