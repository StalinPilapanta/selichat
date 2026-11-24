/**
 * Agencias Servientrega por cercanía y por nombre (port de ventas-bot/agencias.py):
 *
 * - `nombradaEnTexto`: el cliente escribe el nombre de la zona/agencia («Guachi grande» →
 *   AMBATO_HUACHI GRANDE), comparado en forma «fonética» (gua/hua, v/b, z/s/c, ll/y, h muda)
 *   y tolerando 1 letra de diferencia.
 * - `cercanasASinRetiro`: nombró una agencia que NO entrega al cliente → las más cercanas a ella.
 * - `Geocoder.cercanasPorReferencia`: geocodifica la referencia («colegio La Salle», «García
 *   Moreno y Martínez Mera») con OpenStreetMap (Photon y Nominatim de respaldo) y ordena por
 *   distancia. Solo sale la referencia + la ciudad, nunca nombre ni teléfono.
 */
import type { Agency } from "./servientrega.js";
import { DIRECTORIO, type DirRow } from "./servientrega-directorio.js";

const PHOTON_URL = "https://photon.komoot.io/api/";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "selichat/1.0";

/** Agencias a más de esto del centro de su ciudad se ignoran (coordenadas erróneas). */
const MAX_KM_CENTRO = 25;
/** Un punto geocodificado debe caer a menos de esto del centro de la ciudad. */
const MAX_KM_PUNTO = 20;
/** Dos calles «se cruzan» si algún tramo de cada una queda a menos de esto. */
const MAX_KM_CRUCE = 0.6;

export interface GeoAgency extends Agency {
  lat: number | null;
  lon: number | null;
  distanciaKm?: number;
}

export const norm = (t: unknown) =>
  String(t ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function km(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const dp = r(lat2 - lat1);
  const dl = r(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

const titleCase = (v: string) => v.toLowerCase().replace(/(^|[\s(])\S/g, (c) => c.toUpperCase());
const shortName = (nombre: string) =>
  nombre.includes("_") ? nombre.split("_").slice(1).join(" ") : nombre;

function fromRow(r: DirRow): GeoAgency {
  const [nombre, ciudad, provincia, sector, direccion, telefono, retiro, h, f, lat, lon] = r;
  return {
    registro: [nombre, sector, direccion].join("---"),
    nombre,
    nombreCorto: titleCase(shortName(nombre) || ciudad),
    ciudad,
    provincia,
    direccion,
    sector,
    telefono,
    horario: h,
    finDeSemana: f,
    entregaEnOficina: retiro,
    lat,
    lon,
  };
}

let dirCache: GeoAgency[] | null = null;
export const directorio = () => {
  dirCache ??= DIRECTORIO.map(fromRow);
  return dirCache;
};

/** Ciudad del directorio que aparece en el texto (la más larga: «Santo Domingo» > «Santo»). */
export function ciudadDe(texto: string): string | null {
  const n = ` ${norm(texto)} `;
  let best: string | null = null;
  for (const c of new Set(directorio().map((a) => a.ciudad))) {
    const k = norm(c);
    if (k.length >= 3 && n.includes(` ${k} `) && (!best || k.length > norm(best).length)) best = c;
  }
  return best;
}

export function deCiudad(ciudad: string, soloRetiro = false) {
  const c = norm(ciudad);
  return directorio()
    .filter((a) => norm(a.ciudad) === c && (!soloRetiro || a.entregaEnOficina))
    .sort((a, b) => a.sector.localeCompare(b.sector) || a.nombre.localeCompare(b.nombre));
}

/** Agencias con coordenadas válidas y retiro en la ciudad, y el centro (mediana) de la ciudad. */
function agenciasCiudad(ciudad: string) {
  const lista = deCiudad(ciudad).filter((a) => a.lat != null && a.lon != null);
  if (!lista.length) return { lista: [] as GeoAgency[], centro: null };
  const med = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)] as number;
  const centro = {
    lat: med(lista.map((a) => a.lat as number)),
    lon: med(lista.map((a) => a.lon as number)),
  };
  const ok = lista.filter(
    (a) => km(centro.lat, centro.lon, a.lat as number, a.lon as number) <= MAX_KM_CENTRO,
  );
  const retiro = ok.filter((a) => a.entregaEnOficina);
  return { lista: retiro.length ? retiro : ok, centro };
}

function ordenarDesde(lista: GeoAgency[], lat: number, lon: number, limite: number) {
  return lista
    .map((a) => ({
      ...a,
      distanciaKm: Math.round(km(lat, lon, a.lat as number, a.lon as number) * 10) / 10,
    }))
    .sort((a, b) => (a.distanciaKm ?? 0) - (b.distanciaKm ?? 0))
    .slice(0, limite);
}

// ---------- Nombre de la agencia escrito por el cliente ----------

const GENERICOS = new Set([
  "principal",
  "centro",
  "norte",
  "sur",
  "matriz",
  "oficina",
  "agencia",
  "terminal",
  "mercado",
  "central",
]);
const NUMEROS: Record<string, string> = {
  uno: "1",
  una: "1",
  dos: "2",
  tres: "3",
  cuatro: "4",
  cinco: "5",
  seis: "6",
  siete: "7",
  ocho: "8",
  nueve: "9",
  diez: "10",
};

export function fonetica(t: string) {
  let s = ` ${norm(t)} `;
  // «mena dos» = «LA MENA 2»: números en palabras → cifras y sin artículos.
  s = s.replace(
    /\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/g,
    (m) => NUMEROS[m] ?? m,
  );
  while (/ (la|el|los|las|de|del) /.test(s)) s = s.replace(/ (la|el|los|las|de|del) /g, " ");
  s = s.replace(/ [gh]?u(?=[aei])/g, " w"); // guachi/huachi/uachi → wachi
  s = s.replace(/ h/g, " "); // h muda inicial
  s = s.replace(/ll/g, "y").replace(/v/g, "b").replace(/z/g, "s");
  s = s.replace(/c(?=[ei])/g, "s");
  s = s.replace(/(.)\1/g, "$1"); // letras dobles
  return s.replace(/\s+/g, " ").trim();
}

/** Distancia de edición (para tolerar 1 letra en palabras de 5+). */
function lev(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0] as number;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j] as number;
      d[j] = Math.min(
        (d[j] as number) + 1,
        (d[j - 1] as number) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return d[b.length] as number;
}

const parecida = (a: string, b: string) =>
  a === b || (a.length >= 5 && Math.abs(a.length - b.length) <= 1 && lev(a, b) <= 1);

function contieneNombre(textoFon: string, claveFon: string) {
  if (` ${textoFon} `.includes(` ${claveFon} `)) return true;
  const pt = textoFon.split(" ");
  const pc = claveFon.split(" ");
  for (let i = 0; i + pc.length <= pt.length; i++)
    if (pc.every((w, j) => parecida(pt[i + j] as string, w))) return true;
  return false;
}

function claves(lista: GeoAgency[]) {
  return lista
    .map((a) => ({ clave: fonetica(shortName(a.nombre)), a }))
    .filter((x) => x.clave.length >= 4 && !GENERICOS.has(x.clave));
}

function masLarga(hits: { clave: string; a: GeoAgency }[]) {
  return hits.reduce((m, x) => (x.clave.length > m.clave.length ? x : m)).a;
}

/** ¿El cliente nombró una agencia con retiro de su ciudad? Gana el nombre más largo. */
export function nombradaEnTexto(ciudad: string, texto: string) {
  const tf = fonetica(texto);
  const hits = claves(deCiudad(ciudad, true)).filter((x) => contieneNombre(tf, x.clave));
  return hits.length ? masLarga(hits) : null;
}

/** Nombró una agencia que NO entrega al cliente (p. ej. QUITO_LA MENA 2): las más cercanas a ella. */
export function cercanasASinRetiro(ciudad: string, texto: string, limite = 3) {
  const c = norm(ciudad);
  const sinRetiro = directorio().filter(
    (a) => norm(a.ciudad) === c && !a.entregaEnOficina && a.lat != null,
  );
  const tf = fonetica(texto);
  const hits = claves(sinRetiro).filter((x) => contieneNombre(tf, x.clave));
  if (!hits.length) return null;
  const ref = masLarga(hits);
  const { lista } = agenciasCiudad(ciudad);
  const conRetiro = lista.filter((a) => a.entregaEnOficina);
  if (!conRetiro.length) return null;
  return {
    nombrada: ref,
    agencias: ordenarDesde(conRetiro, ref.lat as number, ref.lon as number, limite),
  };
}

// ---------- Referencias de lugar → punto en el mapa ----------

const PISTAS = [
  "sector",
  "barrio",
  "cdla",
  "ciudadela",
  "colegio",
  "escuela",
  "parque",
  "av ",
  "av.",
  "avenida",
  "calle",
  "cerca",
  "frente",
  "junto",
  "mercado",
  "iglesia",
  "hospital",
  "redondel",
  "terminal",
  "universidad",
  "centro",
  "norte",
  "sur",
  "via ",
  "km",
  "parada",
  "estadio",
  "gasolinera",
  "supermercado",
  "mall",
  "plaza",
  "coliseo",
  "urbanizacion",
  "conjunto",
  "entrada",
  "cancha",
  "hotel",
  "banco",
  "farmacia",
];
const QUITAR = new Set([
  "sector",
  "barrio",
  "ecuador",
  "ciudad",
  "provincia",
  "por",
  "favor",
  "retiro",
  "retirar",
  "agencia",
  "servientrega",
  "ok",
  "si",
  "gracias",
]);
const CONECTOR_CRUCE = /\s(?:y|e|esq|esquina|entre|con|interseccion)\s/;
const PREFIJO_CALLE =
  /^(?:calle|calles|av|avenida|avda|pasaje|psje|via|diagonal|direccion|dir|en|la|el|de)\s+/;

/** «calle garcia moreno y martinez mera 469» → ["garcia moreno", "martinez mera"]. */
export function callesDe(ref: string): string[] {
  const partes = ` ${ref} `.split(CONECTOR_CRUCE);
  if (partes.length < 2) return [];
  const out: string[] = [];
  for (const raw of partes.slice(0, 3)) {
    let p = raw.replace(/\b(?:n|no|nro|numero|s n|sn|casa|lote|mz|manzana|barrio)\b/g, " ");
    // Números de casa fuera; los de calles-fecha («9 de octubre») se quedan.
    p = p
      .replace(/\b\d+[a-z]?\b(?!\s+de\b)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    for (let q = p.replace(PREFIJO_CALLE, ""); q !== p; q = p.replace(PREFIJO_CALLE, "")) p = q;
    if (p.length >= 3 && !/^\d+$/.test(p)) out.push(p);
  }
  return out.length >= 2 ? out : [];
}

const pareceCruce = (n: string) => {
  const c = callesDe(n);
  return c.length > 0 && c.slice(0, 2).every((x) => x.split(" ").length >= 2) && n.length <= 90;
};

/** Referencias de lugar del texto, sin ciudad ni palabras del nombre del cliente. */
export function referenciasDeLugar(textos: string[], ciudad: string, excluir = "", maximo = 3) {
  const quitar = new Set([
    ...norm(ciudad)
      .split(" ")
      .filter((w) => w.length > 2),
    ...QUITAR,
  ]);
  // Privacidad: palabras del nombre del cliente nunca salen al geocodificador.
  const nombre = new Set(
    norm(excluir)
      .split(" ")
      .filter((w) => w.length > 1),
  );
  const refs: string[] = [];
  for (const t of textos) {
    if (!t || t.length > 160) continue;
    let n = norm(t);
    if (!PISTAS.some((p) => ` ${n} `.includes(p)) && !pareceCruce(n)) continue;
    if (nombre.size && n.split(" ").filter((w) => nombre.has(w)).length >= 2) {
      const alt = PISTAS.map((p) => p.trim().replace(".", "\\.")).join("|");
      const m = new RegExp(`\\b(${alt})`).exec(n);
      n = m ? n.slice(m.index) : "";
    }
    const palabras = n.split(" ").filter((w) => w && !quitar.has(w) && !nombre.has(w));
    while (palabras.length && ["en", "el", "la", "de", "del", "y", "a"].includes(palabras[0] ?? ""))
      palabras.shift();
    const ref = palabras.join(" ");
    if (ref.length < 3 || refs.includes(ref)) continue;
    refs.push(ref);
    if (refs.length >= maximo) break;
  }
  return refs;
}

type Punto = { lat: number; lon: number; nombre: string; calle: boolean };
type LatLon = { lat: number; lon: number };

/** Geocodificador con 1 petición por segundo (política de OpenStreetMap) y caché. */
export class Geocoder {
  private last = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, Punto[]>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private get(url: string): Promise<unknown> {
    const run = this.queue.then(async () => {
      const wait = 1100 - (Date.now() - this.last);
      if (wait > 0 && this.last) await new Promise((r) => setTimeout(r, wait));
      try {
        const res = await this.fetchImpl(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(4_000),
        });
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      } finally {
        this.last = Date.now();
      }
    });
    this.queue = run.catch(() => null);
    return run;
  }

  async photon(q: string, centro: LatLon, cerca?: LatLon) {
    const p = new URLSearchParams({
      q,
      limit: "8",
      lat: String((cerca ?? centro).lat),
      lon: String((cerca ?? centro).lon),
      bbox: [centro.lon - 0.25, centro.lat - 0.25, centro.lon + 0.25, centro.lat + 0.25].join(","),
    });
    if (cerca) {
      p.set("zoom", "16");
      p.set("location_bias_scale", "0.1");
    }
    const d = (await this.get(`${PHOTON_URL}?${p}`)) as { features?: unknown[] } | null;
    const out: Punto[] = [];
    for (const f of d?.features ?? []) {
      const g = f as {
        geometry?: { coordinates?: number[] };
        properties?: Record<string, unknown>;
      };
      const c = g.geometry?.coordinates ?? [];
      if (c.length === 2)
        out.push({
          lat: Number(c[1]),
          lon: Number(c[0]),
          nombre: String(g.properties?.name ?? ""),
          calle: g.properties?.type === "street",
        });
    }
    return out;
  }

  async nominatim(q: string) {
    const p = new URLSearchParams({ q, format: "json", limit: "5", countrycodes: "ec" });
    const d = (await this.get(`${NOMINATIM_URL}?${p}`)) as Record<string, unknown>[] | null;
    return (Array.isArray(d) ? d : []).map((x) => ({
      lat: Number(x.lat),
      lon: Number(x.lon),
      nombre: String(x.display_name ?? "").split(",")[0] ?? "",
      calle: x.class === "highway",
    }));
  }

  /** Lugares posibles para la consulta dentro de la ciudad (con caché). */
  async candidatos(q: string, centro: LatLon) {
    const key = `${norm(q)}|${centro.lat.toFixed(2)},${centro.lon.toFixed(2)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    let res = await this.photon(q, centro);
    if (!res.length) res = await this.nominatim(q);
    res = res.filter(
      (x) => Number.isFinite(x.lat) && km(centro.lat, centro.lon, x.lat, x.lon) <= MAX_KM_PUNTO,
    );
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(key, res);
    return res;
  }

  /** Punto donde se cruzan dos calles, o null. */
  async cruce(calles: string[], ciudad: string, centro: LatLon) {
    const listas: Punto[][] = [];
    for (const c of calles.slice(0, 2)) {
      const cand = await this.candidatos(`${c}, ${ciudad}`, centro);
      if (!cand.length) return null;
      const calle = cand.filter((x) => x.calle);
      listas.push(calle.length ? calle : cand);
    }
    const par = () => {
      let best: { d: number; a: Punto; b: Punto } | null = null;
      for (const a of listas[0] ?? [])
        for (const b of listas[1] ?? []) {
          const d = km(a.lat, a.lon, b.lat, b.lon);
          if (!best || d < best.d) best = { d, a, b };
        }
      return best;
    };
    let best = par();
    if (best && best.d > MAX_KM_CRUCE) {
      // Avenidas largas: el geocodificador solo da algunos tramos; se busca junto a la otra.
      for (const [i, otra] of [
        [0, 1],
        [1, 0],
      ] as const) {
        const ref = listas[otra]?.[0];
        if (!ref) continue;
        const extra = (await this.photon(`${calles[i]}, ${ciudad}`, centro, ref)).filter(
          (x) => x.calle && km(centro.lat, centro.lon, x.lat, x.lon) <= MAX_KM_PUNTO,
        );
        listas[i] = [...(listas[i] ?? []), ...extra];
        best = par();
        if (best && best.d <= MAX_KM_CRUCE) break;
      }
    }
    if (!best || best.d > MAX_KM_CRUCE) return null;
    return {
      lat: (best.a.lat + best.b.lat) / 2,
      lon: (best.a.lon + best.b.lon) / 2,
      nombre: `${best.a.nombre} y ${best.b.nombre}`,
    };
  }

  /** Agencias con retiro más cercanas a la referencia del cliente, o null. */
  async cercanasPorReferencia(ciudad: string, textos: string[], nombreCliente = "", limite = 3) {
    const { lista, centro } = agenciasCiudad(ciudad);
    if (!lista.length || !centro) return null;
    for (const ref of referenciasDeLugar(textos, ciudad, nombreCliente)) {
      const calles = callesDe(ref);
      const punto =
        (calles.length ? await this.cruce(calles, ciudad, centro) : null) ??
        (await this.candidatos(`${ref}, ${ciudad}`, centro))[0] ??
        null;
      if (!punto) continue;
      return {
        punto: punto.nombre,
        referencia: ref,
        agencias: ordenarDesde(lista, punto.lat, punto.lon, limite),
      };
    }
    return null;
  }
}
