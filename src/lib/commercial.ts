// Listes de statuts et types du module Commercial.
// Fichier ORDINAIRE (pas "use server") : il peut exporter des constantes.

import type { Role } from "@/lib/roles";

export const STATUTS_PROSPECT = ["contacte", "devis_envoye", "gagne", "perdu"] as const;
export type StatutProspect = (typeof STATUTS_PROSPECT)[number];
export const LIBELLES_STATUT_PROSPECT: Record<StatutProspect, string> = {
  contacte: "Contacté",
  devis_envoye: "Devis envoyé",
  gagne: "Gagné",
  perdu: "Perdu",
};

export const STATUTS_DEVIS = ["brouillon", "envoye", "accepte", "refuse"] as const;
export type StatutDevis = (typeof STATUTS_DEVIS)[number];
export const LIBELLES_STATUT_DEVIS: Record<StatutDevis, string> = {
  brouillon: "Brouillon",
  envoye: "Envoyé",
  accepte: "Accepté",
  refuse: "Refusé",
};

export const TAUX_TVA_PAR_DEFAUT = "20";

/** Qui peut créer prospects et devis, et changer un statut. */
export function peutGererCommercial(role: Role | null, collaborateurId: string | null): boolean {
  return (role === "admin" || role === "manager") && collaborateurId !== null;
}

export type LigneSaisie = {
  designation: string;
  quantite: string;
  prixUnitaire: string;
};
