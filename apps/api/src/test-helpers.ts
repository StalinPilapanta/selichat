import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { expect } from "vitest";
import type { AppDeps } from "./app.js";
import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

export const WEB = "http://localhost:3100";
export const hasDb = Boolean(process.env.DATABASE_URL && process.env.ENCRYPTION_KEY);

export async function testApp(extra: Record<string, string> = {}, deps: AppDeps = {}) {
  return buildApp(
    loadEnv({ ...process.env, NODE_ENV: "test", LOG_LEVEL: "warn", WEB_URL: WEB, ...extra }),
    deps,
  );
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function client(app: FastifyInstance) {
  const call = (cookie: string, method: Method, url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie, origin: WEB }, payload });

  async function signUp(name: string) {
    const email = `${name}-${randomUUID().slice(0, 8)}@test.local`;
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: WEB },
      payload: { email, password: "clave-segura-123", name },
    });
    expect(res.statusCode, res.body).toBe(200);
    const raw = res.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw : [raw ?? ""]).map((c) => c.split(";")[0]).join("; ");
    return { email, cookie };
  }

  async function createOrg(cookie: string, name: string) {
    const res = await call(cookie, "POST", "/api/auth/organization/create", {
      name,
      slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { id: string };
  }

  /** Usuario dueño de una tienda nueva, listo para llamar al API. */
  async function owner(name = "duena") {
    const u = await signUp(name);
    const org = await createOrg(u.cookie, `Tienda${name}`);
    return { ...u, org };
  }

  return { call, signUp, createOrg, owner };
}
