// Constantes et fonctions partagées du module RH (fichier ORDINAIRE, pas "use server").

export const STATUTS_PROJET = ["en_cours", "termine", "annule"] as const;
export type StatutProjet = (typeof STATUTS_PROJET)[number];
export const LIBELLES_STATUT_PROJET: Record<StatutProjet, string> = {
  en_cours: "En cours",
  termine: "Terminé",
  annule: "Annulé",
};

export const STATUTS_TEMPS = ["brouillon", "soumis", "valide"] as const;
export type StatutTemps = (typeof STATUTS_TEMPS)[number];
export const LIBELLES_STATUT_TEMPS: Record<StatutTemps, string> = {
  brouillon: "Brouillon",
  soumis: "Soumis",
  valide: "Validé",
};

export type FicheResume = { id: string; nom: string; prenom: string | null; manager_id: string | null };

export function nomComplet(f: { prenom: string | null; nom: string }): string {
  return [f.prenom, f.nom].filter(Boolean).join(" ");
}

/**
 * Managers que la BASE acceptera pour cette fiche (même règle que le déclencheur verifier_manager) :
 * ni la personne elle-même, ni quelqu'un qu'elle encadre directement ou indirectement (boucle).
 */
export function managersPossibles(fiches: FicheResume[], ficheId: string | null): FicheResume[] {
  if (!ficheId) return fiches;
  const subordonnes = new Set<string>([ficheId]);
  let ajout = true;
  while (ajout) {
    ajout = false;
    for (const f of fiches) {
      if (f.manager_id && subordonnes.has(f.manager_id) && !subordonnes.has(f.id)) {
        subordonnes.add(f.id);
        ajout = true;
      }
    }
  }
  return fiches.filter((f) => !subordonnes.has(f.id));
}

/** Statuts autorisés à la saisie par la règle d'insertion de la base. */
export const STATUTS_TEMPS_SAISIE = ["brouillon", "soumis"] as const;

/** Qui peut passer un temps en « validé » (règle temps_modification_encadrement). */
export function peutValiderTemps(role: string | null): boolean {
  return role === "admin" || role === "manager";
}
