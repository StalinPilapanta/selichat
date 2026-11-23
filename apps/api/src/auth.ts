import { type Database, schema, withTenant } from "@chatea/db";
import { ac, roles } from "@chatea/shared/access";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, organization } from "better-auth/plugins";
import type { Env } from "./env.js";
import type { Mailer } from "./mailer.js";

export function createAuth(deps: { env: Env; db: Database; mail: Mailer }) {
  const { env, db, mail } = deps;
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : undefined;

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.WEB_URL,
    basePath: "/api/auth",
    trustedOrigins: [env.WEB_URL],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    socialProviders: google,
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await mail({
            to: email,
            subject: "Tu enlace para entrar a Chatea",
            text: `Entra aquí: ${url}`,
          });
        },
      }),
      organization({
        ac,
        roles,
        creatorRole: "owner",
        invitationExpiresIn: 60 * 60 * 24 * 7,
        sendInvitationEmail: async ({ id, email, organization: org, inviter, role }) => {
          const url = `${env.WEB_URL}/invitacion/${id}`;
          await mail({
            to: email,
            subject: `${inviter.user.name} te invitó a ${org.name} en Chatea`,
            text: `Te invitaron como ${role}. Acepta la invitación aquí: ${url}`,
          });
        },
        organizationHooks: {
          // Cada tenant nuevo arranca con su configuración por defecto (Ecuador, USD).
          afterCreateOrganization: async ({ organization: org, user }) => {
            await withTenant(db, org.id, async (tx) => {
              await tx.insert(schema.tenantSettings).values({}).onConflictDoNothing();
              await tx
                .insert(schema.auditLog)
                .values({ actorUserId: user.id, action: "tenant.created", target: org.id });
            });
          },
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
