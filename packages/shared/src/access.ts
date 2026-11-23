import { createAccessControl } from "better-auth/plugins";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Control de acceso del plugin de organizaciones, compartido por API y web.
 * asesor y logística arrancan con permisos de miembro; se afinan en fases siguientes.
 */
// Alias explícito: evita que la declaración emitida expanda la firma genérica
// (eso la vuelve incompatible con el tipo AccessControl de Better Auth).
type OrgAccessControl = ReturnType<typeof createAccessControl<typeof defaultStatements>>;
export const ac: OrgAccessControl = createAccessControl(defaultStatements);

export const roles = {
  owner: ownerAc,
  admin: adminAc,
  asesor: ac.newRole({ ...memberAc.statements }),
  logistica: ac.newRole({ ...memberAc.statements }),
};
