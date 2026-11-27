/**
 * Huella del comprador: cuántos pedidos recibió o devolvió (tienda y Dropi).
 * La usan la ficha de la conversación y el formulario de pedido manual.
 */
export type FingerprintHistory = {
  orders: number;
  delivered: number;
  returned: number;
  cancelled: number;
};
export type FingerprintData = {
  local: FingerprintHistory;
  dropi: (FingerprintHistory & { deliveryRate: number | null }) | null;
  /** Huella digital global de Dropi (conexión por cuenta / MCP). */
  global?: {
    found: boolean;
    buyerType: string;
    riskLabel: string;
    deliveryProbability: number | null;
    returnProbability: number | null;
  };
  dropiConnected: boolean;
  dropiError?: string;
};

export function FingerprintView({ data }: { data: FingerprintData }) {
  const d = data.dropi;
  const g = data.global;
  const finished = d ? d.delivered + d.returned : 0;
  // Sin pedidos finalizados (ambas en 0) no hay datos: no se pinta como riesgo.
  const gHasData = g?.found && ((g.deliveryProbability ?? 0) > 0 || (g.returnProbability ?? 0) > 0);
  const rate = g ? (gHasData ? g.deliveryProbability : null) : (d?.deliveryRate ?? null);
  const tone =
    rate == null
      ? "border-zinc-200 dark:border-zinc-800"
      : rate >= 70
        ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950"
        : rate >= 40
          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
          : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950";
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${tone}`}>
      <div className="mb-1 font-medium text-sm">Huella del comprador</div>
      {g ? (
        g.found ? (
          <div className="space-y-0.5">
            {(g.buyerType || g.riskLabel) && (
              <p className="font-medium">
                {[g.buyerType, g.riskLabel].filter(Boolean).join(" · ")}
              </p>
            )}
            {gHasData ? (
              <p>
                En todo Dropi recibe el {g.deliveryProbability ?? 0}% de sus pedidos y devuelve el{" "}
                {g.returnProbability ?? 0}%
                {(g.deliveryProbability ?? 0) + (g.returnProbability ?? 0) < 100
                  ? " (el resto va en camino)"
                  : ""}
                .
              </p>
            ) : (
              <p className="text-zinc-500">Aún no hay pedidos finalizados para medirlo.</p>
            )}
          </div>
        ) : (
          <p className="text-zinc-500">Dropi no tiene huella digital para este teléfono.</p>
        )
      ) : d ? (
        d.orders ? (
          <p>
            {d.orders} pedido{d.orders === 1 ? "" : "s"} en tu Dropi: {d.delivered} entregado
            {d.delivered === 1 ? "" : "s"}, {d.returned} devuelto{d.returned === 1 ? "" : "s"}
            {d.cancelled ? `, ${d.cancelled} cancelado${d.cancelled === 1 ? "" : "s"}` : ""}.
            {d.deliveryRate != null
              ? ` Recibe el ${d.deliveryRate}% (${d.delivered} de ${finished}).`
              : " Aún sin pedidos finalizados."}
          </p>
        ) : (
          <p className="text-zinc-500">Sin pedidos anteriores en tu Dropi con este teléfono.</p>
        )
      ) : data.dropiError ? (
        <p className="text-red-600 dark:text-red-400">{data.dropiError}</p>
      ) : !data.dropiConnected ? (
        <p className="text-zinc-500">
          Conecta Dropi en Integraciones para ver su historial de entregas.
        </p>
      ) : null}
      {data.local.orders > 0 && (
        <p className="mt-1 text-zinc-500">
          En Selichat: {data.local.orders} pedido{data.local.orders === 1 ? "" : "s"}
          {data.local.delivered ? `, ${data.local.delivered} entregado(s)` : ""}
          {data.local.returned ? `, ${data.local.returned} devuelto(s)` : ""}.
        </p>
      )}
    </div>
  );
}
