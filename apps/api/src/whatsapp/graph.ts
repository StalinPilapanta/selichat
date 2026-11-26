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

  /** App de Meta a la que pertenece el token. */
  tokenApp() {
    return this.call<{ id: string; name?: string }>("GET", "app?fields=id,name");
  }

  /** Con un token de app (`id|secret`): falla si el App Secret no es el de esa app. */
  appInfo(appId: string) {
    return this.call<{ id: string; name?: string }>("GET", `${appId}?fields=id,name`);
  }

  /** Con un token de app: tipo, vencimiento, permisos y WABAs a las que da acceso el token. */
  async debugToken(inputToken: string) {
    const r = await this.call<{
      data: {
        is_valid?: boolean;
        type?: string;
        expires_at?: number;
        scopes?: string[];
        granular_scopes?: { scope: string; target_ids?: string[] }[];
      };
    }>("GET", `debug_token?input_token=${encodeURIComponent(inputToken)}`);
    return r.data;
  }

  /** WABAs de los negocios del usuario del sistema (respaldo si el token no trae target_ids). */
  async ownedWabas() {
    const r = await this.call<{
      data?: { owned_whatsapp_business_accounts?: { data?: { id: string; name?: string }[] } }[];
    }>("GET", "me/businesses?fields=owned_whatsapp_business_accounts{id,name}");
    return (r.data ?? []).flatMap((b) => b.owned_whatsapp_business_accounts?.data ?? []);
  }

  waba(wabaId: string) {
    return this.call<{ id: string; name?: string }>("GET", `${wabaId}?fields=id,name`);
  }

  async wabaPhoneNumbers(wabaId: string) {
    const r = await this.call<{
      data: {
        id: string;
        display_phone_number: string;
        verified_name: string;
        quality_rating?: string;
        code_verification_status?: string;
        status?: string;
      }[];
    }>(
      "GET",
      `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,status`,
    );
    return r.data;
  }

  /**
   * Registra el número en la Cloud API (sin esto queda «pendiente» y no envía).
   * El PIN es la verificación en dos pasos: si el número ya tenía uno, debe ser el mismo.
   */
  registerPhone(phoneNumberId: string, pin: string) {
    return this.call<{ success: boolean }>("POST", `${phoneNumberId}/register`, {
      messaging_product: "whatsapp",
      pin,
    });
  }

  /** Webhook propio de este número (gana sobre el de la WABA y el de la app). */
  setPhoneWebhook(phoneNumberId: string, callbackUrl: string, verifyToken: string) {
    return this.call<{ success: boolean }>("POST", phoneNumberId, {
      webhook_configuration: { override_callback_uri: callbackUrl, verify_token: verifyToken },
    });
  }

  /** Con un token de app: suscripciones de webhooks configuradas en la app. */
  async appSubscriptions(appId: string) {
    const r = await this.call<{
      data: { object: string; callback_url?: string; fields?: { name: string }[] }[];
    }>("GET", `${appId}/subscriptions`);
    return r.data;
  }

  /** Con un token de app: configura el webhook de WhatsApp de la app (Meta lo verifica al instante). */
  subscribeAppWebhook(appId: string, callbackUrl: string, verifyToken: string) {
    return this.call<{ success: boolean }>("POST", `${appId}/subscriptions`, {
      object: "whatsapp_business_account",
      callback_url: callbackUrl,
      verify_token: verifyToken,
      fields: "messages",
    });
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

  /**
   * Marca leído y muestra «escribiendo…» al cliente (dura hasta 25 s o hasta la respuesta).
   * https://developers.facebook.com/docs/whatsapp/cloud-api/typing-indicators
   */
  typing(phoneNumberId: string, waMessageId: string) {
    return this.call("POST", `${phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: waMessageId,
      typing_indicator: { type: "text" },
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

  /** Cambia el contenido; Meta la vuelve a revisar (una aprobada admite pocas ediciones). */
  editTemplate(templateId: string, t: { category?: string; components: unknown[] }) {
    return this.call<{ success: boolean }>("POST", encodeURIComponent(templateId), t);
  }

  /** Borra solo ese idioma (hsm_id). El nombre no se puede reutilizar durante 30 días. */
  deleteTemplate(wabaId: string, name: string, templateId: string) {
    const q = new URLSearchParams({ name, hsm_id: templateId });
    return this.call<{ success: boolean }>("DELETE", `${wabaId}/message_templates?${q}`);
  }
}
