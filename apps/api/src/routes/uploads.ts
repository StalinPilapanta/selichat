import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Database } from "@chatea/db";
import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import type { Auth } from "../auth.js";
import { requireTenant } from "../plugins/tenant.js";

/** Tipos que acepta WhatsApp Cloud API; la extensión sale del tipo, nunca del nombre del archivo. */
const ALLOWED: Record<
  string,
  { ext: string; kind: "image" | "video" | "audio" | "document"; maxMb: number }
> = {
  "image/jpeg": { ext: "jpg", kind: "image", maxMb: 5 },
  "image/png": { ext: "png", kind: "image", maxMb: 5 },
  "image/webp": { ext: "webp", kind: "image", maxMb: 5 },
  "video/mp4": { ext: "mp4", kind: "video", maxMb: 16 },
  "video/3gpp": { ext: "3gp", kind: "video", maxMb: 16 },
  "audio/mpeg": { ext: "mp3", kind: "audio", maxMb: 16 },
  "audio/ogg": { ext: "ogg", kind: "audio", maxMb: 16 },
  "audio/aac": { ext: "aac", kind: "audio", maxMb: 16 },
  "audio/mp4": { ext: "m4a", kind: "audio", maxMb: 16 },
  "application/pdf": { ext: "pdf", kind: "document", maxMb: 16 },
};
const CONTENT_TYPE = Object.fromEntries(Object.entries(ALLOWED).map(([type, v]) => [v.ext, type]));
const MAX_BYTES = 16 * 1024 * 1024;

export async function uploadRoutes(
  app: FastifyInstance,
  opts: { auth: Auth; db: Database; uploadDir: string; publicBaseUrl: string },
) {
  const root = resolve(opts.uploadDir);
  const editors = requireTenant(opts.auth, opts.db, ["owner", "admin"]);
  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1, fields: 0 } });

  app.post("/api/uploads", { preHandler: editors }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "archivo_requerido" });
    const type = ALLOWED[file.mimetype];
    if (!type) {
      file.file.resume();
      return reply.code(415).send({ error: "tipo_no_permitido" });
    }
    const buf = await file.toBuffer().catch(() => null);
    if (!buf || file.file.truncated)
      return reply.code(413).send({ error: "archivo_muy_grande", maxMb: type.maxMb });
    if (buf.length > type.maxMb * 1024 * 1024)
      return reply.code(413).send({ error: "archivo_muy_grande", maxMb: type.maxMb });

    const name = `${randomUUID()}.${type.ext}`;
    const dir = join(root, req.ctx.tenantId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), buf);
    return reply.code(201).send({
      url: `${opts.publicBaseUrl}/api/files/${req.ctx.tenantId}/${name}`,
      kind: type.kind,
      bytes: buf.length,
    });
  });

  /**
   * Público a propósito: WhatsApp descarga la media por URL sin cookies.
   * Los nombres son UUID aleatorios, así que no se pueden adivinar.
   */
  app.get<{ Params: { tenant: string; name: string } }>(
    "/api/files/:tenant/:name",
    async (req, reply) => {
      const { tenant, name } = req.params;
      const m = name.match(/^[0-9a-f-]{36}\.([a-z0-9]{2,4})$/);
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant) || !m?.[1] || !CONTENT_TYPE[m[1]])
        return reply.code(404).send();
      const path = join(root, tenant, name);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) return reply.code(404).send();
      reply.header("content-type", CONTENT_TYPE[m[1]]);
      reply.header("content-length", info.size);
      reply.header("cache-control", "public, max-age=31536000, immutable");
      reply.header("x-content-type-options", "nosniff");
      return reply.send(createReadStream(path));
    },
  );
}
