/** Roles dentro de una organización (tenant). */
export const ROLES = ["owner", "admin", "asesor", "logistica"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Dueño",
  admin: "Administrador",
  asesor: "Asesor de ventas",
  logistica: "Logística",
};
