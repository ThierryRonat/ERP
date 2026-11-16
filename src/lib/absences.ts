// Constantes du module Absences (fichier ORDINAIRE : jamais de constante exportée d'un fichier "use server").

export const TYPES_CONGE = ["conges_payes", "rtt", "sans_solde"] as const;
export type TypeConge = (typeof TYPES_CONGE)[number];
export const LIBELLES_TYPE_CONGE: Record<TypeConge, string> = {
  conges_payes: "Congés payés",
  rtt: "RTT",
  sans_solde: "Sans solde",
};
/** Types qui décomptent le solde (même règle que le déclencheur decompter_solde_conge). */
export const TYPES_DECOMPTES: readonly TypeConge[] = ["conges_payes", "rtt"];

export const STATUTS_CONGE = ["demandee", "validee", "refusee"] as const;
export type StatutConge = (typeof STATUTS_CONGE)[number];
export const LIBELLES_STATUT_CONGE: Record<StatutConge, string> = {
  demandee: "Demandée",
  validee: "Validée",
  refusee: "Refusée",
};

export const CATEGORIES_NOTE = ["Transport", "Repas", "Hébergement", "Fournitures", "Autre"] as const;

export const STATUTS_NOTE = ["soumise", "validee", "remboursee"] as const;
export type StatutNote = (typeof STATUTS_NOTE)[number];
export const LIBELLES_STATUT_NOTE: Record<StatutNote, string> = {
  soumise: "Soumise",
  validee: "Validée",
  remboursee: "Remboursée",
};

/** Justificatifs acceptés (photo ou PDF), 10 Mo maximum. */
export const TYPES_JUSTIFICATIF = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];
export const TAILLE_MAX_JUSTIFICATIF = 10 * 1024 * 1024;

/** Qui peut valider/refuser (congés) ou valider/rembourser (notes). */
export function peutTraiterAbsences(role: string | null): boolean {
  return role === "admin" || role === "manager";
}

/** Peut-on traiter CETTE demande ? Personne ne traite la sienne, sauf l'admin (même règle que la base). */
export function peutTraiterCetteDemande(role: string | null, moi: string | null, auteur: string): boolean {
  return peutTraiterAbsences(role) && (auteur !== moi || role === "admin");
}

/** Nombre de jours calendaires d'une période (bornes incluses). */
export function joursDeLaPeriode(debut: string, fin: string): number {
  return Math.round((Date.parse(`${fin}T12:00:00Z`) - Date.parse(`${debut}T12:00:00Z`)) / 86_400_000) + 1;
}
