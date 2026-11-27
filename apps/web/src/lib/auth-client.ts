"use client";
import { ac, roles } from "@chatea/shared/access";
import {
  inferAdditionalFields,
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [
    organizationClient({ ac, roles }),
    magicLinkClient(),
    // WhatsApp del dueño (campo propio del usuario en el API).
    inferAdditionalFields({ user: { phone: { type: "string", required: false } } }),
  ],
});

export const { useSession, useActiveOrganization, useListOrganizations } = authClient;
