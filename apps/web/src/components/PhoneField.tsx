"use client";
/**
 * WhatsApp con país: bandera y prefijo a la izquierda, el número a la derecha (sin el 0 de la
 * operadora). Entrega el número internacional en dígitos (593991234567) o "" si está incompleto.
 */
import { internationalPhone, STORE_COUNTRIES } from "@chatea/shared";
import { useEffect, useState } from "react";

/** Separa un número guardado (593991234567) en país y número local. */
function splitStored(value: string) {
  const digits = value.replace(/\D/g, "");
  const c = [...STORE_COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((x) => digits.startsWith(x.dial));
  return c ? { country: c.code, local: digits.slice(c.dial.length) } : null;
}

export function PhoneField({
  id = "phone",
  value,
  onChange,
  hint = "Sin el 0 de tu operadora. Es para escribirte si algo se traba con tu tienda.",
  required,
}: {
  id?: string;
  /** Número internacional guardado (o "" al empezar). */
  value: string;
  /** Recibe el número internacional, o "" mientras esté incompleto. */
  onChange: (international: string) => void;
  hint?: string;
  required?: boolean;
}) {
  const start = splitStored(value);
  const [country, setCountry] = useState<string>(start?.country ?? "EC");
  const [local, setLocal] = useState(start?.local ?? "");
  const dial = STORE_COUNTRIES.find((c) => c.code === country)?.dial ?? "593";
  const full = internationalPhone(dial, local);
  const incomplete = local.replace(/\D/g, "").length > 0 && !full;

  // biome-ignore lint/correctness/useExhaustiveDependencies: avisa solo cuando cambia el número
  useEffect(() => {
    onChange(full);
  }, [full]);

  return (
    <div>
      <div className="flex gap-2">
        <select
          aria-label="País del WhatsApp"
          className="input w-auto shrink-0"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        >
          {STORE_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} +{c.dial}
            </option>
          ))}
        </select>
        <input
          id={id}
          className={`input min-w-0 flex-1${incomplete ? " border-amber-500" : ""}`}
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="Tu número de WhatsApp"
          required={required}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
        />
      </div>
      <p
        className={`mt-1 text-xs ${incomplete ? "text-amber-700 dark:text-amber-400" : "text-zinc-500"}`}
      >
        {incomplete ? "Ese número está incompleto." : hint}
      </p>
    </div>
  );
}
