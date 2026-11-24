/**
 * Buscador de agencias Servientrega (servicio propio en Coolify, repo servientregaubicaciones):
 * GET {SERVIENTREGA_URL}/buscar?texto=<ciudad y sector> → oficinas de la ciudad o del sector.
 * La URL es de la plataforma (variable de entorno); cada tienda elige el modo de entrega.
 *
 * La lógica sigue al bot de ventas del mismo repo (ventas-bot/agencias.py y ficha.py):
 * - el servicio responde con `modo`: "unica" (una sola oficina en la ciudad), "ciudad_sector"
 *   (las más cercanas al sector) o "solo_ciudad" (todas las de la ciudad, falta el sector);
 * - solo sirven para retiro las que "entregan en oficina";
 * - pocas en la ciudad (≤ 10) → se listan; muchas → se pide sector o una referencia;
 * - la agencia se registra como «NOMBRE---SECTOR---DIRECCIÓN», el formato de las guías de Dropi.
 */
import { type Database, schema, withTenant } from "@chatea/db";
import { decryptSecret, encryptSecret } from "@chatea/shared";
import { eq } from "drizzle-orm";
import {
  cercanasASinRetiro,
  ciudadDe,
  deCiudad,
  type Geocoder,
  nombradaEnTexto,
  norm as normGeo,
} from "./agencias-geo.js";

const { integrations } = schema;
export const SERVIENTREGA_KIND = "servientrega";

/** off = no se usa; opcion = retiro en agencia como alternativa; solo = todo va a agencia. */
export type AgencyMode = "off" | "opcion" | "solo";
export const AGENCY_MODES: AgencyMode[] = ["off", "opcion", "solo"];

/** Tiempo máximo para ubicar la referencia del cliente en el mapa. */
const GEO_BUDGET_MS = 6_000;

/** Ciudades con hasta este número de agencias con retiro: se le muestran todas al cliente. */
const MAX_LISTA = 10;

export interface Agency {
  /** Valor que se registra en el pedido: NOMBRE---SECTOR---DIRECCIÓN. */
  registro: string;
  nombre: string;
  /** «Castillo» para AMBATO_CASTILLO. */
  nombreCorto: string;
  ciudad: string;
  provincia: string;
  direccion: string;
  sector: string;
  telefono: string;
  horario: string;
  finDeSemana: string;
  entregaEnOficina: boolean;
}

export type AgencyEstado =
  | "nombrada"
  | "unica"
  | "cercanas"
  | "lista"
  | "falta_sector"
  | "sin_retiro"
  | "sin_ciudad";

export interface AgencySearch {
  estado: AgencyEstado;
  ciudad: string | null;
  /** Agencias con retiro en la ciudad (según el servicio). */
  totalCiudad: number;
  agencias: Agency[];
  /** Explicación para el modelo (p. ej. la del sector no entrega paquetes). */
  nota: string;
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const norm = (v: string) =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const title = (v: string) => v.toLowerCase().replace(/(^|[\s(])\S/g, (c) => c.toUpperCase());

function toAgency(a: Json): Agency {
  const nombre = str(a.nombre);
  const ciudad = str(a.ciudad);
  const sector = str(a.sector);
  const direccion = str(a.direccion);
  const corto = nombre.includes("_") ? nombre.split("_").slice(1).join(" ") : nombre;
  return {
    registro: [nombre, sector, direccion].join("---"),
    nombre,
    nombreCorto: title(corto || ciudad),
    ciudad,
    provincia: str(a.provincia),
    direccion,
    sector,
    telefono: str(a.telefono),
    horario: str(a.horario_lun_vie),
    finDeSemana: str(a.horario_fin_semana),
    entregaEnOficina: str(a.entrega_en_oficina).toUpperCase() !== "NO",
  };
}

// Agencias vistas (por registro y por nombre): para validar la elección del cliente.
const seen = new Map<string, { at: number; agency: Agency }>();
const SEEN_TTL = 24 * 3600_000;
function remember(list: Agency[]) {
  const now = Date.now();
  if (seen.size > 5000)
    for (const [k, v] of seen) if (now - v.at > SEEN_TTL || seen.size > 4000) seen.delete(k);
  for (const a of list) {
    seen.set(norm(a.registro), { at: now, agency: a });
    seen.set(norm(a.nombre), { at: now, agency: a });
  }
}

async function query(baseUrl: string, texto: string, fetchImpl: typeof fetch) {
  const url = `${baseUrl.replace(/\/$/, "")}/buscar?texto=${encodeURIComponent(texto.slice(0, 200))}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`buscador de agencias: HTTP ${res.status}`);
  const d = (await res.json()) as Json;
  const list = (Array.isArray(d.resultados) ? (d.resultados as Json[]) : []).map(toAgency);
  remember(list);
  return {
    ciudad: str(d.ciudad_detectada) || null,
    modo: str(d.modo),
    total: Number(d.total_ciudad) || 0,
    list,
  };
}

/** Búsqueda en el servicio (modo unica / ciudad_sector / solo_ciudad). */
async function serviceSearch(
  baseUrl: string,
  texto: string,
  fetchImpl: typeof fetch,
): Promise<AgencySearch> {
  const r = await query(baseUrl, texto, fetchImpl);
  const retiro = r.list.filter((a) => a.entregaEnOficina);
  const out = (estado: AgencyEstado, agencias: Agency[], nota = "", total = retiro.length) => ({
    estado,
    ciudad: r.ciudad,
    totalCiudad: total,
    agencias,
    nota,
  });
  if (!r.ciudad || !r.list.length)
    return out("sin_ciudad", [], "No se reconoció la ciudad: pídele ciudad y sector.", 0);

  if (r.modo === "unica")
    return retiro.length
      ? out("unica", retiro.slice(0, 1), "Es la única agencia de la ciudad.", 1)
      : out("sin_retiro", [], "La única agencia de la ciudad no entrega paquetes al cliente.", 0);

  if (r.modo === "solo_ciudad") {
    if (!retiro.length)
      return out("sin_retiro", [], "Ninguna agencia de la ciudad entrega paquetes al cliente.", 0);
    if (retiro.length <= MAX_LISTA) return out("lista", retiro);
    return out(
      "falta_sector",
      [],
      `Hay ${retiro.length} agencias con retiro en la ciudad: pide el sector o barrio, o una referencia (parque, colegio, avenida, centro comercial).`,
    );
  }

  // ciudad_sector (o respuesta sin modo): las más cercanas al sector, solo las de retiro.
  const excluidas = r.list.filter((a) => !a.entregaEnOficina).map((a) => a.nombreCorto);
  const nota = excluidas.length
    ? `${excluidas.join(", ")} está(n) cerca pero no entrega(n) paquetes al cliente: no la(s) ofrezcas.`
    : "";
  if (retiro.length) return out("cercanas", retiro.slice(0, 3), nota, r.total || retiro.length);

  // Las del sector no entregan: se toman las de la ciudad, primero las del mismo sector.
  const ciudad = await query(baseUrl, r.ciudad, fetchImpl).catch(() => null);
  const sectores = new Set(r.list.map((a) => norm(a.sector)));
  const enCiudad = (ciudad?.list ?? [])
    .filter((a) => a.entregaEnOficina)
    .sort((a, b) => Number(sectores.has(norm(b.sector))) - Number(sectores.has(norm(a.sector))));
  if (!enCiudad.length) return out("sin_retiro", [], "No hay agencias con retiro en esa zona.", 0);
  return out(
    "cercanas",
    enCiudad.slice(0, 3),
    `${nota} Estas son otras de la ciudad, primero las del mismo sector.`.trim(),
    enCiudad.length,
  );
}

export interface FindOptions {
  /** Ciudad ya registrada en el pedido: ancla la búsqueda («parada de Guachi» en Ambato). */
  ciudad?: string;
  /** Para ubicar referencias en el mapa (null = sin geocodificar). */
  geocoder?: Geocoder | null;
  /** Nombre del cliente: sus palabras nunca salen al geocodificador. */
  nombreCliente?: string;
}

const nota = {
  lista: (n: number) =>
    n > MAX_LISTA
      ? `Hay ${n} agencias con retiro en la ciudad: pide el sector o barrio, o una referencia (parque, colegio, avenida, centro comercial).`
      : "",
};

/** Lista de la ciudad desde el directorio (si el servicio no responde). */
function fromDirectory(ciudad: string): AgencySearch {
  const lista = deCiudad(ciudad, true);
  const base = { ciudad, totalCiudad: lista.length };
  if (!lista.length)
    return { ...base, estado: "sin_retiro", agencias: [], nota: "No hay agencias con retiro." };
  if (lista.length === 1) return { ...base, estado: "unica", agencias: lista, nota: "" };
  if (lista.length <= MAX_LISTA) return { ...base, estado: "lista", agencias: lista, nota: "" };
  return { ...base, estado: "falta_sector", agencias: [], nota: nota.lista(lista.length) };
}

/**
 * Busca las agencias para lo que dijo el cliente (ciudad + sector, barrio, referencia o el
 * nombre de la agencia), en el orden del bot de ventas:
 * 1. nombró una agencia con retiro de su ciudad → esa;
 * 2. nombró una que no entrega al cliente → las más cercanas a ella;
 * 3. buscador del servicio (modo unica / ciudad_sector / solo_ciudad);
 * 4. si falta el sector o lo emparejó a medias: la referencia se ubica en el mapa y se dan
 *    las agencias más cercanas a ese punto.
 */
export async function findAgencies(
  baseUrl: string,
  texto: string,
  fetchImpl: typeof fetch = fetch,
  opts: FindOptions = {},
): Promise<AgencySearch> {
  const anchor = opts.ciudad?.trim();
  const q =
    anchor && !` ${normGeo(texto)} `.includes(` ${normGeo(anchor)} `)
      ? `${anchor} ${texto}`
      : texto;
  const ciudad = ciudadDe(q) ?? (anchor || null);

  if (ciudad) {
    const named = nombradaEnTexto(ciudad, texto);
    if (named) {
      remember([named]);
      return {
        estado: "nombrada",
        ciudad,
        totalCiudad: deCiudad(ciudad, true).length,
        agencias: [named],
        nota: "El cliente nombró esta agencia: confírmasela.",
      };
    }
    const sr = cercanasASinRetiro(ciudad, texto);
    if (sr?.agencias.length) {
      remember(sr.agencias);
      return {
        estado: "cercanas",
        ciudad,
        totalCiudad: deCiudad(ciudad, true).length,
        agencias: sr.agencias,
        nota: `El cliente pidió «${sr.nombrada.nombreCorto}», pero esa agencia no entrega paquetes al cliente; estas son las más cercanas a ella.`,
      };
    }
  }

  let r: AgencySearch;
  try {
    r = await serviceSearch(baseUrl, q, fetchImpl);
  } catch (e) {
    if (!ciudad) throw e;
    r = fromDirectory(ciudad); // el servicio no responde: directorio local
  }

  const city = r.ciudad ? (ciudadDe(r.ciudad) ?? ciudad) : ciudad;
  if (opts.geocoder && city && ["falta_sector", "sin_ciudad", "cercanas"].includes(r.estado)) {
    // Con tope de tiempo: el cliente no espera al mapa; sin punto se usa lo del buscador.
    const geo = await Promise.race([
      opts.geocoder
        .cercanasPorReferencia(city, [texto], opts.nombreCliente ?? "")
        .catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), GEO_BUDGET_MS).unref?.()),
    ]);
    if (geo?.agencias.length) {
      remember(geo.agencias);
      const previa = r.agencias[0];
      const alternativas =
        previa && !geo.agencias.some((a) => a.nombre === previa.nombre)
          ? [...geo.agencias.slice(0, 2), previa]
          : geo.agencias;
      return {
        estado: "cercanas",
        ciudad: city,
        totalCiudad: r.totalCiudad || deCiudad(city, true).length,
        agencias: alternativas,
        nota: `Ordenadas por distancia a «${geo.punto || geo.referencia}» (referencia del cliente).`,
      };
    }
  }
  return r;
}

/**
 * Valida la agencia que eligió el cliente (registro o nombre de una agencia ya mostrada).
 * Si el proceso se reinició, la vuelve a buscar por su nombre.
 */
export async function resolveAgency(
  baseUrl: string,
  value: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Agency | null> {
  const key = norm(value);
  const name = norm(value.split("---")[0] ?? "");
  const hit = seen.get(key) ?? seen.get(name);
  if (hit && Date.now() - hit.at < SEEN_TTL) return hit.agency;
  if (!name) return null;
  const r = await query(baseUrl, name.replace(/_/g, " "), fetchImpl).catch(() => null);
  const found = r?.list.find((a) => norm(a.nombre) === name);
  if (found) return found;
  // Directorio local (servicio caído o agencia fuera de los resultados).
  const city = ciudadDe(name.replace(/_/g, " "));
  return city ? (deCiudad(city).find((a) => norm(a.nombre) === name) ?? null) : null;
}

// ---------- Modo de entrega por tienda ----------

/** Modo de la tienda (fila `integrations` kind=servientrega; config {mode}). */
export async function agencyMode(
  db: Database,
  tenantId: string,
  encryptionKey: string,
): Promise<AgencyMode> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(integrations).where(eq(integrations.kind, SERVIENTREGA_KIND)),
  );
  if (row?.status !== "active") return "off";
  try {
    const cfg = JSON.parse(decryptSecret(row.configEnc, encryptionKey)) as { mode?: string };
    return cfg.mode === "solo" ? "solo" : "opcion";
  } catch {
    return "opcion";
  }
}

export async function setAgencyMode(
  db: Database,
  tenantId: string,
  mode: AgencyMode,
  encryptionKey: string,
) {
  await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(eq(integrations.kind, SERVIENTREGA_KIND));
    const values = {
      status: mode === "off" ? "inactive" : "active",
      configEnc: encryptSecret(JSON.stringify({ mode }), encryptionKey),
    };
    if (row) await tx.update(integrations).set(values).where(eq(integrations.id, row.id));
    else await tx.insert(integrations).values({ kind: SERVIENTREGA_KIND, ...values });
  });
}
