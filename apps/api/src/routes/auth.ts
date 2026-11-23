import type { FastifyInstance } from "fastify";
import type { Auth } from "../auth.js";

/** Expone Better Auth en /api/auth/* adaptando la petición de Fastify a Fetch API. */
export async function authRoutes(app: FastifyInstance, opts: { auth: Auth }) {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = new Headers();
      for (const [k, v] of Object.entries(request.headers)) {
        if (v !== undefined) headers.append(k, Array.isArray(v) ? v.join(", ") : v);
      }
      const hasBody = request.method !== "GET" && request.body !== undefined;
      const res = await opts.auth.handler(
        new Request(url, {
          method: request.method,
          headers,
          body: hasBody ? JSON.stringify(request.body) : undefined,
        }),
      );
      reply.status(res.status);
      for (const [k, v] of res.headers) if (k !== "set-cookie") reply.header(k, v);
      const cookies = res.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.send(res.body ? await res.text() : null);
    },
  });
}
