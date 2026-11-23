import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, hasDb, testApp, WEB } from "./test-helpers.js";

function multipartBody(filename: string, type: string, content: Buffer) {
  const boundary = "----chateatest";
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe.skipIf(!hasDb)("Subida de archivos", () => {
  let app: FastifyInstance;
  let h: ReturnType<typeof client>;
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "chatea-up-"));
    app = await testApp({ UPLOAD_DIR: dir });
    h = client(app);
  });
  afterAll(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const upload = (cookie: string, filename: string, type: string, content: Buffer) => {
    const b = multipartBody(filename, type, content);
    return app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: { cookie, origin: WEB, "content-type": b.contentType },
      payload: b.payload,
    });
  };

  it("sube una imagen y la sirve públicamente con su tipo", async () => {
    const o = await h.owner("up");
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const res = await upload(o.cookie, "../../etc/passwd.png", "image/png", png);
    expect(res.statusCode, res.body).toBe(201);
    const { url, kind } = res.json();
    expect(kind).toBe("image");
    expect(url).toMatch(new RegExp(`^${WEB}/api/files/${o.org.id}/[0-9a-f-]{36}\\.png$`));

    const file = await app.inject({ url: url.replace(WEB, "") });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.rawPayload.equals(png)).toBe(true);
  });

  it("rechaza tipos no permitidos, rutas raras y usuarios sin permiso", async () => {
    const o = await h.owner("up2");
    expect(
      (await upload(o.cookie, "x.html", "text/html", Buffer.from("<script>"))).statusCode,
    ).toBe(415);
    expect((await app.inject({ url: `/api/files/${o.org.id}/..%2F..%2Fpasswd` })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ url: `/api/files/${o.org.id}/no-existe.png` })).statusCode).toBe(
      404,
    );
    const anon = await upload("", "a.png", "image/png", Buffer.from("x"));
    expect(anon.statusCode).toBe(401);
  });

  it("respeta el límite por tipo (imágenes 5 MB)", async () => {
    const o = await h.owner("up3");
    const big = Buffer.alloc(6 * 1024 * 1024, 1);
    const res = await upload(o.cookie, "big.jpg", "image/jpeg", big);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: "archivo_muy_grande", maxMb: 5 });
  });
});
