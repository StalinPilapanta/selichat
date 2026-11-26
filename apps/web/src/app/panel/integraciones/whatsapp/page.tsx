"use client";
import { NOTICE_INFO, SUGGESTED_TEMPLATES } from "@chatea/shared";
import { MessageCircle, Pencil, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorText, PageHeader } from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";

type Channel = {
  id: string;
  name: string;
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string;
  verifiedName: string;
  status: string;
  lastError: string | null;
  webhookVerifiedAt: string | null;
  lastEventAt: string | null;
  webhookUrl: string;
  verifyToken: string;
};
type Template = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejectedReason: string | null;
  components: { type: string; text?: string; example?: { body_text?: string[][] } }[];
};

const STATUS_STYLE: Record<string, string> = {
  APPROVED: "bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function Copy({ value, label }: { value: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex gap-2">
        <input className="input font-mono text-xs" readOnly value={value} aria-label={label} />
        <button
          type="button"
          className="btn-ghost shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(value);
            setOk(true);
            setTimeout(() => setOk(false), 1500);
          }}
        >
          {ok ? "Copiado ✓" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

type StepResult = { ok: true; note?: string } | { ok: false; error: string };
type Setup = {
  subscribed: StepResult;
  appWebhook: StepResult;
  webhook: StepResult;
  ready: boolean;
};
type Account = { id: string; name: string };
type Discovered = {
  app: { id: string; name: string };
  accounts: Account[];
  token: { permanent: boolean; expiresAt: string | null; type: string | null };
  missingScopes: string[];
  warnings: string[];
  numbers: {
    phoneNumberId: string;
    wabaId: string;
    wabaName: string;
    displayPhone: string;
    verifiedName: string;
    qualityRating: string | null;
    status: string | null;
    alreadyConnected: boolean;
  }[];
};

const metaLink = (href: string, text: string) => (
  <a className="underline" href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);
// Solo páginas de inicio: los enlaces profundos de Meta fallan según la cuenta o el portafolio.
const businessHome = metaLink("https://business.facebook.com/", "business.facebook.com");
const developersHome = metaLink("https://developers.facebook.com/", "developers.facebook.com");

/** Cómo conseguir en Meta lo que pide Selichat, con el camino desde la página de inicio. */
function MetaGuide() {
  return (
    <ol className="mt-2 list-decimal space-y-3 pl-5 text-zinc-600 dark:text-zinc-400">
      <li>
        <b>App de Meta.</b> Entra a {developersHome} → arriba a la derecha <b>Mis apps</b>. Si ya
        tienes una app con WhatsApp, usa esa. Si no: <b>Crear app</b> → caso de uso{" "}
        <b>«Conectar con clientes a través de WhatsApp»</b> → vincúlala a tu portafolio comercial.
        Si Meta te pide aceptar las <b>Condiciones para desarrolladores</b>, acéptalas: sin eso no
        se puede registrar el número.
      </li>
      <li>
        <b>Cuenta de WhatsApp.</b> Entra a {businessHome} → elige tu portafolio (arriba a la
        izquierda) → <b>Configuración</b> (engranaje, abajo a la izquierda) → <b>Cuentas</b> →{" "}
        <b>Cuentas de WhatsApp</b>. Si ya aparece una, listo. Si no hay ninguna, pulsa{" "}
        <b>Agregar</b> y créala; el número lo puedes agregar después desde Selichat.
      </li>
      <li>
        <b>Usuario del sistema y token.</b> En esa misma Configuración → <b>Usuarios</b> →{" "}
        <b>Usuarios del sistema</b>:
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            <b>Agregar</b> → un nombre (p. ej. «Selichat») → rol <b>Administrador</b>. Si Meta dice
            que no puedes crear otro administrador, es porque un portafolio sin verificar admite
            solo uno: usa el que ya aparece en la lista. No lo borres, porque los tokens que ya
            generó dejarían de funcionar.
          </li>
          <li>
            Elige el usuario → <b>Asignar activos</b> → <b>Apps</b> → tu app → <b>control total</b>.
            Repite con <b>Cuentas de WhatsApp</b> → tu cuenta → <b>control total</b>.
          </li>
          <li>
            <b>Generar token</b> → elige tu app → vencimiento <b>«Nunca»</b> → marca{" "}
            <code>business_management</code>, <code>whatsapp_business_messaging</code> y{" "}
            <code>whatsapp_business_management</code> → copia el token (Meta lo muestra una sola
            vez).
          </li>
        </ul>
      </li>
      <li>
        <b>Clave secreta de la app.</b> En {developersHome} → <b>Mis apps</b> → tu app → menú{" "}
        <b>Configuración de la app</b> → <b>Básica</b> → <b>Clave secreta de la app</b> →{" "}
        <b>Mostrar</b> → cópiala.
      </li>
    </ol>
  );
}

type NewNumber = {
  phoneNumberId: string;
  displayPhone: string;
  wabaId: string;
  verifiedName: string;
  /** PIN con el que Selichat lo registró ("" si ya estaba registrado). */
  pin: string;
};

/**
 * Agrega un número nuevo sin entrar a Meta: lo crea en la cuenta de WhatsApp,
 * manda el código, lo verifica y lo registra con un PIN que genera Selichat.
 */
function AddNumber({
  accessToken,
  accounts,
  onDone,
  onCancel,
}: {
  accessToken: string;
  accounts: Account[];
  onDone: (n: NewNumber) => void;
  onCancel?: () => void;
}) {
  const [f, setF] = useState({
    wabaId: accounts[0]?.id ?? "",
    cc: "593",
    phone: "",
    displayName: "",
    method: "SMS" as "SMS" | "VOICE",
  });
  const [sent, setSent] = useState<{
    phoneNumberId: string;
    displayPhone: string;
    needsCode: boolean;
  } | null>(null);
  const [code, setCode] = useState("");
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      // El código ya se verificó y falló solo el registro: el siguiente intento no lo pide.
      if (err instanceof ApiError && err.code === "whatsapp_registro_fallido")
        setSent((x) => x && { ...x, needsCode: false });
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const r = await api<{
        phoneNumberId: string;
        displayPhone: string;
        alreadyVerified: boolean;
        alreadyRegistered: boolean;
      }>("/api/channels/add-number", { method: "POST", body: { accessToken, ...f } });
      if (r.alreadyRegistered) {
        onDone({ ...r, wabaId: f.wabaId, verifiedName: f.displayName, pin: "" });
        return;
      }
      setSent({ ...r, needsCode: !r.alreadyVerified });
      setInfo(
        r.alreadyVerified
          ? "Este número ya estaba verificado: solo falta registrarlo."
          : `Meta mandó un código ${f.method === "SMS" ? "por SMS" : "por llamada"} al ${r.displayPhone}.`,
      );
    });
  };

  const resend = (method: "SMS" | "VOICE") =>
    run(async () => {
      if (!sent) return;
      await api("/api/channels/resend-code", {
        method: "POST",
        body: { accessToken, phoneNumberId: sent.phoneNumberId, method },
      });
      setInfo(
        method === "SMS" ? "Te mandamos otro SMS." : "Meta te va a llamar para dictarte el código.",
      );
    });

  const verify = () =>
    run(async () => {
      if (!sent) return;
      const r = await api<{ pin: string }>("/api/channels/verify-number", {
        method: "POST",
        body: {
          accessToken,
          phoneNumberId: sent.phoneNumberId,
          code: sent.needsCode ? code : null,
        },
      });
      onDone({
        phoneNumberId: sent.phoneNumberId,
        displayPhone: sent.displayPhone,
        wabaId: f.wabaId,
        verifiedName: f.displayName,
        pin: r.pin,
      });
    });

  const box =
    "space-y-3 rounded-lg border border-brand-200 bg-brand-50/50 p-4 text-sm dark:border-brand-900 dark:bg-brand-950/30";

  if (sent)
    return (
      <div className={box}>
        <div className="font-medium">Verifica el número {sent.displayPhone}</div>
        {info && <p className="text-zinc-600 dark:text-zinc-400">{info}</p>}
        {sent.needsCode && (
          <input
            className="input max-w-[10rem] font-mono tracking-widest"
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            aria-label="Código de verificación"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            disabled={busy || (sent.needsCode && code.length !== 6)}
            onClick={verify}
          >
            {busy ? "Registrando en Meta…" : "Verificar y registrar"}
          </button>
          {sent.needsCode && (
            <>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => resend("SMS")}
              >
                Reenviar SMS
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => resend("VOICE")}
              >
                Mejor llámame
              </button>
            </>
          )}
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => {
              setSent(null);
              setCode("");
              setError("");
            }}
          >
            Cambiar número
          </button>
        </div>
      </div>
    );

  return (
    <form onSubmit={send} className={box}>
      <div className="font-medium">Agregar un número nuevo</div>
      <p className="text-zinc-600 dark:text-zinc-400">
        El número <b>no puede estar activo</b> en la app de WhatsApp ni en WhatsApp Business. Si lo
        está, bórralo primero desde el teléfono: Ajustes → Cuenta → Eliminar cuenta. Debe poder
        recibir un SMS o una llamada.
      </p>
      {accounts.length > 1 && (
        <label className="block max-w-sm">
          <span className="label">Cuenta de WhatsApp</span>
          <select
            className="input"
            value={f.wabaId}
            onChange={(e) => setF({ ...f, wabaId: e.target.value })}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="block w-24">
          <span className="label">País</span>
          <input
            className="input font-mono"
            required
            inputMode="numeric"
            value={f.cc}
            onChange={(e) => setF({ ...f, cc: e.target.value.replace(/[^\d+]/g, "") })}
          />
        </label>
        <label className="block min-w-[12rem] flex-1">
          <span className="label">Número</span>
          <input
            className="input font-mono"
            required
            inputMode="tel"
            placeholder="0963268008"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
        </label>
      </div>
      <label className="block">
        <span className="label">Nombre que verán tus clientes</span>
        <input
          className="input"
          required
          minLength={3}
          maxLength={120}
          placeholder="Mi Tienda EC"
          value={f.displayName}
          onChange={(e) => setF({ ...f, displayName: e.target.value })}
        />
        <span className="mt-1 block text-xs text-zinc-500">
          Usa el nombre de tu negocio como aparece en tu web o redes. Meta lo revisa aparte; no uses
          «WhatsApp», «oficial» ni solo palabras genéricas.
        </span>
      </label>
      <fieldset className="flex gap-4">
        <legend className="label">Enviar el código por</legend>
        {(["SMS", "VOICE"] as const).map((m) => (
          <label key={m} className="flex items-center gap-1">
            <input
              type="radio"
              name="metodo"
              checked={f.method === m}
              onChange={() => setF({ ...f, method: m })}
            />
            {m === "SMS" ? "SMS" : "Llamada"}
          </label>
        ))}
      </fieldset>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <button type="submit" className="btn" disabled={busy || !f.wabaId}>
          {busy ? "Agregando en Meta…" : "Enviar código"}
        </button>
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

/** Lista de verificación del resultado de la configuración automática. */
function SetupChecklist({ setup }: { setup: Setup }) {
  const rows: [string, StepResult][] = [
    ["App suscrita a tu cuenta de WhatsApp", setup.subscribed],
    ["Webhook de la app", setup.appWebhook],
    ["Webhook de este número apuntando a Selichat", setup.webhook],
  ];
  return (
    <div className="space-y-1 text-sm">
      {rows.map(([label, r]) => (
        <div key={label}>
          <span className={r.ok ? "text-brand-700 dark:text-brand-400" : "text-red-600"}>
            {r.ok ? "✓" : "✗"}
          </span>{" "}
          {label}
          {r.ok && r.note && <span className="text-zinc-500"> · {r.note}</span>}
          {!r.ok && <span className="text-zinc-500"> · {r.error}</span>}
        </div>
      ))}
      <div
        className={`pt-1 font-medium ${setup.ready ? "text-brand-700 dark:text-brand-400" : "text-amber-700 dark:text-amber-400"}`}
      >
        {setup.ready
          ? "Listo: los mensajes de WhatsApp llegarán a Conversaciones."
          : "Falta configurar el webhook. Usa los datos de «Configuración manual del webhook» del número."}
      </div>
    </div>
  );
}

/**
 * Conexión manual en 3 pasos: la tienda pega token + App Secret, elige el número
 * y Selichat configura el resto (suscripción y webhook) por su cuenta.
 */
function ConnectForm({ onDone }: { onDone: () => void }) {
  const [creds, setCreds] = useState({ accessToken: "", appSecret: "" });
  const [found, setFound] = useState<Discovered | null>(null);
  const [pick, setPick] = useState("");
  const [name, setName] = useState("WhatsApp principal");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [pin, setPin] = useState("");
  const [registered, setRegistered] = useState("");
  const [adding, setAdding] = useState(false);
  /** PIN con el que se registró cada número en esta conexión (se guarda cifrado con el canal). */
  const [pins, setPins] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function numberAdded(n: NewNumber) {
    setFound(
      (f) =>
        f && {
          ...f,
          numbers: [
            ...f.numbers.filter((x) => x.phoneNumberId !== n.phoneNumberId),
            {
              phoneNumberId: n.phoneNumberId,
              wabaId: n.wabaId,
              wabaName: f.accounts.find((a) => a.id === n.wabaId)?.name ?? n.wabaId,
              displayPhone: n.displayPhone,
              verifiedName: n.verifiedName,
              qualityRating: null,
              status: "CONNECTED",
              alreadyConnected: false,
            },
          ],
        },
    );
    setPick(n.phoneNumberId);
    if (n.pin) setPins((p) => ({ ...p, [n.phoneNumberId]: n.pin }));
    setAdding(false);
    setRegistered(
      n.pin
        ? `Número registrado en Meta con el PIN ${n.pin} (verificación en dos pasos). Selichat lo guarda cifrado; anótalo por si Meta te lo pide.`
        : "Este número ya estaba registrado en Meta.",
    );
  }

  async function registerPicked() {
    setBusy(true);
    setError("");
    try {
      await api("/api/channels/register-number", {
        method: "POST",
        body: { accessToken: creds.accessToken, phoneNumberId: pick, pin },
      });
      setFound(
        (f) =>
          f && {
            ...f,
            numbers: f.numbers.map((n) =>
              n.phoneNumberId === pick ? { ...n, status: "CONNECTED" } : n,
            ),
          },
      );
      setRegistered(
        "Número registrado en Meta. Guarda tu PIN: Meta lo pide si vuelves a registrarlo.",
      );
      setPins((p) => ({ ...p, [pick]: pin }));
      setPin("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await api<Discovered>("/api/channels/discover", { method: "POST", body: creds });
      setFound(d);
      const free = d.numbers.filter((n) => !n.alreadyConnected);
      setPick(free.length === 1 ? (free[0]?.phoneNumberId ?? "") : "");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    const n = found?.numbers.find((x) => x.phoneNumberId === pick);
    if (!n) return;
    setBusy(true);
    setError("");
    try {
      const ch = await api<{ setup: Setup }>("/api/channels", {
        method: "POST",
        body: {
          name,
          phoneNumberId: n.phoneNumberId,
          wabaId: n.wabaId,
          ...creds,
          pin: pins[n.phoneNumberId],
        },
      });
      setSetup(ch.setup);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Paso 3: resultado.
  if (setup)
    return (
      <div className="card space-y-4">
        <div className="font-medium">3. Número conectado</div>
        <SetupChecklist setup={setup} />
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p>
            <b>Publica tu app si sigue en modo desarrollo.</b> En desarrollo Meta puede no enviar
            los mensajes reales de tus clientes. Entra a {developersHome} → <b>Mis apps</b> → tu app
            → <b>Publicar</b> (en el panel de la app).
          </p>
          <p>
            <b>Agrega un método de pago.</b> Sin tarjeta, WhatsApp solo deja responder a clientes
            que te escriben (ventana de 24 h) y no podrás enviar plantillas (avisos de pedidos,
            recordatorios). Entra a {businessHome} → tu portafolio → <b>Configuración</b> →{" "}
            <b>Facturación y pagos</b> → tu cuenta de WhatsApp → <b>Añadir método de pago</b>.
          </p>
        </div>
        <button type="button" className="btn" onClick={onDone}>
          Continuar
        </button>
      </div>
    );

  // Paso 2: elegir número.
  if (found) {
    const tokenDays = found.token.expiresAt
      ? Math.max(0, Math.round((Date.parse(found.token.expiresAt) - Date.now()) / 86_400_000))
      : null;
    return (
      <div className="card space-y-4">
        <div className="font-medium">2. Elige el número</div>
        <p className="text-sm text-zinc-500">
          Token de la app <b>{found.app.name}</b>.
        </p>
        {!found.token.permanent && (
          <ErrorText>
            Este token es temporal y vence{" "}
            {tokenDays === 0 ? "hoy" : `en ${tokenDays} día${tokenDays === 1 ? "" : "s"}`}: cuando
            venza, el bot dejará de responder. Genera uno permanente con un usuario del sistema
            (paso 2 de la guía).
          </ErrorText>
        )}
        {found.missingScopes.length > 0 && (
          <ErrorText>
            Al token le faltan permisos: {found.missingScopes.join(", ")}. Vuelve a generarlo
            marcándolos.
          </ErrorText>
        )}
        {found.warnings.map((w) => (
          <p key={w} className="text-sm text-amber-700 dark:text-amber-400">
            {w}
          </p>
        ))}
        {found.accounts.length === 0 && (
          <div className="space-y-2">
            <ErrorText>
              El token no da acceso a ninguna cuenta de WhatsApp. Asígnale al usuario del sistema tu
              cuenta de WhatsApp con control total y vuelve a generar el token (pasos 2 y 3).
            </ErrorText>
            <details className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <summary className="cursor-pointer font-medium">Ver la guía paso a paso</summary>
              <MetaGuide />
            </details>
          </div>
        )}
        {found.accounts.length > 0 && found.numbers.length === 0 && (
          <p className="text-sm text-zinc-500">
            Tu cuenta de WhatsApp todavía no tiene números. Agrega uno aquí mismo: Selichat te manda
            el código y lo deja registrado.
          </p>
        )}
        {found.numbers.length > 0 && (
          <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {found.numbers.map((n) => (
              <label
                key={n.phoneNumberId}
                className={`flex items-center gap-3 p-3 text-sm ${n.alreadyConnected ? "opacity-50" : "cursor-pointer"}`}
              >
                <input
                  type="radio"
                  name="numero"
                  disabled={n.alreadyConnected}
                  checked={pick === n.phoneNumberId}
                  onChange={() => setPick(n.phoneNumberId)}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {n.displayPhone} <span className="text-zinc-500">{n.verifiedName}</span>
                  </div>
                  <div className="text-xs text-zinc-500">
                    Cuenta {n.wabaName}
                    {n.qualityRating ? ` · calidad ${n.qualityRating}` : ""}
                    {n.status && n.status !== "CONNECTED" ? ` · estado en Meta: ${n.status}` : ""}
                    {n.alreadyConnected ? " · ya está conectado en Selichat" : ""}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
        {found.accounts.length > 0 &&
          (adding || found.numbers.length === 0 ? (
            <AddNumber
              accessToken={creds.accessToken}
              accounts={found.accounts}
              onDone={numberAdded}
              onCancel={found.numbers.length ? () => setAdding(false) : undefined}
            />
          ) : (
            <button type="button" className="btn-ghost" onClick={() => setAdding(true)}>
              + Agregar un número nuevo
            </button>
          ))}
        {(() => {
          const sel = found.numbers.find((n) => n.phoneNumberId === pick);
          if (!sel?.status || sel.status === "CONNECTED") return null;
          return (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
              <div className="font-medium">Este número aún no está registrado en Meta</div>
              <p className="text-zinc-600 dark:text-zinc-400">
                Mientras no se registre, no puede enviar ni recibir mensajes. Elige un PIN de 6
                dígitos (verificación en dos pasos). Si el número ya tenía un PIN, usa ese mismo.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <input
                  className="input max-w-[10rem] font-mono tracking-widest"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  aria-label="PIN de 6 dígitos"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy || pin.length !== 6}
                  onClick={registerPicked}
                >
                  {busy ? "Registrando…" : "Registrar número"}
                </button>
              </div>
            </div>
          );
        })()}
        {registered && <p className="text-sm text-brand-700 dark:text-brand-400">{registered}</p>}
        <label className="block max-w-sm">
          <span className="label">Nombre interno</span>
          <input
            className="input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn"
            disabled={busy || !pick || !name.trim()}
            onClick={connect}
          >
            {busy ? "Conectando y configurando…" : "Conectar este número"}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setFound(null)}>
            Atrás
          </button>
        </div>
      </div>
    );
  }

  // Paso 1: token + App Secret.
  return (
    <form onSubmit={find} className="card space-y-4">
      <div className="font-medium">1. Conecta tu app de Meta</div>
      <p className="text-sm text-zinc-500">
        Solo necesitas dos datos. Selichat encuentra tus números y configura el webhook por ti. Si
        todavía no tienes el número en WhatsApp, lo agregas y verificas aquí mismo en el paso 2.
      </p>
      <details className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <summary className="cursor-pointer font-medium">
          ¿Dónde los consigo? (guía paso a paso)
        </summary>
        <MetaGuide />
      </details>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">Token de acceso permanente</span>
          <input
            className="input font-mono"
            required
            minLength={20}
            type="password"
            autoComplete="off"
            value={creds.accessToken}
            onChange={(e) => setCreds({ ...creds, accessToken: e.target.value.trim() })}
          />
        </label>
        <label className="block">
          <span className="label">Clave secreta de la app (App Secret)</span>
          <input
            className="input font-mono"
            required
            pattern="[a-fA-F0-9]{32}"
            title="32 caracteres (letras a-f y números)"
            type="password"
            autoComplete="off"
            value={creds.appSecret}
            onChange={(e) => setCreds({ ...creds, appSecret: e.target.value.trim() })}
          />
        </label>
      </div>
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn" disabled={busy}>
        {busy ? "Buscando tus números en Meta…" : "Buscar mis números"}
      </button>
    </form>
  );
}

function Templates({ channel }: { channel: Channel }) {
  const [list, setList] = useState<Template[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  /** Plantilla que se está editando (null = creando una nueva). */
  const [editing, setEditing] = useState<Template | null>(null);
  const empty = {
    name: "",
    language: "es",
    category: "UTILITY",
    body: "",
    footer: "",
    examples: [] as string[],
  };
  const [t, setT] = useState(empty);

  const load = useCallback(() => {
    api<Template[]>(`/api/channels/${channel.id}/templates`)
      .then(setList)
      .catch((e) => setError(errorMessage(e)));
  }, [channel.id]);
  useEffect(load, [load]);

  const varCount = Math.max(0, ...[...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));

  async function sync() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/channels/${channel.id}/templates/sync`, { method: "POST" });
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function startNew(prefill?: Partial<typeof empty>) {
    setEditing(null);
    setT({ ...empty, ...prefill });
    setOpen(true);
  }

  function startEdit(x: Template) {
    const body = x.components.find((c) => c.type.toUpperCase() === "BODY");
    const footer = x.components.find((c) => c.type.toUpperCase() === "FOOTER");
    setEditing(x);
    setT({
      name: x.name,
      language: x.language,
      category: x.category,
      body: body?.text ?? "",
      footer: footer?.text ?? "",
      examples: body?.example?.body_text?.[0] ?? [],
    });
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const payload = {
      ...t,
      footer: t.footer || undefined,
      examples: t.examples.slice(0, varCount),
    };
    try {
      if (editing) {
        const { name: _n, language: _l, ...rest } = payload;
        await api(`/api/channels/${channel.id}/templates/${editing.id}`, {
          method: "PATCH",
          body: rest,
        });
      } else {
        await api(`/api/channels/${channel.id}/templates`, { method: "POST", body: payload });
      }
      setOpen(false);
      setEditing(null);
      setT(empty);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(x: Template) {
    if (
      !confirm(
        `¿Eliminar la plantilla «${x.name}» (${x.language})? Se borra también en Meta y ese nombre no se podrá volver a usar durante 30 días.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/channels/${channel.id}/templates/${x.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const missing = SUGGESTED_TEMPLATES.filter((s) => !list.some((x) => x.name === s.name));

  async function createAllSuggested() {
    setBusy(true);
    setError("");
    const failed: string[] = [];
    for (const s of missing) {
      try {
        await api(`/api/channels/${channel.id}/templates`, {
          method: "POST",
          body: {
            name: s.name,
            language: "es",
            category: "UTILITY",
            body: s.body,
            examples: s.examples,
          },
        });
      } catch (err) {
        failed.push(`${s.name}: ${errorMessage(err)}`);
      }
    }
    if (failed.length) setError(failed.join(" · "));
    setBusy(false);
    load();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-medium">Plantillas ({list.length})</h3>
        <button type="button" className="btn-ghost" disabled={busy} onClick={sync}>
          Sincronizar con Meta
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => (open && !editing ? setOpen(false) : startNew())}
        >
          Nueva plantilla
        </button>
      </div>
      <p className="text-sm text-zinc-500">
        Las plantillas son los únicos mensajes que puedes enviar cuando pasaron más de 24 h desde el
        último mensaje del cliente (confirmaciones, avisos de envío, remarketing). Meta las revisa
        antes de aprobarlas.
      </p>
      <ErrorText>{error}</ErrorText>
      {missing.length > 0 && (
        <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-900 dark:bg-brand-950/30">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="size-4 text-brand-600" />
            <span className="mr-auto font-medium">
              Plantillas sugeridas para los avisos de pedidos
            </span>
            <button type="button" className="btn" disabled={busy} onClick={createAllSuggested}>
              {busy ? "Enviando…" : `Enviar las ${missing.length} a Meta`}
            </button>
          </div>
          <p className="text-sm text-zinc-500">
            Ya vienen con las variables en el orden que usan los avisos automáticos ({"{{1}}"}{" "}
            nombre, {"{{2}}"} producto, {"{{3}}"} guía, {"{{4}}"} agencia, {"{{5}}"} ciudad,{" "}
            {"{{6}}"} seguimiento). Cuando Meta las apruebe, ponlas en Integraciones → Dropi →
            Avisos.
          </p>
          <ul className="divide-y divide-brand-100 text-sm dark:divide-brand-900">
            {missing.map((s) => (
              <li key={s.name} className="flex flex-wrap items-start gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div>
                    <span className="font-mono font-medium">{s.name}</span>{" "}
                    <span className="text-xs text-zinc-500">· {NOTICE_INFO[s.kind].label}</span>
                  </div>
                  <div className="text-zinc-500">{s.body}</div>
                </div>
                <button
                  type="button"
                  className="btn-ghost shrink-0"
                  onClick={() =>
                    startNew({ name: s.name, body: s.body, examples: [...s.examples] })
                  }
                >
                  Revisar antes
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && (
        <form
          onSubmit={save}
          className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          {editing && (
            <div className="text-sm text-zinc-500">
              Editando <span className="font-mono font-medium">{editing.name}</span>. Meta la vuelve
              a revisar; una plantilla aprobada solo admite pocas ediciones al mes y su categoría no
              se puede cambiar.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="label">Nombre</span>
              <input
                className="input font-mono"
                required
                disabled={!!editing}
                placeholder="confirmacion_pedido"
                value={t.name}
                onChange={(e) =>
                  setT({ ...t, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })
                }
              />
            </label>
            <label className="block">
              <span className="label">Idioma</span>
              <select
                className="input"
                disabled={!!editing}
                value={t.language}
                onChange={(e) => setT({ ...t, language: e.target.value })}
              >
                <option value="es">Español (es)</option>
                <option value="es_MX">Español México (es_MX)</option>
                <option value="es_AR">Español Argentina (es_AR)</option>
                <option value="en">English (en)</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Categoría</span>
              <select
                className="input"
                disabled={editing?.status === "APPROVED"}
                value={t.category}
                onChange={(e) => setT({ ...t, category: e.target.value })}
              >
                <option value="UTILITY">Utilidad (pedidos, envíos)</option>
                <option value="MARKETING">Marketing (promociones)</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="label">
              Texto (usa {"{{1}}"}, {"{{2}}"}… para datos variables)
            </span>
            <textarea
              className="input"
              rows={4}
              required
              placeholder="Hola {{1}}, tu pedido de {{2}} fue confirmado. Te avisaremos cuando salga a reparto."
              value={t.body}
              onChange={(e) => setT({ ...t, body: e.target.value })}
            />
          </label>
          {varCount > 0 && (
            <div className="grid gap-2 sm:grid-cols-3">
              {Array.from({ length: varCount }, (_, k) => k + 1).map((n) => (
                <label key={`ex-${n}`} className="block">
                  <span className="label">Ejemplo para {`{{${n}}}`}</span>
                  <input
                    className="input"
                    required
                    value={t.examples[n - 1] ?? ""}
                    onChange={(e) => {
                      const ex = [...t.examples];
                      ex[n - 1] = e.target.value;
                      setT({ ...t, examples: ex });
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          <label className="block">
            <span className="label">Pie (opcional)</span>
            <input
              className="input"
              maxLength={60}
              value={t.footer}
              onChange={(e) => setT({ ...t, footer: e.target.value })}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn" disabled={busy}>
              {editing ? "Guardar y enviar a revisión" : "Enviar a revisión de Meta"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setOpen(false);
                setEditing(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {list.length === 0 && (
          <div className="p-4 text-sm text-zinc-500">
            Sin plantillas. Sincroniza para traer las que ya tienes en Meta.
          </div>
        )}
        {list.map((x) => (
          <div key={x.id} className="p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-medium">{x.name}</span>
              <span className="text-xs text-zinc-500">
                {x.language} · {x.category}
              </span>
              <span
                className={`ml-auto rounded px-2 py-0.5 text-xs ${STATUS_STYLE[x.status] ?? "bg-zinc-100 dark:bg-zinc-800"}`}
              >
                {x.status}
              </span>
              <button
                type="button"
                className="btn-ghost px-2"
                title="Editar"
                aria-label={`Editar ${x.name}`}
                disabled={busy}
                onClick={() => startEdit(x)}
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                className="btn-ghost px-2 text-red-600"
                title="Eliminar"
                aria-label={`Eliminar ${x.name}`}
                disabled={busy}
                onClick={() => remove(x)}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="mt-1 text-zinc-500">
              {x.components.find((c) => c.type.toUpperCase() === "BODY")?.text}
            </div>
            {x.rejectedReason && (
              <div className="mt-1 text-xs text-red-600">
                Motivo del rechazo: {x.rejectedReason}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelCard({ ch, onChange }: { ch: Channel; onChange: () => void }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [pin, setPin] = useState("");

  async function run(fn: () => Promise<unknown>, ok: string) {
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(ok);
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="card space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">
            {ch.verifiedName || ch.name} <span className="text-zinc-500">{ch.displayPhone}</span>
          </div>
          <div className="text-xs text-zinc-500">
            Phone Number ID {ch.phoneNumberId} · WABA {ch.wabaId}
          </div>
        </div>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            ch.status === "activo"
              ? STATUS_STYLE.APPROVED
              : ch.status === "error"
                ? STATUS_STYLE.REJECTED
                : STATUS_STYLE.PENDING
          }`}
        >
          {ch.status}
        </span>
      </div>
      {ch.lastError && <ErrorText>{ch.lastError}</ErrorText>}

      <div className="text-xs text-zinc-500">
        {ch.webhookVerifiedAt
          ? `✓ Webhook verificado por Meta el ${new Date(ch.webhookVerifiedAt).toLocaleString()}.`
          : "Webhook aún no verificado por Meta: pulsa «Probar y reparar conexión»."}{" "}
        {ch.lastEventAt
          ? `Último mensaje recibido: ${new Date(ch.lastEventAt).toLocaleString()}.`
          : ""}
      </div>
      {setup && <SetupChecklist setup={setup} />}

      <details
        className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
        open={!ch.webhookVerifiedAt && !!setup && !setup.ready}
      >
        <summary className="cursor-pointer text-sm font-medium">
          Configuración manual del webhook (solo si la automática falla)
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-zinc-500">
            Pégalos en Meta → tu app → WhatsApp → Configuración → Webhook, y suscribe el campo
            «messages».
          </p>
          <Copy label="URL de devolución de llamada" value={ch.webhookUrl} />
          <Copy label="Token de verificación" value={ch.verifyToken} />
        </div>
      </details>

      <details className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <summary className="cursor-pointer text-sm font-medium">
          ¿El número aparece «pendiente» en Meta? Regístralo con PIN
        </summary>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input
            className="input max-w-[10rem] font-mono tracking-widest"
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            aria-label="PIN de 6 dígitos"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
          <button
            type="button"
            className="btn-ghost"
            disabled={pin.length !== 6}
            onClick={() =>
              run(async () => {
                await api(`/api/channels/${ch.id}/register`, { method: "POST", body: { pin } });
                setPin("");
              }, "Número registrado en Meta. Guarda tu PIN.")
            }
          >
            Registrar número
          </button>
          <p className="w-full text-xs text-zinc-500">
            PIN de 6 dígitos de verificación en dos pasos. Si el número ya tenía uno, usa ese mismo.
          </p>
        </div>
      </details>

      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={() =>
            run(async () => {
              setSetup(null);
              const r = await api<{ setup: Setup }>(`/api/channels/${ch.id}/test`, {
                method: "POST",
              });
              setSetup(r.setup);
            }, "Conexión con Meta OK.")
          }
        >
          Probar y reparar conexión
        </button>
        <input
          className="input max-w-xs font-mono"
          type="password"
          autoComplete="off"
          placeholder="Nuevo token de acceso"
          aria-label="Nuevo token de acceso"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button
          type="button"
          className="btn-ghost"
          disabled={token.length < 20}
          onClick={() =>
            run(async () => {
              await api(`/api/channels/${ch.id}`, {
                method: "PATCH",
                body: { accessToken: token },
              });
              setToken("");
            }, "Token actualizado.")
          }
        >
          Cambiar token
        </button>
        <input
          className="input max-w-xs font-mono"
          type="password"
          autoComplete="off"
          placeholder="Nuevo App Secret (32 caracteres)"
          aria-label="Nuevo App Secret"
          value={secret}
          onChange={(e) => setSecret(e.target.value.trim())}
        />
        <button
          type="button"
          className="btn-ghost"
          disabled={!/^[a-f0-9]{32}$/i.test(secret)}
          onClick={() =>
            run(async () => {
              await api(`/api/channels/${ch.id}`, {
                method: "PATCH",
                body: { appSecret: secret },
              });
              setSecret("");
            }, "App Secret actualizado. Envía un mensaje de prueba.")
          }
        >
          Cambiar App Secret
        </button>
        <button
          type="button"
          className="ml-auto text-sm text-red-600 hover:underline"
          onClick={() => {
            if (
              confirm("¿Desconectar este número? Se borran también sus conversaciones en chatea.")
            ) {
              run(
                () => api(`/api/channels/${ch.id}`, { method: "DELETE" }),
                "Número desconectado.",
              );
            }
          }}
        >
          Desconectar
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
      {notice && <p className="text-sm text-brand-700 dark:text-brand-400">{notice}</p>}

      <Templates channel={ch} />
    </div>
  );
}

export default function Page() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => {
    api<Channel[]>("/api/channels")
      .then(setChannels)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  return (
    <>
      <div className="mb-2 text-sm">
        <Link href="/panel/integraciones" className="text-zinc-500 hover:underline">
          ← Integraciones
        </Link>
      </div>
      <PageHeader
        icon={MessageCircle}
        title="WhatsApp"
        description="Conecta tu número de WhatsApp Business por la API oficial de Meta (Cloud API). Los mensajes llegan a Conversaciones."
      />
      <ErrorText>{error}</ErrorText>
      <div className="space-y-6">
        {channels?.map((c) => (
          <ChannelCard key={c.id} ch={c} onChange={load} />
        ))}
        {channels && (channels.length === 0 || adding) ? (
          <ConnectForm
            onDone={() => {
              setAdding(false);
              load();
            }}
          />
        ) : (
          channels && (
            <button type="button" className="btn-ghost" onClick={() => setAdding(true)}>
              Conectar otro número
            </button>
          )
        )}
      </div>
    </>
  );
}
