// Fichier ORDINAIRE (pas "use server") : il peut exporter des constantes.

export const ROLES = ["admin", "manager", "collaborateur"] as const;
export type Role = (typeof ROLES)[number];

export const LIBELLES_ROLES: Record<Role, string> = {
  admin: "Administrateur",
  manager: "Manager",
  collaborateur: "Collaborateur",
};
