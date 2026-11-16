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
  raisonSociale: "MISSION-WEBDEV",
  formeJuridique: "SAS au capital de 1 000 €",
  adresse: ["14 rue Bausset", "75015 Paris"],
  siret: "932 580 392 00011",
  rcs: "RCS Paris 932 580 392",
  tvaIntracommunautaire: "FR64 932580392",
  penalitesRetard:
    "taux de refinancement de la BCE majoré de 10 points (art. L441-10 du Code de commerce), exigibles dès le lendemain de la date d'échéance, sans qu'un rappel soit nécessaire.",
  indemniteRecouvrement: "40 € (montant légal, art. D441-5 du Code de commerce).",
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

const chiffres = (texte: string) => texte.replace(/\D/g, "");

/** Clé de Luhn (contrôle des SIREN et SIRET). */
function luhnValide(n: string): boolean {
  let somme = 0;
  [...n].reverse().forEach((c, i) => {
    let d = Number(c) * (i % 2 ? 2 : 1);
    if (d > 9) d -= 9;
    somme += d;
  });
  return n.length > 0 && somme % 10 === 0;
}

/**
 * Incohérences entre SIRET, RCS et TVA intracommunautaire (vide = tout est cohérent).
 * Les 9 premiers chiffres du SIRET (= SIREN) doivent se retrouver dans le RCS et dans la TVA,
 * et la clé de TVA doit être (12 + 3 × (SIREN mod 97)) mod 97.
 */
export function incoherencesMentions(e: Entreprise = ENTREPRISE): string[] {
  const problemes: string[] = [];
  const siret = chiffres(e.siret);
  const siren = siret.slice(0, 9);
  if (siret && (siret.length !== 14 || !luhnValide(siret))) problemes.push("le SIRET n'est pas un numéro valide (14 chiffres, clé de contrôle)");
  if (siret && e.rcs.trim() && !chiffres(e.rcs).includes(siren)) problemes.push(`le RCS ne reprend pas le SIREN ${siren} du SIRET`);
  const tva = e.tvaIntracommunautaire.replace(/\s/g, "").toUpperCase();
  if (siret && tva) {
    const m = /^FR(\d{2})(\d{9})$/.exec(tva);
    if (!m) problemes.push("le n° de TVA doit avoir la forme FR + 2 chiffres + SIREN");
    else {
      if (m[2] !== siren) problemes.push(`le n° de TVA ne reprend pas le SIREN ${siren} du SIRET`);
      const cle = (12 + 3 * (Number(m[2]) % 97)) % 97;
      if (Number(m[1]) !== cle) problemes.push(`la clé du n° de TVA devrait être ${String(cle).padStart(2, "0")}`);
    }
  }
  return problemes;
}

/** Valeur à imprimer : la mention, ou « À RENSEIGNER » si elle est vide. */
export function ouARenseigner(valeur: string): string {
  return valeur.trim() || A_RENSEIGNER;
}
