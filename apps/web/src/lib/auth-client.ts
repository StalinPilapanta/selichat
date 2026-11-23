"use client";
import { ac, roles } from "@chatea/shared/access";
import { magicLinkClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [organizationClient({ ac, roles }), magicLinkClient()],
});

export const { useSession, useActiveOrganization, useListOrganizations } = authClient;
