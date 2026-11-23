import { EventEmitter } from "node:events";

/** Eventos que la bandeja recibe en vivo. */
export type InboxEvent =
  | { type: "message"; conversationId: string; messageId: string }
  | { type: "status"; conversationId: string; messageId: string; status: string }
  | { type: "conversation"; conversationId: string };

/**
 * Bus en memoria por tenant. Con una sola instancia del API (VPS) alcanza;
 * si se escala a varias, se reemplaza por Redis pub/sub con la misma interfaz.
 */
export class RealtimeBus {
  private ee = new EventEmitter();
  constructor() {
    this.ee.setMaxListeners(0);
  }
  publish(tenantId: string, e: InboxEvent) {
    this.ee.emit(tenantId, e);
  }
  subscribe(tenantId: string, fn: (e: InboxEvent) => void): () => void {
    this.ee.on(tenantId, fn);
    return () => this.ee.off(tenantId, fn);
  }
}
