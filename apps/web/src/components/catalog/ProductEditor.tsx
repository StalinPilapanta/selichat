"use client";
import {
  CURRENCIES,
  MEDIA_KINDS,
  MEDIA_USAGE_LABELS,
  MEDIA_USAGES,
  mediaKindFromUrl,
  type ProductInput,
} from "@chatea/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type PromptDraft, PromptEditor } from "@/components/PromptEditor";
import { ErrorText } from "@/components/ui";
import { api, errorMessage, uploadFile } from "@/lib/api";

type Offer = NonNullable<ProductInput["offers"]>[number];
type Media = NonNullable<ProductInput["media"]>[number];
type Faq = NonNullable<ProductInput["faqs"]>[number];
type Trigger = NonNullable<ProductInput["triggers"]>[number];
type Upsell = NonNullable<ProductInput["upsells"]>[number];
type Step = NonNullable<ProductInput["followUps"]>["reminders"][number];

export type ProductForm = Required<
  Pick<
    ProductInput,
    | "name"
    | "description"
    | "kind"
    | "status"
    | "price"
    | "currency"
    | "initialMessage"
    | "entryQuestion"
  >
> & {
  imageUrl: string;
  dropiProductId: string;
  offers: Offer[];
  media: Media[];
  faqs: Faq[];
  triggers: Trigger[];
  upsells: Upsell[];
  followUps: { reminders: Step[]; remarketing: Step[] };
};

export const emptyProduct = (currency: string): ProductForm => ({
  name: "",
  description: "",
  kind: "fisico",
  status: "activo",
  price: "",
  currency,
  imageUrl: "",
  dropiProductId: "",
  initialMessage: "",
  entryQuestion: "",
  offers: [],
  media: [],
  faqs: [],
  triggers: [],
  upsells: [],
  followUps: { reminders: [], remarketing: [] },
});

/** Producto del API → formulario (descarta ids y campos de servidor). */
// biome-ignore lint/suspicious/noExplicitAny: respuesta del API sin tipar
export function toForm(p: any): ProductForm {
  const pick = <T extends object>(rows: T[], keys: (keyof T)[]) =>
    rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])) as T);
  return {
    name: p.name,
    description: p.description,
    kind: p.kind,
    status: p.status,
    price: p.price,
    currency: p.currency,
    imageUrl: p.imageUrl ?? "",
    dropiProductId: p.dropiProductId ?? "",
    initialMessage: p.initialMessage,
    entryQuestion: p.entryQuestion,
    offers: pick(p.offers, ["quantity", "totalPrice", "label", "featured", "freeShipping"]),
    media: pick(p.media, ["kind", "url", "usage", "caption"]),
    faqs: pick(p.faqs, ["question", "answer"]),
    triggers: pick(p.triggers, ["kind", "value"]),
    upsells: pick(p.upsells, [
      "name",
      "description",
      "price",
      "dropiProductId",
      "imageUrl",
      "moment",
      "active",
    ]),
    followUps: p.followUps,
  };
}

function toBody(f: ProductForm) {
  return {
    ...f,
    imageUrl: f.imageUrl || null,
    dropiProductId: f.dropiProductId || null,
    triggers: f.triggers.map((t) => ({ ...t, value: t.value.trim() })).filter((t) => t.value),
  };
}

/** Una columna de disparadores (como en Chatea Pro): una fila por valor, con agregar y quitar. */
function TriggerColumn({
  title,
  hint,
  placeholder,
  values,
  onChange,
  numeric,
}: {
  title: string;
  hint: string;
  placeholder: string;
  values: string[];
  onChange: (v: string[]) => void;
  numeric?: boolean;
}) {
  const rows = values.length ? values : [""];
  const dup = (v: string, i: number) =>
    v.trim() !== "" && rows.findIndex((x) => x.trim() === v.trim()) !== i;
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="font-medium">{title}</div>
      <p className="mb-3 text-xs text-zinc-500">{hint}</p>
      <div className="space-y-2">
        {rows.map((v, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: filas editables sin id estable
            key={i}
          >
            <div className="flex gap-2">
              <span className="w-5 shrink-0 self-center text-right text-xs text-zinc-400">
                {i + 1}
              </span>
              <input
                className="input"
                aria-label={`${title} ${i + 1}`}
                inputMode={numeric ? "numeric" : undefined}
                placeholder={placeholder}
                value={v}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = numeric ? e.target.value.replace(/\D/g, "") : e.target.value;
                  onChange(next);
                }}
              />
              <button
                type="button"
                aria-label="Quitar"
                className="btn-ghost px-2 text-red-600"
                onClick={() => onChange(rows.filter((_, k) => k !== i))}
              >
                ✕
              </button>
            </div>
            {dup(v, i) && (
              <p className="mt-1 ml-7 text-xs text-amber-700 dark:text-amber-400">Repetido</p>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="btn-ghost mt-3" onClick={() => onChange([...rows, ""])}>
        + Agregar
      </button>
    </div>
  );
}

const TABS = [
  "General",
  "Ofertas",
  "Multimedia",
  "Preguntas",
  "Disparadores",
  "Upsells",
  "Seguimiento",
  "Prompt",
] as const;
type Tab = (typeof TABS)[number];

function Rows<T>({
  items,
  onChange,
  empty,
  render,
  make,
  addLabel,
}: {
  items: T[];
  onChange: (v: T[]) => void;
  empty: string;
  render: (item: T, set: (patch: Partial<T>) => void) => React.ReactNode;
  make: () => T;
  addLabel: string;
}) {
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j] as T, next[i] as T];
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="text-sm text-zinc-500">{empty}</p>}
      {items.map((item, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: filas editables sin id estable
          key={i}
          className="flex gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
        >
          <div className="min-w-0 flex-1">
            {render(item, (patch) =>
              onChange(items.map((x, k) => (k === i ? { ...x, ...patch } : x))),
            )}
          </div>
          <div className="flex flex-col gap-1 text-xs">
            <button
              type="button"
              aria-label="Subir"
              onClick={() => move(i, -1)}
              className="btn-ghost px-2 py-1"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Bajar"
              onClick={() => move(i, 1)}
              className="btn-ghost px-2 py-1"
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="Quitar"
              onClick={() => onChange(items.filter((_, k) => k !== i))}
              className="btn-ghost px-2 py-1 text-red-600"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="btn-ghost" onClick={() => onChange([...items, make()])}>
        + {addLabel}
      </button>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: el control va como hijo
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

function StepsEditor({
  steps,
  onChange,
  kind,
}: {
  steps: Step[];
  onChange: (s: Step[]) => void;
  kind: "reminders" | "remarketing";
}) {
  const unit = kind === "reminders" ? 1 : 1440;
  const unitLabel = kind === "reminders" ? "minutos" : "días";
  return (
    <Rows
      items={steps}
      onChange={onChange}
      addLabel={kind === "reminders" ? "Recordatorio" : "Remarketing"}
      empty="Sin pasos."
      make={() => ({
        enabled: true,
        delayMinutes: kind === "reminders" ? 30 : unit,
        message: "",
        mode: kind === "reminders" ? ("mensaje" as const) : ("ia" as const),
        template: null,
      })}
      render={(s, set) => (
        <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={(e) => set({ enabled: e.target.checked })}
              />{" "}
              Activo
            </label>
            <Field label={`Después de (${unitLabel})`}>
              <input
                className="input"
                type="number"
                min={1}
                step="any"
                value={Math.round((s.delayMinutes / unit) * 100) / 100}
                onChange={(e) =>
                  set({ delayMinutes: Math.max(1, Math.round(Number(e.target.value) * unit)) })
                }
              />
            </Field>
          </div>
          <div className="space-y-2">
            <select
              className="input"
              value={s.mode ?? "mensaje"}
              onChange={(e) => set({ mode: e.target.value as "mensaje" | "ia" })}
              aria-label="Tipo de recordatorio"
            >
              <option value="mensaje">Enviar este mensaje tal cual</option>
              <option value="ia">La IA redacta el mensaje con esta instrucción</option>
            </select>
            <Field label={s.mode === "ia" ? "Instrucción para la IA" : "Mensaje"}>
              <textarea
                className="input"
                rows={3}
                value={s.message}
                onChange={(e) => set({ message: e.target.value })}
              />
            </Field>
            <Field
              label="Plantilla de WhatsApp (si pasaron más de 24 h)"
              hint="Nombre exacto de la plantilla aprobada por Meta. Vacío = no enviar."
            >
              <input
                className="input"
                value={s.template?.name ?? ""}
                onChange={(e) =>
                  set({
                    template: e.target.value
                      ? { name: e.target.value, lang: s.template?.lang ?? "es" }
                      : null,
                  })
                }
              />
            </Field>
          </div>
        </div>
      )}
    />
  );
}

export function ProductEditor({
  productId,
  initial,
  initialPrompt,
  initialTab,
}: {
  productId?: string;
  initialTab?: string | null;
  initial: ProductForm;
  /** Borrador de prompt (p. ej. generado con IA) para guardar al crear el producto. */
  initialPrompt?: PromptDraft | null;
}) {
  const router = useRouter();
  const [f, setF] = useState<ProductForm>(initial);
  const [tab, setTab] = useState<Tab>(
    TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "General",
  );
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (patch: Partial<ProductForm>) => {
    setF((x) => ({ ...x, ...patch }));
    setSaved(false);
  };

  async function save() {
    setError("");
    setBusy(true);
    try {
      if (productId) {
        await api(`/api/products/${productId}`, { method: "PUT", body: toBody(f) });
        setSaved(true);
      } else {
        const p = await api<{ id: string }>("/api/products", { method: "POST", body: toBody(f) });
        if (initialPrompt) {
          await api("/api/prompts", {
            method: "POST",
            body: {
              scope: "product",
              productId: p.id,
              ...initialPrompt,
              note: "Generado con IA",
              publish: false,
            },
          });
        }
        router.replace(`/panel/catalogo/${p.id}${initialPrompt ? "?tab=Prompt" : ""}`);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!productId || !confirm(`¿Eliminar "${f.name}"? Se borran también sus prompts.`)) return;
    try {
      await api(`/api/products/${productId}`, { method: "DELETE" });
      router.replace("/panel/catalogo");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      const added: Media[] = [];
      for (const file of Array.from(files)) {
        const r = await uploadFile(file);
        added.push({ kind: r.kind as Media["kind"], url: r.url, usage: "inicial", caption: "" });
      }
      set({ media: [...f.media, ...added] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  const tabs = productId ? TABS : TABS.filter((t) => t !== "Prompt");
  const count: Partial<Record<Tab, number>> = {
    Ofertas: f.offers.length,
    Multimedia: f.media.length,
    Preguntas: f.faqs.length,
    Disparadores: f.triggers.filter((t) => t.value.trim()).length,
    Upsells: f.upsells.length,
    Seguimiento: f.followUps.reminders.length + f.followUps.remarketing.length,
  };

  return (
    <div>
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
              tab === t
                ? "border-emerald-600 font-medium text-emerald-700 dark:text-emerald-400"
                : "border-transparent text-zinc-500"
            }`}
          >
            {t}
            {count[t] ? <span className="ml-1 text-xs text-zinc-400">{count[t]}</span> : null}
          </button>
        ))}
      </div>

      {tab === "Prompt" && productId ? (
        <PromptEditor
          scope="product"
          productId={productId}
          allowGuided
          help="Libre: escribes todo el prompt del producto (reemplaza al maestro). Guiado: el prompt maestro de la tienda se completa con estas secciones y variables."
        />
      ) : (
        <div className="card space-y-4">
          {tab === "General" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre">
                  <input
                    className="input"
                    value={f.name}
                    onChange={(e) => set({ name: e.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-[1fr_7rem] gap-2">
                  <Field label="Precio unitario">
                    <input
                      className="input"
                      inputMode="decimal"
                      placeholder="27.99"
                      value={f.price}
                      onChange={(e) => set({ price: e.target.value.replace(",", ".") })}
                    />
                  </Field>
                  <Field label="Moneda">
                    <select
                      className="input"
                      value={f.currency}
                      onChange={(e) => set({ currency: e.target.value })}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code} title={c.label}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Tipo">
                  <select
                    className="input"
                    value={f.kind}
                    onChange={(e) => set({ kind: e.target.value as ProductForm["kind"] })}
                  >
                    <option value="fisico">Producto físico</option>
                    <option value="digital">Producto digital</option>
                    <option value="servicio">Servicio</option>
                  </select>
                </Field>
                <Field
                  label="Estado"
                  hint="Los productos inactivos no se activan con anuncios ni palabras clave."
                >
                  <select
                    className="input"
                    value={f.status}
                    onChange={(e) => set({ status: e.target.value as ProductForm["status"] })}
                  >
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                  </select>
                </Field>
                <Field label="ID del producto en Dropi">
                  <input
                    className="input"
                    value={f.dropiProductId}
                    onChange={(e) => set({ dropiProductId: e.target.value })}
                  />
                </Field>
                <Field label="Imagen principal (URL)">
                  <input
                    className="input"
                    type="url"
                    value={f.imageUrl}
                    onChange={(e) => set({ imageUrl: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Descripción">
                <textarea
                  className="input"
                  rows={3}
                  value={f.description}
                  onChange={(e) => set({ description: e.target.value })}
                />
              </Field>
              <Field
                label="Mensaje inicial"
                hint="Lo primero que recibe el cliente al llegar por un anuncio o palabra clave (luego se envía la multimedia de embudo inicial)."
              >
                <textarea
                  className="input"
                  rows={5}
                  value={f.initialMessage}
                  onChange={(e) => set({ initialMessage: e.target.value })}
                />
              </Field>
              <Field
                label="Pregunta de entrada"
                hint="Cierra el mensaje inicial y abre la conversación. Ej: ¿Desde qué ciudad nos escribes?"
              >
                <input
                  className="input"
                  value={f.entryQuestion}
                  onChange={(e) => set({ entryQuestion: e.target.value })}
                />
              </Field>
            </>
          )}

          {tab === "Ofertas" && (
            <Rows
              items={f.offers}
              onChange={(offers) => set({ offers })}
              addLabel="Oferta"
              empty="Sin ofertas: el agente solo usará el precio unitario."
              make={() => ({
                quantity: f.offers.length + 1,
                totalPrice: "",
                label: "",
                featured: false,
                freeShipping: false,
              })}
              render={(o, s) => (
                <div className="grid gap-2 sm:grid-cols-[6rem_8rem_1fr]">
                  <Field label="Cantidad">
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={o.quantity}
                      onChange={(e) => s({ quantity: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label={`Total (${f.currency})`}>
                    <input
                      className="input"
                      inputMode="decimal"
                      value={o.totalPrice}
                      onChange={(e) => s({ totalPrice: e.target.value.replace(",", ".") })}
                    />
                  </Field>
                  <Field label="Detalle">
                    <input
                      className="input"
                      placeholder="+ regalo sorpresa"
                      value={o.label ?? ""}
                      onChange={(e) => s({ label: e.target.value })}
                    />
                  </Field>
                  <div className="flex gap-4 text-sm sm:col-span-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(o.featured)}
                        onChange={(e) => s({ featured: e.target.checked })}
                      />{" "}
                      Destacada
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(o.freeShipping)}
                        onChange={(e) => s({ freeShipping: e.target.checked })}
                      />{" "}
                      Envío gratis
                    </label>
                  </div>
                </div>
              )}
            />
          )}

          {tab === "Multimedia" && (
            <>
              <label className="btn-ghost cursor-pointer">
                {uploading ? "Subiendo…" : "Subir archivos"}
                <input
                  type="file"
                  multiple
                  className="hidden"
                  accept="image/jpeg,image/png,image/webp,video/mp4,audio/mpeg,audio/ogg,audio/mp4,application/pdf"
                  onChange={(e) => onFiles(e.target.files)}
                  disabled={uploading}
                />
              </label>
              <Rows
                items={f.media}
                onChange={(media) => set({ media })}
                addLabel="Agregar por URL"
                empty="Sin archivos. El embudo inicial envía, en orden, los marcados como «Embudo inicial»."
                make={(): Media => ({ kind: "image", url: "", usage: "inicial", caption: "" })}
                render={(m, s) => (
                  <div className="grid gap-2 sm:grid-cols-[1fr_9rem_10rem]">
                    <Field label="URL">
                      <input
                        className="input"
                        value={m.url}
                        onChange={(e) =>
                          s({ url: e.target.value, kind: mediaKindFromUrl(e.target.value) })
                        }
                      />
                    </Field>
                    <Field label="Tipo">
                      <select
                        className="input"
                        value={m.kind}
                        onChange={(e) => s({ kind: e.target.value as Media["kind"] })}
                      >
                        {MEDIA_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Uso">
                      <select
                        className="input"
                        value={m.usage}
                        onChange={(e) => s({ usage: e.target.value as Media["usage"] })}
                      >
                        {MEDIA_USAGES.map((u) => (
                          <option key={u} value={u}>
                            {MEDIA_USAGE_LABELS[u]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Descripción para la IA (opcional)">
                      <input
                        className="input"
                        placeholder="Foto real de cliente"
                        value={m.caption ?? ""}
                        onChange={(e) => s({ caption: e.target.value })}
                      />
                    </Field>
                    {m.kind === "image" && m.url && (
                      // biome-ignore lint/performance/noImgElement: vista previa de URL externa
                      <img
                        src={m.url}
                        alt=""
                        className="h-16 w-16 rounded object-cover sm:col-span-2"
                      />
                    )}
                  </div>
                )}
              />
            </>
          )}

          {tab === "Preguntas" && (
            <Rows
              items={f.faqs}
              onChange={(faqs) => set({ faqs })}
              addLabel="Pregunta"
              empty="Sin preguntas frecuentes."
              make={() => ({ question: "", answer: "" })}
              render={(q, s) => (
                <div className="space-y-2">
                  <input
                    className="input"
                    placeholder="Pregunta"
                    value={q.question}
                    onChange={(e) => s({ question: e.target.value })}
                  />
                  <textarea
                    className="input"
                    rows={2}
                    placeholder="Respuesta"
                    value={q.answer}
                    onChange={(e) => s({ answer: e.target.value })}
                  />
                </div>
              )}
            />
          )}

          {tab === "Disparadores" && (
            <>
              <p className="text-sm text-zinc-500">
                Cuando un cliente nuevo escribe una de estas palabras clave o llega desde uno de
                estos anuncios de Meta, el agente usa este producto. Cada disparador solo puede
                pertenecer a un producto.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <TriggerColumn
                  title="Palabras clave"
                  hint="Mensaje o frase que escribe el cliente (ej. el texto predefinido del anuncio)."
                  placeholder="Hola 👋 me interesa el Mega Red"
                  values={f.triggers.filter((t) => t.kind === "keyword").map((t) => t.value)}
                  onChange={(values) =>
                    set({
                      triggers: [
                        ...values.map((value) => ({ kind: "keyword" as const, value })),
                        ...f.triggers.filter((t) => t.kind === "ad_id"),
                      ],
                    })
                  }
                />
                <TriggerColumn
                  title="IDs de anuncio"
                  hint="ID del anuncio de Meta (Click-to-WhatsApp), del Administrador de anuncios."
                  placeholder="120250514665380388"
                  numeric
                  values={f.triggers.filter((t) => t.kind === "ad_id").map((t) => t.value)}
                  onChange={(values) =>
                    set({
                      triggers: [
                        ...f.triggers.filter((t) => t.kind === "keyword"),
                        ...values.map((value) => ({ kind: "ad_id" as const, value })),
                      ],
                    })
                  }
                />
              </div>
            </>
          )}

          {tab === "Upsells" && (
            <Rows
              items={f.upsells}
              onChange={(upsells) => set({ upsells })}
              addLabel="Upsell"
              empty="Sin productos adicionales."
              make={(): Upsell => ({
                name: "",
                description: "",
                price: null,
                dropiProductId: null,
                imageUrl: null,
                moment: "compra_realizada",
                active: true,
              })}
              render={(u, s) => (
                <div className="grid gap-2 sm:grid-cols-[1fr_7rem_10rem]">
                  <Field label="Nombre">
                    <input
                      className="input"
                      value={u.name ?? ""}
                      onChange={(e) => s({ name: e.target.value })}
                    />
                  </Field>
                  <Field label="Precio">
                    <input
                      className="input"
                      inputMode="decimal"
                      value={u.price ?? ""}
                      onChange={(e) => s({ price: e.target.value.replace(",", ".") || null })}
                    />
                  </Field>
                  <Field label="Cuándo ofrecerlo">
                    <select
                      className="input"
                      value={u.moment}
                      onChange={(e) => s({ moment: e.target.value as Upsell["moment"] })}
                    >
                      <option value="durante_venta">Durante la venta</option>
                      <option value="compra_realizada">Después de comprar</option>
                    </select>
                  </Field>
                  <Field label="Descripción">
                    <input
                      className="input"
                      value={u.description ?? ""}
                      onChange={(e) => s({ description: e.target.value })}
                    />
                  </Field>
                  <Field label="ID Dropi">
                    <input
                      className="input"
                      value={u.dropiProductId ?? ""}
                      onChange={(e) => s({ dropiProductId: e.target.value || null })}
                    />
                  </Field>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <input
                      type="checkbox"
                      checked={u.active ?? true}
                      onChange={(e) => s({ active: e.target.checked })}
                    />{" "}
                    Activo
                  </label>
                </div>
              )}
            />
          )}

          {tab === "Seguimiento" && (
            <>
              <div>
                <h3 className="font-medium">Recordatorios</h3>
                <p className="mb-3 text-sm text-zinc-500">
                  Si el cliente deja de responder durante la venta. El tiempo cuenta desde su último
                  mensaje; solo se envía en el horario de la tienda y se reinicia cuando vuelve a
                  escribir. Ejemplo: 30 min «¿Sigues interesado?» y 1380 min (23 h) antes de que se
                  cierre la ventana de 24 h de WhatsApp. Pasadas 24 h solo se envía la plantilla.
                </p>
                <StepsEditor
                  kind="reminders"
                  steps={f.followUps.reminders}
                  onChange={(reminders) => set({ followUps: { ...f.followUps, reminders } })}
                />
              </div>
              <div>
                <h3 className="font-medium">Remarketing</h3>
                <p className="mb-3 text-sm text-zinc-500">
                  Si no compró, días después. Se activa en la Fase 7.
                </p>
                <StepsEditor
                  kind="remarketing"
                  steps={f.followUps.remarketing}
                  onChange={(remarketing) => set({ followUps: { ...f.followUps, remarketing } })}
                />
              </div>
            </>
          )}
        </div>
      )}

      {tab !== "Prompt" && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn"
            disabled={busy || !f.name || !f.price}
            onClick={save}
          >
            {productId ? "Guardar cambios" : "Crear producto"}
          </button>
          {saved && (
            <span className="text-sm text-emerald-700 dark:text-emerald-400">Guardado ✓</span>
          )}
          {productId && (
            <button
              type="button"
              className="ml-auto text-sm text-red-600 hover:underline"
              onClick={remove}
            >
              Eliminar producto
            </button>
          )}
          <div className="w-full">
            <ErrorText>{error}</ErrorText>
          </div>
        </div>
      )}
    </div>
  );
}
