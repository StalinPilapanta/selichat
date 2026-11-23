/**
 * Cliente mínimo de la Graph API de WhatsApp Cloud.
 * Docs: developers.facebook.com/docs/whatsapp/cloud-api
 */
export class GraphError extends Error {
  constructor(
    public status: number,
    public code: number | undefined,
    message: string,
  ) {
    super(message);
  }
  /** 190 = token inválido/vencido. */
  get tokenInvalid() {
    return this.code === 190 || this.status === 401;
  }
  /** 131047 = pasaron más de 24 h desde el último mensaje del cliente. */
  get windowClosed() {
    return this.code === 131047;
  }
}

export interface GraphOptions {
  accessToken: string;
  version: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export type OutgoingPayload =
  | { type: "text"; text: { body: string; preview_url?: boolean } }
  | { type: "image" | "video" | "audio" | "document" | "sticker"; [k: string]: unknown }
  | {
      type: "template";
      template: { name: string; language: { code: string }; components?: unknown[] };
    }
  | { type: "interactive"; interactive: Record<string, unknown> };

export class Graph {
  private base: string;
  private f: typeof fetch;
  constructor(private o: GraphOptions) {
    this.base = `${o.baseUrl ?? "https://graph.facebook.com"}/${o.version}`;
    this.f = o.fetchImpl ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.f(`${this.base}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.o.accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    }).catch((e: Error) => {
      throw new GraphError(0, undefined, `Meta no respondió: ${e.name}`);
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number };
    };
    if (!res.ok || data.error) {
      throw new GraphError(
        res.status,
        data.error?.code,
        data.error?.message ?? `HTTP ${res.status}`,
      );
    }
    return data as T;
  }

  /** Suscribe la app a los webhooks de la WABA (sin esto Meta no envía mensajes reales). */
  subscribeApp(wabaId: string) {
    return this.call<{ success: boolean }>("POST", `${wabaId}/subscribed_apps`);
  }

  phoneNumber(phoneNumberId: string) {
    return this.call<{
      id: string;
      display_phone_number: string;
      verified_name: string;
      quality_rating?: string;
    }>("GET", `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
  }

  async send(
    phoneNumberId: string,
    to: string,
    payload: OutgoingPayload,
    replyTo?: string,
  ): Promise<string> {
    const r = await this.call<{ messages?: { id: string }[] }>(
      "POST",
      `${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        ...(replyTo ? { context: { message_id: replyTo } } : {}),
        ...payload,
      },
    );
    const id = r.messages?.[0]?.id;
    if (!id) throw new GraphError(200, undefined, "Meta no devolvió id de mensaje");
    return id;
  }

  markRead(phoneNumberId: string, waMessageId: string) {
    return this.call("POST", `${phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: waMessageId,
    });
  }

  /** Descarga en 2 pasos: id → URL temporal → bytes (con el mismo token). */
  async downloadMedia(mediaId: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const meta = await this.call<{ url: string; mime_type: string }>("GET", mediaId);
    const res = await this.f(meta.url, {
      headers: { Authorization: `Bearer ${this.o.accessToken}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new GraphError(res.status, undefined, "No se pudo descargar la media");
    return { bytes: Buffer.from(await res.arrayBuffer()), mimeType: meta.mime_type };
  }

  async listTemplates(wabaId: string) {
    type T = {
      id: string;
      name: string;
      language: string;
      status: string;
      category: string;
      components: Record<string, unknown>[];
      rejected_reason?: string;
    };
    const all: T[] = [];
    let path: string | null =
      `${wabaId}/message_templates?fields=id,name,language,status,category,components,rejected_reason&limit=100`;
    for (let i = 0; path && i < 20; i++) {
      const r: { data: T[]; paging?: { next?: string; cursors?: { after?: string } } } =
        await this.call("GET", path);
      all.push(...r.data);
      const after = r.paging?.next ? r.paging.cursors?.after : undefined;
      path = after
        ? `${wabaId}/message_templates?fields=id,name,language,status,category,components,rejected_reason&limit=100&after=${after}`
        : null;
    }
    return all;
  }

  createTemplate(
    wabaId: string,
    t: { name: string; language: string; category: string; components: unknown[] },
  ) {
    return this.call<{ id: string; status: string; category: string }>(
      "POST",
      `${wabaId}/message_templates`,
      t,
    );
  }
}
