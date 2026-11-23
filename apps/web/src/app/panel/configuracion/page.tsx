"use client";
import { CURRENCIES } from "@chatea/shared";
import { useEffect, useState } from "react";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Settings = {
  country: string;
  currency: string;
  timezone: string;
  messagingWindow: { start: string; end: string };
};

const COUNTRIES = [
  { code: "EC", name: "Ecuador", currency: "USD", tz: "America/Guayaquil" },
  { code: "CO", name: "Colombia", currency: "COP", tz: "America/Bogota" },
  { code: "MX", name: "México", currency: "MXN", tz: "America/Mexico_City" },
  { code: "PE", name: "Perú", currency: "PEN", tz: "America/Lima" },
  { code: "CL", name: "Chile", currency: "CLP", tz: "America/Santiago" },
  { code: "CR", name: "Costa Rica", currency: "CRC", tz: "America/Costa_Rica" },
  { code: "PA", name: "Panamá", currency: "USD", tz: "America/Panama" },
  { code: "GT", name: "Guatemala", currency: "GTQ", tz: "America/Guatemala" },
  { code: "PY", name: "Paraguay", currency: "PYG", tz: "America/Asuncion" },
  { code: "AR", name: "Argentina", currency: "ARS", tz: "America/Argentina/Buenos_Aires" },
  { code: "ES", name: "España", currency: "EUR", tz: "Europe/Madrid" },
];

export default function Page() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Settings>("/api/settings")
      .then(setS)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    setError("");
    try {
      setS(await api<Settings>("/api/settings", { method: "PUT", body: s }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!s) return <ErrorText>{error}</ErrorText>;

  return (
    <>
      <PageHeader
        title="Configuración"
        description="País, moneda y horario en que los agentes pueden escribir a tus clientes."
      />
      <form onSubmit={save} className="card grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="country">
            País
          </label>
          <select
            id="country"
            className="input"
            value={s.country}
            onChange={(e) => {
              const c = COUNTRIES.find((x) => x.code === e.target.value);
              if (c) setS({ ...s, country: c.code, currency: c.currency, timezone: c.tz });
            }}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
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
            value={s.currency}
            onChange={(e) => setS({ ...s, currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="tz">
            Zona horaria
          </label>
          <input
            id="tz"
            className="input"
            value={s.timezone}
            onChange={(e) => setS({ ...s, timezone: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="start">
            Escribir desde
          </label>
          <input
            id="start"
            className="input"
            type="time"
            value={s.messagingWindow.start}
            onChange={(e) =>
              setS({ ...s, messagingWindow: { ...s.messagingWindow, start: e.target.value } })
            }
          />
        </div>
        <div>
          <label className="label" htmlFor="end">
            Hasta
          </label>
          <input
            id="end"
            className="input"
            type="time"
            value={s.messagingWindow.end}
            onChange={(e) =>
              setS({ ...s, messagingWindow: { ...s.messagingWindow, end: e.target.value } })
            }
          />
        </div>
        <div className="sm:col-span-2 flex items-center gap-3">
          <button type="submit" className="btn">
            Guardar
          </button>
          {saved && (
            <span className="text-sm text-emerald-700 dark:text-emerald-400">Guardado ✓</span>
          )}
        </div>
        <div className="sm:col-span-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </form>
    </>
  );
}
