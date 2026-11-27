"use client";
/** Formulario de pedido compartido por Pedidos y la ficha de la conversación. */
import { Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { type FingerprintData, FingerprintView } from "@/components/Fingerprint";
import { ErrorText } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type ProductRow = { id: string; name: string; price: string; currency: string; status: string };
type ProductDetail = ProductRow & {
  offers: { quantity: number; totalPrice: string; label?: string | null }[];
  variants: { name: string; price: string | null }[];
};
export type Line = { productId: string; quantity: number; variant: string };

/** Precio como lo calcula el API: oferta por cantidad, si no variante/producto × cantidad. */
function linePrice(p: ProductDetail | undefined, l: Line) {
  if (!p) return 0;
  const offer = p.offers.find((o) => o.quantity === l.quantity);
  if (offer) return Number(offer.totalPrice);
  const v = p.variants.find((x) => x.name === l.variant);
  return Number(v?.price ?? p.price) * l.quantity;
}

const EMPTY_CUSTOMER = {
  nombre: "",
  apellido: "",
  telefono: "",
  provincia: "",
  ciudad: "",
  direccion: "",
  referencia: "",
};

type Places = {
  departments: { id: number; name: string }[];
  cities: { id: number; name: string; departmentId: number | null }[];
  unavailable?: string;
};
type AgencyOpt = {
  /** NOMBRE---SECTOR---DIRECCIÓN: así se registra el retiro en la guía. */
  registro: string;
  /** Nombre en Servientrega, p. ej. QUITO_GUAJALO. */
  nombre: string;
  nombreCorto: string;
  sector: string;
  direccion: string;
  horario: string;
};

const fold = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Huellas ya consultadas en esta pestaña: el mismo teléfono no vuelve a pedirse. */
const fingerprintCache = new Map<string, FingerprintData>();

/**
 * Huella del teléfono escrito: espera a que se termine de escribir y consulta una sola vez
 * por número (el API además guarda la respuesta de Dropi varias horas).
 */
function PhoneFingerprint({ phone }: { phone: string }) {
  const digits = phone.replace(/\D/g, "");
  const [data, setData] = useState<FingerprintData | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setData(null);
    if (digits.length < 9) return;
    const cached = fingerprintCache.get(digits);
    if (cached) {
      setData(cached);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      api<FingerprintData>(`/api/fingerprint?phone=${digits}`)
        .then((d) => {
          fingerprintCache.set(digits, d);
          if (alive) setData(d);
        })
        .catch(() => {})
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 800);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [digits]);
  if (loading) return <p className="text-xs text-zinc-500">Consultando huella…</p>;
  return data ? <FingerprintView data={data} /> : null;
}

/** Buscador de agencias Servientrega con retiro en la ciudad elegida. */
function AgencyPicker({
  ciudad,
  value,
  onPick,
}: {
  ciudad: string;
  value: AgencyOpt | null;
  onPick: (a: AgencyOpt | null) => void;
}) {
  const [list, setList] = useState<AgencyOpt[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    setList(null);
    setQ("");
    if (!ciudad) return;
    let alive = true;
    api<{ agencies: AgencyOpt[] }>(`/api/agencies?ciudad=${encodeURIComponent(ciudad)}`)
      .then((r) => {
        if (alive) setList(r.agencies);
      })
      .catch(() => {
        if (alive) setList([]);
      });
    return () => {
      alive = false;
    };
  }, [ciudad]);

  if (!ciudad)
    return <p className="text-xs text-zinc-500">Elige primero la ciudad para ver sus agencias.</p>;
  if (value)
    return (
      <div className="flex items-start gap-2 rounded-lg border border-brand-300 bg-brand-50/50 p-2 text-sm dark:border-brand-800 dark:bg-brand-950/30">
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {value.nombre}
            {value.sector ? ` · ${value.sector}` : ""}
          </div>
          <div className="text-xs text-zinc-500">{value.direccion}</div>
          {value.horario && <div className="text-xs text-zinc-500">{value.horario}</div>}
        </div>
        <button type="button" className="btn-ghost" onClick={() => onPick(null)}>
          Cambiar
        </button>
      </div>
    );
  if (!list) return <p className="text-xs text-zinc-500">Buscando agencias…</p>;
  if (!list.length)
    return (
      <p className="text-xs text-amber-700 dark:text-amber-400">
        No hay agencias Servientrega con retiro en {ciudad}. Usa entrega a domicilio.
      </p>
    );
  const needle = fold(q.trim());
  const shown = list.filter((a) =>
    fold(`${a.nombre} ${a.nombreCorto} ${a.sector} ${a.direccion}`).includes(needle),
  );
  return (
    <div className="space-y-1">
      <input
        className="input"
        placeholder={`Buscar entre ${list.length} agencias por nombre, sector o dirección`}
        aria-label="Buscar agencia Servientrega"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="max-h-56 divide-y divide-zinc-200 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {shown.map((a) => (
          <li key={a.registro}>
            <button
              type="button"
              className="w-full p-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
              onClick={() => onPick(a)}
            >
              <div className="font-medium">
                {a.nombre}
                {a.sector ? <span className="font-normal text-zinc-500"> · {a.sector}</span> : null}
              </div>
              <div className="text-xs text-zinc-500">{a.direccion}</div>
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="p-2 text-sm text-zinc-500">Ninguna agencia coincide.</li>
        )}
      </ul>
    </div>
  );
}

/** Datos con los que se abre el formulario (pedido a corregir o lo que juntó el chat). */
export type OrderFormInitial = {
  customer?: Partial<typeof EMPTY_CUSTOMER> & { agencia?: string };
  lines?: Line[];
  total?: string;
  rateType?: string;
  notes?: string;
};

/** NOMBRE---SECTOR---DIRECCIÓN guardado → agencia elegida (para volver a mostrarla). */
function agencyFromRegistro(registro: string): AgencyOpt {
  const [nombre = "", sector = "", direccion = ""] = registro.split("---");
  return { registro, nombre, nombreCorto: nombre, sector, direccion, horario: "" };
}

/**
 * Formulario de pedido: datos del cliente, productos con el precio del catálogo y, si se
 * quiere, subida a Dropi en el mismo paso. Sirve para ingresar un pedido a mano (Pedidos),
 * para armarlo desde una conversación con lo que juntó el chat y para corregir uno que aún
 * no está en Dropi antes de subirlo.
 */
export function OrderFormPanel({
  onClose,
  onCreated,
  initial,
  orderId,
  conversationId,
  title = "Nuevo pedido",
  subtitle = "Para ventas por llamada, en el local o por otra red social.",
  uploadByDefault,
}: {
  onClose: () => void;
  onCreated: (orderId: string, result?: { status: string } | null) => void;
  initial?: OrderFormInitial;
  /** Corregir este pedido (aún sin subir) en vez de crear uno nuevo. */
  orderId?: string;
  /** Crear el pedido ligado a esta conversación. */
  conversationId?: string;
  title?: string;
  subtitle?: string;
  /** Marcar «Subir a Dropi al guardar» de entrada (si Dropi está conectado). */
  uploadByDefault?: boolean;
}) {
  const startAgency = initial?.customer?.agencia
    ? agencyFromRegistro(initial.customer.agencia)
    : null;
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [details, setDetails] = useState<Record<string, ProductDetail>>({});
  const [customer, setCustomer] = useState({ ...EMPTY_CUSTOMER, ...initial?.customer });
  const [lines, setLines] = useState<Line[]>(initial?.lines ?? []);
  const [total, setTotal] = useState(initial?.total ?? "");
  /** El asesor escribió el total: deja de seguir al precio del catálogo. */
  const [totalTouched, setTotalTouched] = useState(Boolean(initial?.total));
  const [rateType, setRateType] = useState(initial?.rateType ?? "CON RECAUDO");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [upload, setUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [places, setPlaces] = useState<Places | null>(null);
  const [placesError, setPlacesError] = useState("");
  const [delivery, setDelivery] = useState<"domicilio" | "agencia">(
    startAgency ? "agencia" : "domicilio",
  );
  const [agency, setAgency] = useState<AgencyOpt | null>(startAgency);
  /** Dirección de la agencia, editable (p. ej. «retira su hermano Juan»). */
  const [agencyText, setAgencyText] = useState(startAgency?.registro ?? "");
  /** Se intentó crear: desde ahí se marcan en rojo los campos que faltan. */
  const [tried, setTried] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: carga única al abrir el formulario
  useEffect(() => {
    // Provincias y ciudades tal cual las tiene Dropi (la ciudad depende de la provincia).
    api<Places>("/api/places")
      .then((p) => {
        setPlaces(p);
        // Lo que escribió el cliente («Pichincha», «quito») se lleva al nombre exacto de Dropi.
        setCustomer((c) => {
          const dep = p.departments.find((d) => fold(d.name) === fold(c.provincia));
          const city = p.cities.find(
            (x) => fold(x.name) === fold(c.ciudad) && (!dep || x.departmentId === dep.id),
          );
          const depOfCity = city && p.departments.find((d) => d.id === city.departmentId);
          return {
            ...c,
            provincia: dep?.name ?? depOfCity?.name ?? c.provincia,
            ciudad: city?.name ?? c.ciudad,
          };
        });
      })
      .catch((e) => {
        setPlaces({ departments: [], cities: [], unavailable: "error" });
        setPlacesError(errorMessage(e));
      });
    // Si la tienda envía todo a agencia, el pedido arranca en «retiro en agencia».
    if (!initial)
      api<{ mode: string }>("/api/agencies")
        .then((r) => {
          if (r.mode === "solo") setDelivery("agencia");
        })
        .catch(() => {});
    api<ProductRow[]>("/api/products")
      .then((rows) => {
        const list = rows.filter((r) => r.status !== "inactivo");
        setProducts(list);
        setLines((ls) =>
          ls.length ? ls : list[0] ? [{ productId: list[0].id, quantity: 1, variant: "" }] : [],
        );
      })
      .catch((e) => setError(errorMessage(e)));
    // Solo dueños/admin leen la integración; si responde, se sugiere subir al guardar.
    api<{ connected?: boolean }>("/api/integrations/dropi")
      .then((d) => setUpload(Boolean(d.connected) && uploadByDefault !== false))
      .catch(() => {});
  }, []);

  // Ofertas y variantes de cada producto elegido (para el precio y el selector).
  useEffect(() => {
    for (const l of lines)
      if (l.productId && !details[l.productId])
        api<ProductDetail>(`/api/products/${l.productId}`)
          .then((d) => setDetails((x) => ({ ...x, [d.id]: d })))
          .catch(() => {});
  }, [lines, details]);

  const computed = lines.reduce((sum, l) => sum + linePrice(details[l.productId], l), 0);
  // El total arranca con el precio del catálogo (ofertas incluidas) y se puede cambiar.
  useEffect(() => {
    if (!totalTouched) setTotal(computed > 0 ? computed.toFixed(2) : "");
  }, [computed, totalTouched]);
  const currency = details[lines[0]?.productId ?? ""]?.currency ?? products[0]?.currency ?? "";
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const field = (key: keyof typeof EMPTY_CUSTOMER) => ({
    value: customer[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setCustomer({ ...customer, [key]: e.target.value }),
  });

  const hasPlaces = Boolean(places?.departments.length);
  const dept = places?.departments.find((d) => d.name === customer.provincia);
  const cities = dept ? (places?.cities ?? []).filter((c) => c.departmentId === dept.id) : [];
  const setPlace = (patch: { provincia?: string; ciudad?: string }) => {
    // Cambiar de ciudad invalida la agencia elegida.
    setAgency(null);
    setCustomer((c) => ({
      ...c,
      ...patch,
      ...(delivery === "agencia" ? { direccion: "" } : {}),
    }));
  };
  const switchDelivery = (d: "domicilio" | "agencia") => {
    if (d === delivery) return;
    setDelivery(d);
    setAgency(null);
    setCustomer((c) => ({ ...c, direccion: "", referencia: "" }));
  };
  const pickAgency = (a: AgencyOpt | null) => {
    setAgency(a);
    // Se llena como la guía: NOMBRE---SECTOR---DIRECCIÓN (QUITO_GUAJALO---SUR---AV. …).
    setAgencyText(a?.registro ?? "");
    setCustomer((c) => ({ ...c, direccion: a?.registro ?? "", referencia: "" }));
  };
  /**
   * NOMBRE---SECTOR---DIRECCIÓN como lo dejó el asesor. Si borró los separadores, se
   * vuelven a poner el nombre y el sector de la agencia para no romper el formato de la guía.
   */
  const agencyRegistro = (a: AgencyOpt) => {
    const text = agencyText.trim();
    if (!text) return a.registro;
    if (text.split("---").length >= 3) return text;
    const [nombre = "", sector = ""] = a.registro.split("---");
    return [nombre, sector, text.replace(/---/g, " ")].join("---");
  };

  const phoneDigits = customer.telefono.replace(/\D/g, "");
  const totalNum = Number(total.replace(",", "."));
  /** Lo que falta para poder crear el pedido, en el orden del formulario. */
  const missing = [
    !customer.nombre.trim() && { key: "nombre", label: "nombre", msg: "Ingresa el nombre." },
    !customer.apellido.trim() && {
      key: "apellido",
      label: "apellido",
      msg: "Ingresa el apellido.",
    },
    phoneDigits.length < 9 && {
      key: "telefono",
      label: phoneDigits ? "teléfono completo" : "teléfono",
      msg: phoneDigits
        ? "El teléfono está incompleto (mínimo 9 dígitos)."
        : "Ingresa el teléfono o WhatsApp.",
    },
    hasPlaces &&
      !customer.provincia && { key: "provincia", label: "provincia", msg: "Elige la provincia." },
    !customer.ciudad.trim() && { key: "ciudad", label: "ciudad", msg: "Elige la ciudad." },
    delivery === "domicilio" &&
      customer.direccion.trim().length < 3 && {
        key: "direccion",
        label: "dirección",
        msg: "Ingresa la dirección de entrega.",
      },
    delivery === "agencia" &&
      !agency && {
        key: "agencia",
        label: "agencia Servientrega",
        msg: "Elige la agencia Servientrega donde retira el cliente.",
      },
    !lines.some((l) => l.productId) && {
      key: "productos",
      label: "producto",
      msg: "Agrega al menos un producto.",
    },
    !(totalNum > 0) && {
      key: "total",
      label: "total a cobrar",
      msg: total.trim() ? "El total debe ser mayor a 0." : "Ingresa el total a cobrar.",
    },
  ].filter(Boolean) as { key: string; label: string; msg: string }[];
  const bad = (k: string) => tried && missing.some((m) => m.key === k);
  /** Mensaje debajo del campo que falta. */
  const hint = (k: string) => {
    const m = tried ? missing.find((x) => x.key === k) : undefined;
    return m ? (
      <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{m.msg}</span>
    ) : null;
  };
  /** Clase y aria del campo según si falta. */
  const mark = (k: string) => ({
    "aria-invalid": bad(k) || undefined,
    className: `input${bad(k) ? " border-red-500 ring-1 ring-red-500" : ""}`,
  });

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTried(true);
    if (missing.length) {
      setError("");
      // Lleva al primer campo que falta.
      const form = e.currentTarget;
      requestAnimationFrame(() =>
        (form.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus(),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await api<{ order: { id: string }; result: { status: string } | null }>(
        orderId ? `/api/orders/${orderId}` : "/api/orders",
        {
          method: orderId ? "PUT" : "POST",
          body: {
            ...(conversationId && !orderId ? { conversationId } : {}),
            customer:
              delivery === "agencia" && agency
                ? {
                    ...customer,
                    direccion: agencyRegistro(agency),
                    referencia: "",
                    agencia: agencyRegistro(agency),
                  }
                : customer,
            items: lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              ...(l.variant ? { variant: l.variant } : {}),
            })),
            total: totalNum,
            rateType,
            notes,
            upload,
          },
        },
      );
      onCreated(r.order.id, r.result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      {/* Fondo sin acción: un clic afuera no debe perder lo escrito. Se cierra con ✕ o Cancelar. */}
      <div className="absolute inset-0" aria-hidden />
      <form
        onSubmit={save}
        noValidate
        className="relative h-full w-full max-w-md space-y-4 overflow-y-auto bg-white p-5 shadow-xl dark:bg-zinc-950"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-sm text-zinc-500">{subtitle}</p>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Cerrar">
            <X className="size-4" />
          </button>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Cliente</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">Nombre</span>
              <input {...mark("nombre")} {...field("nombre")} />
              {hint("nombre")}
            </label>
            <label className="block">
              <span className="label">Apellido</span>
              <input {...mark("apellido")} {...field("apellido")} />
              {hint("apellido")}
            </label>
          </div>
          <label className="block">
            <span className="label">Teléfono / WhatsApp</span>
            <input
              {...mark("telefono")}
              inputMode="tel"
              placeholder="0991234567"
              {...field("telefono")}
            />
            {hint("telefono")}
          </label>
          <PhoneFingerprint phone={customer.telefono} />
          {!places ? (
            <p className="text-xs text-zinc-500">Cargando provincias y ciudades de Dropi…</p>
          ) : hasPlaces ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="label">Provincia</span>
                <select
                  {...mark("provincia")}
                  value={customer.provincia}
                  onChange={(e) => setPlace({ provincia: e.target.value, ciudad: "" })}
                >
                  <option value="">Elige…</option>
                  {places.departments.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {hint("provincia")}
              </label>
              <label className="block">
                <span className="label">Ciudad</span>
                <select
                  {...mark("ciudad")}
                  disabled={!dept}
                  value={customer.ciudad}
                  onChange={(e) => setPlace({ ciudad: e.target.value })}
                >
                  <option value="">{dept ? "Elige…" : "Primero la provincia"}</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {hint("ciudad")}
              </label>
            </div>
          ) : (
            <>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {placesError ||
                  "Conecta Dropi (Integraciones → Dropi) para elegir provincia y ciudad de su lista."}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="label">Provincia</span>
                  <input className="input" {...field("provincia")} />
                </label>
                <label className="block">
                  <span className="label">Ciudad</span>
                  <input {...mark("ciudad")} {...field("ciudad")} />
                  {hint("ciudad")}
                </label>
              </div>
            </>
          )}

          <fieldset>
            <legend className="label">Entrega</legend>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-200 p-1 dark:border-zinc-800">
              {(
                [
                  ["domicilio", "A domicilio"],
                  ["agencia", "Retiro en agencia Servientrega"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={delivery === k}
                  onClick={() => switchDelivery(k)}
                  className={`rounded-md px-2 py-1.5 text-sm ${
                    delivery === k
                      ? "bg-brand-600 text-brand-ink"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          {delivery === "domicilio" ? (
            <>
              <label className="block">
                <span className="label">Dirección</span>
                <input {...mark("direccion")} {...field("direccion")} />
                {hint("direccion")}
              </label>
              <label className="block">
                <span className="label">Referencia</span>
                <input className="input" placeholder="Cerca de…" {...field("referencia")} />
              </label>
            </>
          ) : (
            <div className="space-y-2">
              <label className="block">
                <span className="label">
                  Dirección de la agencia
                  {agency && (
                    <span className="font-normal text-zinc-500">
                      {" "}
                      · nombre---sector---dirección; puedes agregar indicaciones al final
                    </span>
                  )}
                </span>
                <input
                  className="input"
                  disabled={!agency}
                  placeholder="Se llena al elegir la agencia"
                  value={agencyText}
                  onChange={(e) => setAgencyText(e.target.value)}
                />
              </label>
              <AgencyPicker ciudad={customer.ciudad} value={agency} onPick={pickAgency} />
              {hint("agencia")}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Productos</h3>
          {products.length === 0 && (
            <p className="text-sm text-zinc-500">
              No hay productos en el catálogo.{" "}
              <Link href="/panel/catalogo" className="underline">
                Crea uno primero
              </Link>
              .
            </p>
          )}
          {lines.map((l, i) => {
            const d = details[l.productId];
            const offer = d?.offers.find((o) => o.quantity === l.quantity);
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: líneas sin id propio
                key={i}
                className="space-y-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800"
              >
                <div className="flex gap-2">
                  <select
                    className="input min-w-0 flex-1"
                    aria-label="Producto"
                    value={l.productId}
                    onChange={(e) => setLine(i, { productId: e.target.value, variant: "" })}
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input w-20"
                    type="number"
                    min={1}
                    max={99}
                    aria-label="Cantidad"
                    value={l.quantity}
                    onChange={(e) =>
                      setLine(i, { quantity: Math.max(1, Number(e.target.value) || 1) })
                    }
                  />
                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="btn-ghost"
                      aria-label="Quitar producto"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                {d && d.variants.length > 0 && (
                  <select
                    className="input"
                    aria-label="Variante"
                    value={l.variant}
                    onChange={(e) => setLine(i, { variant: e.target.value })}
                  >
                    <option value="">Sin variante</option>
                    {d.variants.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                        {v.price ? ` · ${Number(v.price).toFixed(2)}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                <div className="text-xs text-zinc-500">
                  {d
                    ? `${linePrice(d, l).toFixed(2)} ${d.currency}${offer ? ` · oferta ${offer.label || `${offer.quantity} unidades`}` : ""}`
                    : "Calculando precio…"}
                </div>
              </div>
            );
          })}
          {products.length > 0 && lines.length < 10 && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() =>
                setLines((ls) => [
                  ...ls,
                  { productId: products[0]?.id ?? "", quantity: 1, variant: "" },
                ])
              }
            >
              <Plus className="size-4" /> Otro producto
            </button>
          )}
        </section>

        <section className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">Total a cobrar</span>
              <input
                {...mark("total")}
                inputMode="decimal"
                placeholder="0.00"
                value={total}
                onChange={(e) => {
                  setTotalTouched(true);
                  setTotal(e.target.value);
                }}
              />
              {hint("total")}
              <span className="mt-1 block text-xs text-zinc-500">
                Catálogo: {computed.toFixed(2)} {currency}
                {totalTouched && Math.abs(totalNum - computed) > 0.004 && computed > 0 && (
                  <button
                    type="button"
                    className="ml-1 underline"
                    onClick={() => setTotalTouched(false)}
                  >
                    usar este
                  </button>
                )}
              </span>
            </label>
            <label className="block">
              <span className="label">Cobro</span>
              <select
                className="input"
                value={rateType}
                onChange={(e) => setRateType(e.target.value)}
              >
                <option value="CON RECAUDO">Contra entrega</option>
                <option value="SIN RECAUDO">Ya pagado</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="label">Notas</span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={upload} onChange={(e) => setUpload(e.target.checked)} />
            Subir a Dropi al guardar
          </label>
        </section>

        {tried && missing.length > 0 && (
          <div
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          >
            <div className="font-medium">Para {orderId ? "guardar" : "crear"} el pedido falta:</div>
            <ul className="mt-1 list-disc pl-5">
              {missing.map((m) => (
                <li key={m.key}>{m.label}</li>
              ))}
            </ul>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <button type="submit" className="btn" disabled={busy || lines.length === 0}>
            {busy
              ? upload
                ? "Guardando y subiendo…"
                : "Guardando…"
              : upload
                ? `${orderId ? "Guardar" : "Crear"} y subir a Dropi`
                : orderId
                  ? "Guardar cambios"
                  : "Crear pedido"}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
