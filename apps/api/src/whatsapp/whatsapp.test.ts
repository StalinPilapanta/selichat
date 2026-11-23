import { describe, expect, it } from "vitest";
import { parseWebhook, previewOf } from "./parse.js";
import { toPayload } from "./service.js";
import { sign, verifySignature } from "./signature.js";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("firma del webhook", () => {
  const body = Buffer.from('{"a":1}');
  it("acepta la firma correcta y rechaza alteraciones", () => {
    expect(verifySignature(body, sign(body, SECRET), SECRET)).toBe(true);
    expect(verifySignature(Buffer.from('{"a":2}'), sign(body, SECRET), SECRET)).toBe(false);
    expect(verifySignature(body, sign(body, "otro"), SECRET)).toBe(false);
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
    expect(verifySignature(body, "sha256=zz", SECRET)).toBe(false);
  });
});

const payload = (value: object, field = "messages") => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field, value }] }],
});

describe("parseWebhook", () => {
  it("texto con referral de anuncio y nombre de perfil", () => {
    const p = parseWebhook(
      payload({
        metadata: { phone_number_id: "111" },
        contacts: [{ wa_id: "593991234567", profile: { name: "Ana" } }],
        messages: [
          {
            from: "593991234567",
            id: "wamid.A",
            timestamp: "1795000000",
            type: "text",
            text: { body: "Hola me interesa el Mega Red" },
            referral: {
              source_type: "ad",
              source_id: "120250514665380388",
              ctwa_clid: "clid-1",
              headline: "Promo",
            },
          },
        ],
      }),
    );
    expect(p.phoneNumberIds).toEqual(["111"]);
    expect(p.messages[0]).toMatchObject({
      waMessageId: "wamid.A",
      from: "593991234567",
      profileName: "Ana",
      type: "text",
      body: "Hola me interesa el Mega Red",
      referral: { sourceId: "120250514665380388", ctwaClid: "clid-1", headline: "Promo" },
    });
    expect(p.messages[0]?.timestamp.toISOString()).toBe(new Date(1795000000 * 1000).toISOString());
  });

  it("media, ubicación, botón, respuesta interactiva y tipos desconocidos", () => {
    const p = parseWebhook(
      payload({
        metadata: { phone_number_id: "111" },
        messages: [
          {
            from: "1",
            id: "m1",
            timestamp: "1",
            type: "image",
            image: { id: "MID", mime_type: "image/jpeg", caption: "foto" },
          },
          {
            from: "1",
            id: "m2",
            timestamp: "1",
            type: "audio",
            audio: { id: "AID", mime_type: "audio/ogg; codecs=opus", voice: true },
          },
          {
            from: "1",
            id: "m3",
            timestamp: "1",
            type: "location",
            location: { latitude: -0.18, longitude: -78.4, name: "Quito" },
          },
          {
            from: "1",
            id: "m4",
            timestamp: "1",
            type: "button",
            button: { text: "CONFIRMAR", payload: "ok" },
          },
          {
            from: "1",
            id: "m5",
            timestamp: "1",
            type: "interactive",
            interactive: { type: "button_reply", button_reply: { id: "b1", title: "Sí" } },
          },
          { from: "1", id: "m6", timestamp: "1", type: "nuevo_tipo_raro" },
        ],
      }),
    );
    const [img, aud, loc, btn, inter, unk] = p.messages;
    expect(img).toMatchObject({
      type: "image",
      body: "foto",
      media: { waMediaId: "MID", mimeType: "image/jpeg" },
    });
    expect(aud).toMatchObject({ type: "audio", data: { voice: true } });
    expect(loc).toMatchObject({ type: "location", body: "Quito", data: { latitude: -0.18 } });
    expect(btn).toMatchObject({ type: "button", body: "CONFIRMAR", data: { payload: "ok" } });
    expect(inter).toMatchObject({ type: "interactive", body: "Sí", data: { id: "b1" } });
    expect(unk?.type).toBe("unsupported");
  });

  it("estados con error y actualización de plantillas", () => {
    const p = parseWebhook({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "111" },
                statuses: [
                  { id: "wamid.X", status: "read", timestamp: "2" },
                  {
                    id: "wamid.Y",
                    status: "failed",
                    timestamp: "2",
                    errors: [
                      { code: 131047, title: "Re-engagement", error_data: { details: "24h" } },
                    ],
                  },
                  { id: "wamid.Z", status: "deleted", timestamp: "2" },
                ],
              },
            },
            {
              field: "message_template_status_update",
              value: {
                event: "APPROVED",
                message_template_id: "T1",
                message_template_name: "confirmacion",
                message_template_language: "es",
              },
            },
          ],
        },
      ],
    });
    expect(p.statuses.map((s) => [s.waMessageId, s.status])).toEqual([
      ["wamid.X", "leido"],
      ["wamid.Y", "fallido"],
    ]);
    expect(p.statuses[1]?.error).toEqual({ code: 131047, title: "Re-engagement", detail: "24h" });
    expect(p.templates).toEqual([
      { metaId: "T1", name: "confirmacion", language: "es", status: "APPROVED", reason: null },
    ]);
  });

  it("previewOf y payloads salientes", () => {
    expect(previewOf("image", "")).toBe("📷 Imagen");
    expect(previewOf("text", "x".repeat(200)).length).toBe(118);
    expect(
      toPayload({
        kind: "media",
        mediaType: "document",
        url: "https://x/a.pdf",
        caption: "c",
        filename: "a.pdf",
      }),
    ).toEqual({
      type: "document",
      document: { link: "https://x/a.pdf", caption: "c", filename: "a.pdf" },
    });
    expect(
      toPayload({ kind: "template", name: "t", language: "es", params: ["Ana"], preview: "" }),
    ).toEqual({
      type: "template",
      template: {
        name: "t",
        language: { code: "es" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }],
      },
    });
  });
});
