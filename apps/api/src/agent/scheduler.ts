/**
 * Programa los turnos del agente por conversación:
 * - Debounce: espera `debounceMs` desde el último mensaje del cliente para responder a la ráfaga
 *   completa ("hola" + "quiero info" + "precio?") en un solo turno.
 * - Exclusión: nunca corren dos turnos de la misma conversación a la vez; si llega un mensaje
 *   mientras el agente piensa, se agenda otro turno al terminar.
 *
 * En memoria (una instancia del API, igual que el bus). Si el proceso se reinicia, los turnos
 * pendientes se pierden: pasar a BullMQ cuando haya varias instancias.
 */
export type AgentRunner = (tenantId: string, conversationId: string) => Promise<unknown>;

export class AgentScheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  private running = new Set<string>();
  private again = new Set<string>();
  private idle: (() => void)[] = [];

  constructor(
    private run: AgentRunner,
    private debounceMs: number,
    private onError: (e: unknown, conversationId: string) => void = () => {},
  ) {}

  schedule(tenantId: string, conversationId: string) {
    const key = `${tenantId}:${conversationId}`;
    const prev = this.timers.get(key);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.timers.delete(key);
      void this.fire(key, tenantId, conversationId);
    }, this.debounceMs);
    t.unref?.();
    this.timers.set(key, t);
  }

  private async fire(key: string, tenantId: string, conversationId: string) {
    if (this.running.has(key)) {
      this.again.add(key);
      return;
    }
    this.running.add(key);
    try {
      await this.run(tenantId, conversationId);
    } catch (e) {
      this.onError(e, conversationId);
    } finally {
      this.running.delete(key);
      if (this.again.delete(key)) this.schedule(tenantId, conversationId);
      this.notifyIdle();
    }
  }

  /** Para pruebas: resuelve cuando no queda nada pendiente ni corriendo. */
  whenIdle(): Promise<void> {
    if (!this.timers.size && !this.running.size) return Promise.resolve();
    return new Promise((r) => this.idle.push(r));
  }

  private notifyIdle() {
    if (this.timers.size || this.running.size) return;
    for (const r of this.idle.splice(0)) r();
  }

  stop() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.notifyIdle();
  }
}
