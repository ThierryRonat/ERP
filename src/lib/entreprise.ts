// ═══════════════════════════════════════════════════════════════════════════════
//  VOS MENTIONS LÉGALES — à compléter (fichier ordinaire, imprimé sur devis et factures)
//  Remplissez le texte entre les guillemets. Tant qu'un champ obligatoire est vide,
//  l'écran Finance affiche une alerte et le PDF imprime « À RENSEIGNER » à sa place.
//  ⚠️ Le dépôt GitHub est PUBLIC : ces informations y seront visibles (comme sur vos factures).
// ═══════════════════════════════════════════════════════════════════════════════

export type Entreprise = {
  raisonSociale: string; // ex. "Dupont Conseil"
  formeJuridique: string; // ex. "SAS au capital de 10 000 €"
  adresse: string[]; // une ligne par élément, ex. ["12 rue de la Paix", "75002 Paris"]
  siret: string; // 14 chiffres, ex. "123 456 789 00012"
  rcs: string; // ex. "RCS Paris 123 456 789"
  tvaIntracommunautaire: string; // ex. "FR12 123456789"
  penalitesRetard: string; // ex. "Taux d'intérêt légal multiplié par 3, exigible dès le lendemain de l'échéance"
  indemniteRecouvrement: string; // ex. "Indemnité forfaitaire pour frais de recouvrement : 40 €"
  email: string; // facultatif
  telephone: string; // facultatif
};

export const ENTREPRISE: Entreprise = {
  raisonSociale: "",
  formeJuridique: "",
  adresse: [],
  siret: "",
  rcs: "",
  tvaIntracommunautaire: "",
  penalitesRetard: "",
  indemniteRecouvrement: "",
  email: "",
  telephone: "",
};

// ─── Ne rien modifier sous cette ligne ──────────────────────────────────────────

export const A_RENSEIGNER = "À RENSEIGNER";

const LIBELLES_OBLIGATOIRES: [keyof Entreprise, string][] = [
  ["raisonSociale", "raison sociale"],
  ["formeJuridique", "forme juridique"],
  ["adresse", "adresse"],
  ["siret", "SIRET"],
  ["rcs", "RCS"],
  ["tvaIntracommunautaire", "n° de TVA intracommunautaire"],
  ["penalitesRetard", "pénalités de retard"],
  ["indemniteRecouvrement", "indemnité de recouvrement"],
];

/** Liste des mentions obligatoires encore vides (vide = configuration complète). */
export function mentionsManquantes(e: Entreprise = ENTREPRISE): string[] {
  return LIBELLES_OBLIGATOIRES.filter(([cle]) => {
    const v = e[cle];
    return Array.isArray(v) ? v.every((l) => !l.trim()) : !String(v).trim();
  }).map(([, libelle]) => libelle);
}

/** Valeur à imprimer : la mention, ou « À RENSEIGNER » si elle est vide. */
export function ouARenseigner(valeur: string): string {
  return valeur.trim() || A_RENSEIGNER;
}
