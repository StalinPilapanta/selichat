"use client";
import {
  BRAND_PRESETS,
  brandCssVars,
  CURRENCIES,
  DEFAULT_BRAND_COLOR,
  DEFAULT_BRAND_NAME,
} from "@chatea/shared";
import {
  Check,
  ImagePlus,
  MessageCircle,
  Palette,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorText, PageHeader } from "@/components/ui";
import { api, errorMessage, uploadFile } from "@/lib/api";
import { authClient, useActiveOrganization } from "@/lib/auth-client";
import { useBranding } from "@/lib/branding";

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
        icon={SettingsIcon}
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
          {saved && <span className="text-sm text-brand-700 dark:text-brand-400">Guardado ✓</span>}
        </div>
        <div className="sm:col-span-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </form>
      <BrandingCard />
      <DeleteStore />
    </>
  );
}

/** Zona de peligro: borra la tienda activa (el servidor rechaza si tiene WhatsApp conectado). */
function DeleteStore() {
  const { data: active } = useActiveOrganization();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!active) return null;

  async function remove() {
    if (!active) return;
    setBusy(true);
    setError("");
    const res = await authClient.organization.delete({ organizationId: active.id });
    if (res.error) {
      setBusy(false);
      return setError(res.error.message ?? "No se pudo eliminar la tienda");
    }
    window.location.href = "/panel";
  }

  return (
    <section className="mt-10 max-w-2xl rounded-lg border border-red-300 p-4 dark:border-red-900">
      <h2 className="font-semibold text-red-700 dark:text-red-400">Eliminar tienda</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Borra <strong>{active.name}</strong> ({active.slug}) con todos sus productos, prompts y
        conversaciones. No se puede deshacer. Escribe el nombre de la tienda para confirmar.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          className="input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={active.name}
          aria-label="Nombre de la tienda para confirmar"
        />
        <button
          type="button"
          className="btn-danger"
          disabled={busy || confirm.trim() !== active.name}
          onClick={remove}
        >
          Eliminar
        </button>
      </div>
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </section>
  );
}

/**
 * Marca de la tienda: nombre, color (sugeridos o propio) y logo, con vista previa en vivo.
 * Se aplica en todo el panel y en el ícono de la pestaña al guardar.
 */
function BrandingCard() {
  const brand = useBranding();
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_BRAND_COLOR);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(brand.name === DEFAULT_BRAND_NAME ? "" : brand.name);
    setColor(brand.color ?? DEFAULT_BRAND_COLOR);
    setLogoUrl(brand.logoUrl);
  }, [brand.name, brand.color, brand.logoUrl]);

  // Vista previa: las variables de la marca solo dentro de este recuadro.
  const preview = brandCssVars(color) as React.CSSProperties;

  async function onLogo(file: File | undefined) {
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const r = await uploadFile(file);
      if (r.kind !== "image") throw new Error("Sube una imagen JPG, PNG o WebP.");
      setLogoUrl(r.url);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api("/api/settings/branding", {
        method: "PUT",
        body: { name: name.trim() || null, color, logoUrl },
      });
      brand.set({ name: name.trim() || DEFAULT_BRAND_NAME, color, logoUrl });
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const shownName = name.trim() || DEFAULT_BRAND_NAME;
  return (
    <section className="card mt-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
          <Palette className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">Marca de la tienda</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Nombre, color y logo que ve tu equipo en todo el panel y en la pestaña del navegador.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-5">
          <label className="block">
            <span className="label">Nombre</span>
            <input
              className="input"
              maxLength={30}
              placeholder={DEFAULT_BRAND_NAME}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <div>
            <span className="label">Color de la marca</span>
            <div className="flex flex-wrap items-center gap-2">
              {BRAND_PRESETS.map((p) => (
                <button
                  key={p.color}
                  type="button"
                  title={p.name}
                  aria-label={p.name}
                  aria-pressed={color.toLowerCase() === p.color}
                  onClick={() => setColor(p.color)}
                  className="grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-white transition hover:scale-110 aria-pressed:ring-2 aria-pressed:ring-zinc-900 dark:ring-offset-zinc-900 dark:aria-pressed:ring-white"
                  style={{ background: p.color }}
                >
                  {color.toLowerCase() === p.color && (
                    <Check
                      className="size-4"
                      style={{ color: brandCssVars(p.color)["--brand-ink"] }}
                    />
                  )}
                </button>
              ))}
              <label className="ml-1 flex items-center gap-2 rounded-full border border-zinc-300 py-1 pr-3 pl-1 text-sm dark:border-zinc-700">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
                  aria-label="Color propio"
                />
                <span className="font-mono text-xs">{color}</span>
              </label>
            </div>
          </div>

          <div>
            <span className="label">Logo</span>
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid size-14 place-items-center overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                {logoUrl ? (
                  // biome-ignore lint/performance/noImgElement: logo subido por la tienda
                  <img src={logoUrl} alt="Logo" className="size-full object-contain" />
                ) : (
                  <ImagePlus className="size-5 text-zinc-400" />
                )}
              </div>
              <label className="btn-ghost btn-sm cursor-pointer">
                <ImagePlus />
                {uploading ? "Subiendo…" : logoUrl ? "Cambiar" : "Subir logo"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) => onLogo(e.target.files?.[0])}
                />
              </label>
              {logoUrl && (
                <button type="button" className="btn-quiet btn-sm" onClick={() => setLogoUrl(null)}>
                  <Trash2 />
                  Quitar
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Cuadrado, PNG o WebP con fondo transparente, hasta 5 MB. Sin logo se usa la inicial
              sobre tu color.
            </p>
          </div>
        </div>

        {/* Vista previa con los colores elegidos (aún sin guardar). */}
        <div
          style={preview}
          className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="mb-3 text-xs font-semibold text-zinc-500">Vista previa</div>
          <div className="flex items-center gap-2 font-bold">
            {logoUrl ? (
              // biome-ignore lint/performance/noImgElement: logo subido por la tienda
              <img src={logoUrl} alt="" className="size-8 rounded-xl object-contain" />
            ) : (
              <span className="grid size-8 place-items-center rounded-xl bg-brand-600 text-sm text-brand-ink">
                {shownName[0]?.toUpperCase()}
              </span>
            )}
            <span className="truncate">{shownName}</span>
          </div>
          <div className="mt-3 flex items-center gap-3 rounded-xl bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800 dark:bg-brand-950 dark:text-brand-200">
            <MessageCircle className="size-4 text-brand-600" />
            Conversaciones
            <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1.5 text-[11px] text-brand-ink">
              3
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="btn btn-sm pointer-events-none">Guardar</span>
            <span className="btn-secondary btn-sm pointer-events-none">Secundario</span>
            <span className="badge badge-brand">Interesado</span>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" className="btn" disabled={busy || uploading} onClick={save}>
          {busy ? "Guardando…" : "Guardar marca"}
        </button>
        <button
          type="button"
          className="btn-quiet"
          onClick={() => {
            setName("");
            setColor(DEFAULT_BRAND_COLOR);
            setLogoUrl(null);
          }}
        >
          Volver a la de Selichat
        </button>
        {saved && (
          <span className="text-sm text-brand-700 dark:text-brand-400" role="status">
            Marca guardada ✓
          </span>
        )}
      </div>
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </section>
  );
}
