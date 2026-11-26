/**
 * Conexión manual simplificada: la tienda pega solo el token y el App Secret;
 * Selichat descubre sus números y deja el webhook configurado sin pasos en Meta.
 */
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
  token: { permanent: boolean; expiresAt: string | null; type: string | null };
  missingScopes: string[];
  numbers: DiscoveredNumber[];
  /** Avisos no bloqueantes (p. ej. una WABA que no se pudo leer). */
  warnings: string[];
}

export class OnboardingError extends Error {
  constructor(
    public code: "token_invalido" | "app_secret_no_coincide" | "meta_error",
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

  const numbers: DiscoveredNumber[] = [];
  for (const wabaId of wabaIds) {
    try {
      const [waba, phones] = await Promise.all([
        user.waba(wabaId).catch(() => ({ id: wabaId, name: undefined })),
        user.wabaPhoneNumbers(wabaId),
      ]);
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
    token: { permanent: !dbg?.expires_at, expiresAt, type: dbg?.type ?? null },
    missingScopes,
    numbers,
    warnings,
  };
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
