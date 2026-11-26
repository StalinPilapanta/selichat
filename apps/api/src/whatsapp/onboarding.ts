/**
 * Conexión manual simplificada: la tienda pega solo el token y el App Secret;
 * Selichat descubre sus números y deja el webhook configurado sin pasos en Meta.
 */
import { randomInt } from "node:crypto";
import { Graph, GraphError } from "./graph.js";

export const REQUIRED_SCOPES = ["whatsapp_business_messaging", "whatsapp_business_management"];

export interface DiscoveredNumber {
  phoneNumberId: string;
  wabaId: string;
  wabaName: string;
  displayPhone: string;
  verifiedName: string;
  qualityRating: string | null;
  /** Meta: CONNECTED, PENDING, etc. Si no está CONNECTED no puede enviar todavía. */
  status: string | null;
}

export interface Discovery {
  app: { id: string; name: string };
  /** Cuentas de WhatsApp a las que da acceso el token (aunque no tengan números todavía). */
  accounts: { id: string; name: string }[];
  token: { permanent: boolean; expiresAt: string | null; type: string | null };
  missingScopes: string[];
  numbers: DiscoveredNumber[];
  /** Avisos no bloqueantes (p. ej. una WABA que no se pudo leer). */
  warnings: string[];
}

export class OnboardingError extends Error {
  constructor(
    public code:
      | "token_invalido"
      | "app_secret_no_coincide"
      | "sin_permiso"
      | "numero_en_uso"
      | "nombre_rechazado"
      | "numero_invalido"
      | "codigo_incorrecto"
      | "registro_fallido"
      | "meta_error",
    message: string,
  ) {
    super(message);
  }
}

type Opts = { version: string; fetchImpl?: typeof fetch };

const graph = (accessToken: string, o: Opts) =>
  new Graph({ accessToken, version: o.version, fetchImpl: o.fetchImpl });

/** Valida token y App Secret, y lista los números a los que da acceso el token. */
export async function discover(
  accessToken: string,
  appSecret: string,
  o: Opts,
): Promise<Discovery> {
  const user = graph(accessToken, o);
  let app: { id: string; name?: string };
  try {
    app = await user.tokenApp();
  } catch (e) {
    if (e instanceof GraphError && e.tokenInvalid)
      throw new OnboardingError(
        "token_invalido",
        "Meta rechazó el token: está vencido, mal copiado o fue revocado.",
      );
    throw new OnboardingError("meta_error", (e as Error).message);
  }

  const appGraph = graph(`${app.id}|${appSecret}`, o);
  try {
    await appGraph.appInfo(app.id);
  } catch {
    throw new OnboardingError(
      "app_secret_no_coincide",
      `El App Secret no corresponde a la app «${app.name ?? app.id}», que es la dueña del token. Cópialo de esa app en Configuración de la app → Básica.`,
    );
  }

  const dbg = await appGraph.debugToken(accessToken).catch(() => null);
  const granted = new Set([
    ...(dbg?.scopes ?? []),
    ...(dbg?.granular_scopes ?? []).map((g) => g.scope),
  ]);
  const missingScopes = dbg ? REQUIRED_SCOPES.filter((s) => !granted.has(s)) : [];
  const expiresAt = dbg?.expires_at ? new Date(dbg.expires_at * 1000).toISOString() : null;

  const warnings: string[] = [];
  const wabaIds = new Set(
    (dbg?.granular_scopes ?? [])
      .filter((g) => REQUIRED_SCOPES.includes(g.scope))
      .flatMap((g) => g.target_ids ?? []),
  );
  if (wabaIds.size === 0) {
    const owned = await user.ownedWabas().catch(() => []);
    for (const w of owned) wabaIds.add(w.id);
  }

  if (dbg?.type && dbg.type !== "SYSTEM_USER")
    warnings.push(
      "Este token es de tu usuario personal, no de un usuario del sistema: vence y se corta si cambias tu contraseña. Genera uno desde Usuarios del sistema (paso 3 de la guía).",
    );

  const numbers: DiscoveredNumber[] = [];
  const accounts: { id: string; name: string }[] = [];
  for (const wabaId of wabaIds) {
    try {
      const [waba, phones] = await Promise.all([
        user.waba(wabaId).catch(() => ({ id: wabaId, name: undefined })),
        user.wabaPhoneNumbers(wabaId),
      ]);
      accounts.push({ id: wabaId, name: waba.name ?? wabaId });
      for (const p of phones)
        numbers.push({
          phoneNumberId: p.id,
          wabaId,
          wabaName: waba.name ?? wabaId,
          displayPhone: p.display_phone_number,
          verifiedName: p.verified_name,
          qualityRating: p.quality_rating ?? null,
          status: p.status ?? null,
        });
    } catch (e) {
      warnings.push(`No se pudo leer la cuenta de WhatsApp ${wabaId}: ${(e as Error).message}`);
    }
  }

  return {
    app: { id: app.id, name: app.name ?? app.id },
    accounts,
    token: { permanent: !dbg?.expires_at, expiresAt, type: dbg?.type ?? null },
    missingScopes,
    numbers,
    warnings,
  };
}

// ---------- Agregar un número nuevo desde Selichat ----------

/**
 * Separa código de país y número local. Acepta «0963268008», «963268008»,
 * «+593 96 326 8008» o «593963268008» con cc «593». Devuelve null si no parece un número.
 */
export function splitPhone(cc: string, input: string): { cc: string; number: string } | null {
  const code = cc.replace(/\D/g, "");
  let n = input.replace(/\D/g, "");
  if (!code || code.length > 4) return null;
  if (input.trim().startsWith("+")) {
    // Con «+» el número ya trae su código de país: debe ser el elegido.
    if (!n.startsWith(code)) return null;
    n = n.slice(code.length);
  } else if (n.startsWith(code) && n.length > code.length + 7) {
    n = n.slice(code.length);
  }
  n = n.replace(/^0+/, "");
  if (n.length < 6 || n.length > 14) return null;
  return { cc: code, number: n };
}

/** Traduce los errores de Meta más comunes al agregar o verificar un número. */
function explainAddError(e: unknown): OnboardingError {
  if (!(e instanceof GraphError)) return new OnboardingError("meta_error", (e as Error).message);
  const m = e.message.toLowerCase();
  const meta = ` (Meta: ${e.message})`;
  if (e.tokenInvalid) return new OnboardingError("token_invalido", `Meta rechazó el token.${meta}`);
  if (e.code === 10 || e.code === 200 || m.includes("permission"))
    return new OnboardingError(
      "sin_permiso",
      `El token no tiene permiso sobre esta cuenta de WhatsApp. En Usuarios del sistema asígnale la cuenta con control total y vuelve a generar el token (paso 3 de la guía).${meta}`,
    );
  if (m.includes("display name") || m.includes("verified_name") || m.includes("verified name"))
    return new OnboardingError(
      "nombre_rechazado",
      `Meta no aceptó el nombre visible. Usa el nombre de tu negocio tal como aparece en tu web o redes, sin palabras como «WhatsApp», «oficial» ni solo palabras genéricas.${meta}`,
    );
  if (m.includes("already") || m.includes("in use") || m.includes("registered"))
    return new OnboardingError(
      "numero_en_uso",
      `Este número todavía está activo en la app de WhatsApp, en WhatsApp Business o en otra cuenta de la API. Bórralo primero (en la app: Ajustes → Cuenta → Eliminar cuenta) y vuelve a intentarlo.${meta}`,
    );
  if (m.includes("phone") && (m.includes("invalid") || m.includes("format")))
    return new OnboardingError(
      "numero_invalido",
      `Meta no reconoce el número. Revisa el código de país y el número.${meta}`,
    );
  return new OnboardingError("meta_error", e.message);
}

const digits = (s: string) => s.replace(/\D/g, "");

export interface AddedNumber {
  phoneNumberId: string;
  displayPhone: string;
  /** Ya estaba verificado: no se mandó código y se puede registrar directo. */
  alreadyVerified: boolean;
  /** Ya estaba registrado y listo: no hay nada que hacer en Meta. */
  alreadyRegistered: boolean;
}

/**
 * Agrega el número a la cuenta de WhatsApp y manda el código.
 * Si el número ya estaba en la cuenta (reintento), lo reutiliza en vez de duplicarlo.
 */
export async function addNumber(
  accessToken: string,
  input: {
    wabaId: string;
    cc: string;
    phone: string;
    displayName: string;
    method: "SMS" | "VOICE";
  },
  o: Opts,
): Promise<AddedNumber> {
  const parts = splitPhone(input.cc, input.phone);
  if (!parts)
    throw new OnboardingError(
      "numero_invalido",
      "Escribe el número con su código de país, por ejemplo 593 y 0963268008.",
    );
  const user = graph(accessToken, o);
  const full = parts.cc + parts.number;
  try {
    const existing = (await user.wabaPhoneNumbers(input.wabaId)).find(
      (p) => digits(p.display_phone_number) === full,
    );
    if (existing?.status === "CONNECTED")
      return {
        phoneNumberId: existing.id,
        displayPhone: existing.display_phone_number,
        alreadyVerified: true,
        alreadyRegistered: true,
      };
    if (existing?.code_verification_status === "VERIFIED")
      return {
        phoneNumberId: existing.id,
        displayPhone: existing.display_phone_number,
        alreadyVerified: true,
        alreadyRegistered: false,
      };
    const id =
      existing?.id ??
      (await user.addPhoneNumber(input.wabaId, parts.cc, parts.number, input.displayName.trim()))
        .id;
    await user.requestCode(id, input.method);
    return {
      phoneNumberId: id,
      displayPhone: existing?.display_phone_number ?? `+${parts.cc} ${parts.number}`,
      alreadyVerified: false,
      alreadyRegistered: false,
    };
  } catch (e) {
    throw explainAddError(e);
  }
}

/** Vuelve a mandar el código (p. ej. por llamada si el SMS no llegó). */
export async function resendCode(
  accessToken: string,
  phoneNumberId: string,
  method: "SMS" | "VOICE",
  o: Opts,
) {
  try {
    await graph(accessToken, o).requestCode(phoneNumberId, method);
  } catch (e) {
    throw explainAddError(e);
  }
}

/** Mensaje claro para los errores típicos al registrar con PIN. */
export function explainRegisterError(e: GraphError): string {
  if (e.code === 133005)
    return "El PIN no coincide: este número ya tiene verificación en dos pasos con otro PIN. Usa ese PIN o cámbialo en WhatsApp Manager → Números de teléfono → Configuración.";
  if (e.code === 133016)
    return "Meta bloqueó temporalmente el registro por demasiados intentos. Espera unas horas y vuelve a intentarlo.";
  return e.message;
}

/** PIN de verificación en dos pasos que Selichat genera y guarda por la tienda. */
export const newPin = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/**
 * Verifica el código y registra el número con un PIN nuevo.
 * Devuelve el PIN para guardarlo con el canal.
 */
export async function verifyAndRegister(
  accessToken: string,
  phoneNumberId: string,
  code: string | null,
  o: Opts,
): Promise<{ pin: string }> {
  const user = graph(accessToken, o);
  if (code) {
    try {
      await user.verifyCode(phoneNumberId, code.replace(/\D/g, ""));
    } catch (e) {
      if (e instanceof GraphError && !e.tokenInvalid && e.code !== 10 && e.code !== 200)
        throw new OnboardingError(
          "codigo_incorrecto",
          `El código no es correcto o ya venció. Revísalo o pide uno nuevo. (Meta: ${e.message})`,
        );
      throw explainAddError(e);
    }
  }
  const pin = newPin();
  try {
    await user.registerPhone(phoneNumberId, pin);
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    throw new OnboardingError(
      "registro_fallido",
      `El número quedó verificado, pero Meta no lo registró: ${explainRegisterError(e)}`,
    );
  }
  return { pin };
}

export type StepResult = { ok: true; note?: string } | { ok: false; error: string };

export interface SetupResult {
  /** La app quedó suscrita a la WABA (sin esto Meta no envía mensajes). */
  subscribed: StepResult;
  /** Webhook base de la app: se crea solo si la app no tenía uno (si tiene otro, se respeta). */
  appWebhook: StepResult;
  /** Webhook propio de este número apuntando a Selichat. */
  webhook: StepResult;
  /** Selichat recibirá los mensajes de este número. */
  ready: boolean;
}

const step = async (fn: () => Promise<unknown>): Promise<StepResult> => {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
};

/**
 * Deja el canal recibiendo mensajes sin que la tienda toque Meta.
 * Nunca lanza: devuelve el resultado de cada paso para mostrarlo y, si algo falla,
 * la pantalla ofrece la configuración manual del webhook.
 */
export async function autoSetup(
  ch: {
    accessToken: string;
    appSecret: string;
    wabaId: string;
    phoneNumberId: string;
    webhookUrl: string;
    verifyToken: string;
  },
  o: Opts,
): Promise<SetupResult> {
  const user = graph(ch.accessToken, o);
  const subscribed = await step(() => user.subscribeApp(ch.wabaId));

  // El webhook por número solo actúa si la app ya recibe el campo «messages».
  let appWebhook: StepResult;
  let appPointsHere = false;
  try {
    const app = await user.tokenApp();
    const appGraph = graph(`${app.id}|${ch.appSecret}`, o);
    const subs = await appGraph.appSubscriptions(app.id);
    const wa = subs.find((s) => s.object === "whatsapp_business_account");
    if (!wa) {
      appWebhook = await step(() =>
        appGraph.subscribeAppWebhook(app.id, ch.webhookUrl, ch.verifyToken),
      );
      appPointsHere = appWebhook.ok;
    } else if (!wa.fields?.some((f) => f.name === "messages")) {
      appWebhook = {
        ok: false,
        error:
          "Tu app de Meta ya tiene otro webhook de WhatsApp sin el campo «messages». Actívalo en Meta → WhatsApp → Configuración → Campos del webhook.",
      };
    } else {
      appPointsHere = wa.callback_url === ch.webhookUrl;
      appWebhook = { ok: true, note: "La app ya tenía un webhook de WhatsApp; se respetó." };
    }
  } catch (e) {
    appWebhook = { ok: false, error: (e as Error).message };
  }

  const webhook = await step(() =>
    user.setPhoneWebhook(ch.phoneNumberId, ch.webhookUrl, ch.verifyToken),
  );
  const ready = subscribed.ok && appWebhook.ok && (webhook.ok || appPointsHere);
  return { subscribed, appWebhook, webhook, ready };
}
