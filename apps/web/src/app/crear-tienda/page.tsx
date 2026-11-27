"use client";
import { STORE_COUNTRIES } from "@chatea/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthShell, ErrorText } from "@/components/ui";
import { api } from "@/lib/api";
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
  const [country, setCountry] = useState("EC");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Evita crear la tienda dos veces por doble clic / Enter antes de que se re-renderice.
  const busy = useRef(false);

  useEffect(() => {
    if (isPending) return;
    if (!session) router.replace("/entrar?next=/crear-tienda");
    else if (!session.user.phone) router.replace("/confirmar-whatsapp?next=/crear-tienda");
  }, [isPending, session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setError("");
    setLoading(true);
    const suffix = Math.random().toString(36).slice(2, 6);
    const res = await authClient.organization.create({ name, slug: `${slugify(name)}-${suffix}` });
    if (res.error) {
      setLoading(false);
      busy.current = false;
      return setError(res.error.message ?? "No se pudo crear la tienda");
    }
    await authClient.organization.setActive({ organizationId: res.data.id });
    // País, moneda y zona horaria de la tienda (lo demás queda con los valores por defecto).
    const c = STORE_COUNTRIES.find((x) => x.code === country);
    try {
      const s = await api<Record<string, unknown> | null>("/api/settings");
      await api("/api/settings", {
        method: "PUT",
        body: {
          messagingWindow: { start: "08:00", end: "22:00" },
          ...s,
          country,
          currency,
          timezone: c?.tz ?? "America/Guayaquil",
        },
      });
    } catch {
      // Si falla, se ajusta luego en Configuración; la tienda ya está creada.
    }
    // Carga completa: el panel pudo haber guardado la lista de tiendas vacía de antes
    // (al entrar con Google se pasa por el panel antes de crear la tienda).
    window.location.assign("/panel");
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="country">
              País
            </label>
            <select
              id="country"
              className="input"
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                const c = STORE_COUNTRIES.find((x) => x.code === e.target.value);
                if (c) setCurrency(c.currency);
              }}
            >
              {STORE_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="currency">
              Moneda
            </label>
            <select
              id="currency"
              className="input"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {[...new Set(STORE_COUNTRIES.map((c) => c.currency))].map((cur) => (
                <option key={cur} value={cur}>
                  {cur}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="-mt-2 text-xs text-zinc-500">
          Con el país ajustamos tu horario y las ciudades de Dropi. Lo puedes cambiar después.
        </p>
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="btn w-full" disabled={loading || !name.trim()}>
          Crear tienda
        </button>
      </form>
    </AuthShell>
  );
}
