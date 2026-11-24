/**
 * Buscador de agencias Servientrega (servicio propio en Coolify, repo servientregaubicaciones):
 * GET {SERVIENTREGA_URL}/buscar?texto=<ciudad y sector> → oficinas más cercanas.
 * La URL es de la plataforma (variable de entorno); cada tienda solo lo activa o no.
 */
import { type Database, schema, withTenant } from "@chatea/db";
import { encryptSecret } from "@chatea/shared";
import { eq } from "drizzle-orm";

const { integrations } = schema;
export const SERVIENTREGA_KIND = "servientrega";

export interface Agency {
  nombre: string;
  ciudad: string;
  provincia: string;
  direccion: string;
  sector: string;
  telefono: string;
  horario: string;
  finDeSemana: string;
  entregaEnOficina: boolean;
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v).trim());

export async function findAgencies(
  baseUrl: string,
  texto: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ciudad: string | null; agencias: Agency[] }> {
  const url = `${baseUrl.replace(/\/$/, "")}/buscar?texto=${encodeURIComponent(texto.slice(0, 200))}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`buscador de agencias: HTTP ${res.status}`);
  const d = (await res.json()) as Json;
  const list = Array.isArray(d.resultados) ? (d.resultados as Json[]) : [];
  return {
    ciudad: str(d.ciudad_detectada) || null,
    agencias: list.slice(0, 3).map((a) => ({
      nombre: str(a.nombre),
      ciudad: str(a.ciudad),
      provincia: str(a.provincia),
      direccion: str(a.direccion),
      sector: str(a.sector),
      telefono: str(a.telefono),
      horario: str(a.horario_lun_vie),
      finDeSemana: str(a.horario_fin_semana),
      entregaEnOficina: str(a.entrega_en_oficina).toUpperCase() === "SI",
    })),
  };
}

/** ¿La tienda activó el buscador de agencias? */
export async function agenciesEnabled(db: Database, tenantId: string): Promise<boolean> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ status: integrations.status })
      .from(integrations)
      .where(eq(integrations.kind, SERVIENTREGA_KIND)),
  );
  return row?.status === "active";
}

export async function setAgenciesEnabled(
  db: Database,
  tenantId: string,
  enabled: boolean,
  encryptionKey: string,
) {
  await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(eq(integrations.kind, SERVIENTREGA_KIND));
    const status = enabled ? "active" : "inactive";
    if (row) await tx.update(integrations).set({ status }).where(eq(integrations.id, row.id));
    else
      await tx.insert(integrations).values({
        kind: SERVIENTREGA_KIND,
        configEnc: encryptSecret("{}", encryptionKey),
        status,
      });
  });
}
