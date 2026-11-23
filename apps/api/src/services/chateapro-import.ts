import {
  type FollowUpStepInput,
  GUIDED_SECTIONS,
  mediaKindFromUrl,
  type ProductInput,
} from "@chatea/shared";

/**
 * Importador desde Chatea Pro (white-label de UChat).
 * Lee los bot fields del workspace y los convierte a productos y prompts de chatea.
 * El token se usa solo durante la importación; no se guarda.
 */
export const CHATEAPRO_API = "https://chateapro.app/api";

export interface BotField {
  name: string;
  var_type: string;
  value: unknown;
}

export async function fetchBotFields(token: string, baseUrl = CHATEAPRO_API): Promise<BotField[]> {
  const out: BotField[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${baseUrl}/flow/bot-fields?limit=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401 || res.status === 403) throw new ImportError("token_invalido");
    if (!res.ok) throw new ImportError("chateapro_no_responde");
    const body = (await res.json()) as { data?: BotField[]; meta?: { last_page?: number } };
    out.push(...(body.data ?? []));
    if (!body.meta?.last_page || page >= body.meta.last_page) break;
  }
  return out;
}

export class ImportError extends Error {}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
const str = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
const yes = (v: unknown) => v === true || str(v).toLowerCase() === "si";

function parseJson(v: unknown): Json {
  if (typeof v !== "string") return obj(v);
  try {
    return obj(JSON.parse(v));
  } catch {
    return {};
  }
}

/** "1 horas" → 60, "3 dias" → 4320, "30 minutos" → 30. */
export function parseDelay(v: string): number | null {
  const m = v
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:[.,]\d+)?)\s*(min|minuto|minutos|h|hora|horas|d|dia|dias|día|días)?$/);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(",", "."));
  const unit = m[2] ?? "horas";
  const factor = unit.startsWith("min") ? 1 : unit.startsWith("h") ? 60 : 1440;
  return Math.round(n * factor);
}

const splitList = (v: unknown) =>
  str(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Normaliza precios "27,99" / "$27.99" → "27.99". */
function normPrice(v: unknown): string | null {
  const s = str(v)
    .replace(/[^\d.,]/g, "")
    .replace(",", ".");
  if (!s || Number.isNaN(Number(s))) return null;
  return Number(s).toFixed(2);
}

export interface ImportedProduct {
  slot: string;
  data: ProductInput;
  prompt: { mode: "libre" | "guiado"; content: string; sections: Record<string, string> } | null;
  warnings: string[];
}

export interface ParsedWorkspace {
  products: ImportedProduct[];
  common: string | null;
  master: string | null;
}

export function parseWorkspace(fields: BotField[]): ParsedWorkspace {
  const byName = new Map(fields.map((f) => [f.name, f]));

  // Índice extendido de disparadores: slot → {keyW, idAd, estado}
  const index = new Map<string, Json>();
  const ext = byName.get("[Ventas Wp] Disparador de productos Extendido")?.value;
  if (typeof ext === "string") {
    try {
      for (const row of JSON.parse(ext) as Json[]) index.set(str(row.name), row);
    } catch {
      /* índice ilegible: se usan solo los activadores del producto */
    }
  }

  const products = fields
    .filter((f) => /^\[Producto Ventas Wp\] \d+$/.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((f) => parseProduct(f.name, parseJson(f.value), index.get(f.name)))
    .filter((p): p is ImportedProduct => p !== null);

  const general2 = obj(
    parseJson(byName.get("[Ventas Wp] Configuracion general 2")?.value).comportamiento_ia,
  );
  const commonParts = [str(general2.rol).trim()];
  const restr = str(general2.restricciones).trim();
  if (restr) commonParts.push(`RESTRICCIONES\n${restr}`);
  const limit = str(obj(general2.division).limite);
  if (limit) commonParts.push(`Divide cada respuesta en máximo ${limit} mensajes cortos.`);
  const common = commonParts.filter(Boolean).join("\n\n") || null;

  const general = parseJson(byName.get("[Ventas Wp] Configuracion general")?.value);
  const master = str(obj(general.producto_segundos).prompt_prompt).trim() || null;

  return { products, common, master };
}

function parseProduct(slot: string, j: Json, idx?: Json): ImportedProduct | null {
  const info = obj(j.informacion_de_producto);
  const name = str(info.nombre).trim() || str(idx?.producto).trim();
  if (!name) return null; // slot vacío
  const warnings: string[] = [];

  const price = normPrice(info.precio);
  if (!price) warnings.push("Sin precio válido: se dejó en 0.00");

  const funnel = obj(j.embudo_de_ventas);
  const rawMedia = funnel.multimedia;
  const mediaUrls = (Array.isArray(rawMedia) ? rawMedia : Object.values(obj(rawMedia)))
    .map(str)
    .filter((u) => /^https?:\/\//.test(u));

  const act = obj(j.activadores_del_flujo);
  const keywords = new Set([...splitList(act.palabras_clave), ...splitList(idx?.keyW)]);
  const adIds = new Set([...splitList(act.ids_de_anuncio), ...splitList(idx?.idAd)]);

  const kindMap: Record<string, "fisico" | "digital" | "servicio"> = {
    físico: "fisico",
    fisico: "fisico",
    "producto físico": "fisico",
    digital: "digital",
    "producto digital": "digital",
    servicio: "servicio",
  };

  const rec = obj(j.recordatorios);
  const rem = obj(j.remarketing);
  const step = (
    src: Json,
    n: 1 | 2,
    messageKey: "mensaje" | "prompt",
  ): FollowUpStepInput | null => {
    const delay = parseDelay(str(src[`tiempo_${n}`]));
    const message = str(src[`${messageKey}_${n}`]).trim();
    const tpl = obj(src[`plantilla_${n}`]);
    const tplName = str(tpl.name).trim();
    const template =
      tplName && tplName !== "no enviar plantilla"
        ? { name: tplName, lang: str(tpl.lang) || "es" }
        : null;
    if (!delay || (!message && !template)) return null;
    return { enabled: yes(src[`activar_${n}`]), delayMinutes: delay, message, template };
  };

  const upsells = Object.values(obj(j.upsells))
    .map(obj)
    .filter((u) => str(u.nombre).trim())
    .map((u) => ({
      name: str(u.nombre).trim(),
      description: [str(u.titulo), str(u.descripcion)].filter(Boolean).join(" — "),
      price: normPrice(u.precio),
      dropiProductId: str(u.id_dropi) || null,
      imageUrl: /^https?:\/\//.test(str(u.imagen)) ? str(u.imagen) : null,
      moment: str(u.momento).includes("compra")
        ? ("compra_realizada" as const)
        : ("durante_venta" as const),
      active: yes(u.activo),
    }));

  const p = obj(j.prompt);
  let prompt: ImportedProduct["prompt"] = null;
  if (str(p.tipo_de_prompt) === "guiado") {
    const sections = Object.fromEntries(
      GUIDED_SECTIONS.map((s) => [s.key, str(p[`prompt_guiado_${s.key}`])]).filter(([, v]) => v),
    );
    if (Object.keys(sections).length) prompt = { mode: "guiado", content: "", sections };
  } else if (str(p.prompt_libre).trim()) {
    prompt = { mode: "libre", content: str(p.prompt_libre), sections: {} };
  }
  if (!prompt) warnings.push("Sin prompt de producto");
  warnings.push("Las ofertas por cantidad están dentro del prompt: cárgalas en la pestaña Ofertas");

  const estado = str(info.estado || idx?.estado).toLowerCase();
  const data: ProductInput = {
    name,
    price: price ?? "0.00",
    currency: (str(info.moneda) || "USD").toUpperCase(),
    kind: kindMap[str(info.tipo).toLowerCase()] ?? "fisico",
    status: estado === "activo" ? "activo" : "inactivo",
    variantType: str(info.variable).toUpperCase() === "VARIABLE" ? "VARIABLE" : "SIMPLE",
    imageUrl: /^https?:\/\//.test(str(info.imagen)) ? str(info.imagen) : null,
    dropiProductId: str(info.id_dropi) || null,
    initialMessage: str(funnel.mensaje_inicial),
    entryQuestion: str(funnel.pregunta_de_entrada),
    media: mediaUrls.map((url) => ({
      kind: mediaKindFromUrl(url),
      url,
      usage: "inicial" as const,
    })),
    triggers: [
      ...[...keywords].map((value) => ({ kind: "keyword" as const, value })),
      ...[...adIds].map((value) => ({ kind: "ad_id" as const, value })),
    ],
    upsells,
    followUps: {
      reminders: [step(rec, 1, "mensaje"), step(rec, 2, "mensaje")].filter((x) => x !== null),
      remarketing: [step(rem, 1, "prompt"), step(rem, 2, "prompt")].filter((x) => x !== null),
    },
  };
  return { slot, data, prompt, warnings };
}
