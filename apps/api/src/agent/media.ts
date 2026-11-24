/**
 * Audios e imágenes que mandó el cliente:
 * - Audio → se descarga de Meta, se transcribe una sola vez y el texto queda en
 *   messages.data.transcript (el agente lo lee como texto y la bandeja lo muestra).
 * - Imagen del turno actual (después de nuestra última respuesta) → se entrega al modelo
 *   como imagen, si el proveedor tiene visión.
 */
import { type Database, schema, withTenant } from "@chatea/db";
import { experimental_transcribe as transcribe } from "ai";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import type { TranscriberResolver } from "../ai/models.js";
import { graphFor, type WaConfig } from "../whatsapp/service.js";

const { messages, conversations, channels } = schema;

/** Límite por archivo para no mandar adjuntos enormes al modelo. */
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PER_TURN = 4;

export interface TurnImage {
  data: Uint8Array;
  mediaType: string;
}

export interface MediaDeps {
  db: Database;
  wa: WaConfig;
  resolveTranscriber?: TranscriberResolver;
  log?: { warn: (o: object, m: string) => void };
}

export async function prepareTurnMedia(
  deps: MediaDeps,
  tenantId: string,
  conversationId: string,
  opts: { vision: boolean },
): Promise<{ images: TurnImage[]; transcribed: number }> {
  const { db } = deps;
  const ctx = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ channel: channels })
      .from(conversations)
      .innerJoin(channels, eq(channels.id, conversations.channelId))
      .where(eq(conversations.id, conversationId));
    if (!row) return null;
    const [lastOut] = await tx
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "out")))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    const pending = await tx
      .select({
        id: messages.id,
        type: messages.type,
        media: messages.media,
        data: messages.data,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "in"),
          inArray(messages.type, ["audio", "image"]),
          gt(messages.createdAt, new Date(Date.now() - 24 * 3600_000)),
        ),
      )
      .orderBy(asc(messages.createdAt));
    return { channel: row.channel, lastOutAt: lastOut?.createdAt ?? null, pending };
  });
  if (!ctx) return { images: [], transcribed: 0 };

  const graph = graphFor(ctx.channel, deps.wa);
  const images: TurnImage[] = [];
  let transcribed = 0;
  let transcriber: Awaited<ReturnType<TranscriberResolver>> | undefined;

  for (const m of ctx.pending) {
    const mediaId = m.media?.waMediaId;
    if (!mediaId) continue;
    const data = (m.data ?? {}) as Record<string, unknown>;

    if (m.type === "audio") {
      if (typeof data.transcript === "string" || data.transcriptError) continue;
      if (transcribed >= MAX_PER_TURN) continue;
      if (transcriber === undefined)
        transcriber = (await deps.resolveTranscriber?.(tenantId)) ?? null;
      if (!transcriber) continue;
      try {
        const file = await graph.downloadMedia(mediaId);
        if (file.bytes.length > MAX_BYTES) throw new Error("audio demasiado grande");
        const r = await transcribe({ model: transcriber, audio: file.bytes });
        await saveData(db, tenantId, m.id, { ...data, transcript: r.text.trim() });
        transcribed++;
      } catch (e) {
        deps.log?.warn({ err: (e as Error).message, messageId: m.id }, "no se pudo transcribir");
        await saveData(db, tenantId, m.id, { ...data, transcriptError: true });
      }
      continue;
    }

    const inTurn = !ctx.lastOutAt || m.createdAt > ctx.lastOutAt;
    if (m.type === "image" && opts.vision && inTurn && images.length < MAX_PER_TURN) {
      try {
        const file = await graph.downloadMedia(mediaId);
        if (file.bytes.length > MAX_BYTES) continue;
        images.push({
          data: new Uint8Array(file.bytes),
          mediaType: file.mimeType.split(";")[0] || "image/jpeg",
        });
      } catch (e) {
        deps.log?.warn({ err: (e as Error).message, messageId: m.id }, "no se pudo leer la imagen");
      }
    }
  }
  return { images, transcribed };
}

async function saveData(
  db: Database,
  tenantId: string,
  messageId: string,
  data: Record<string, unknown>,
) {
  await withTenant(db, tenantId, (tx) =>
    tx.update(messages).set({ data }).where(eq(messages.id, messageId)),
  );
}
