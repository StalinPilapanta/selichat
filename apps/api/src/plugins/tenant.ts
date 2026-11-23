import { type Database, schema } from "@chatea/db";
import type { Role } from "@chatea/shared";
import { fromNodeHeaders } from "better-auth/node";
import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Auth } from "../auth.js";

export interface TenantContext {
  userId: string;
  tenantId: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    ctx: TenantContext;
  }
}

/**
 * preHandler: exige sesión + organización activa y verifica la membresía en DB.
 * Deja en request.ctx el tenant y rol; las rutas solo usan request.ctx.tenantId.
 */
export function requireTenant(auth: Auth, db: Database, allowed?: readonly Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) return reply.code(401).send({ error: "no_autenticado" });

    const tenantId = session.session.activeOrganizationId;
    if (!tenantId) return reply.code(409).send({ error: "sin_organizacion_activa" });

    const [m] = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(eq(schema.member.organizationId, tenantId), eq(schema.member.userId, session.user.id)),
      )
      .limit(1);
    if (!m) return reply.code(403).send({ error: "no_es_miembro" });

    const role = m.role as Role;
    if (allowed && !allowed.includes(role))
      return reply.code(403).send({ error: "rol_insuficiente" });

    request.ctx = { userId: session.user.id, tenantId, role };
  };
}
