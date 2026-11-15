// Calculs monétaires EXACTS (fichier ordinaire : utilisé à l'écran ET côté serveur).
// Tout est compté en entiers (BigInt) au centième, jamais en nombres à virgule flottante :
// en JavaScript, 1.005 arrondi à 2 décimales donne 1.00 au lieu de 1.01.
// Règle d'arrondi identique à PostgreSQL round() : demi-unité arrondie en s'éloignant de zéro.

/** Un nombre décimal positif ou nul, en centièmes (ex. "641,25" → 64125n). */
export type Centiemes = bigint;

const ESPACES = /[\s  ]/g;

/**
 * Lit une saisie française ou anglaise ("1 282,50", "1282.5", "20") avec au plus 2 décimales.
 * Renvoie null si la saisie n'est pas un nombre positif ou nul valide.
 */
export function lireCentiemes(saisie: string | number | null | undefined): Centiemes | null {
  if (saisie === null || saisie === undefined) return null;
  const texte = String(saisie).replace(ESPACES, "").replace(",", ".");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(texte);
  if (!m) return null;
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

/** Division entière arrondie à la demi-unité supérieure (valeurs positives). */
function diviserArrondi(n: bigint, d: bigint): bigint {
  return (n + d / 2n) / d;
}

/** Texte décimal à 2 chiffres pour la base de données (ex. 64125n → "641.25"). */
export function versTexteDecimal(c: Centiemes): string {
  const entier = c / 100n;
  const reste = (c % 100n).toString().padStart(2, "0");
  return `${entier}.${reste}`;
}

/** Montant d'une ligne en centimes = arrondi(quantité × prix unitaire). */
export function montantLigne(quantite: Centiemes, prixUnitaire: Centiemes): Centiemes {
  // (q/100) × (p/100) × 100 centimes = q × p / 100
  return diviserArrondi(quantite * prixUnitaire, 100n);
}

export type Totaux = {
  lignes: Centiemes[];
  totalHt: Centiemes;
  tva: Centiemes; // MONTANT de TVA (convention du projet)
  totalTtc: Centiemes;
};

/** Mêmes règles que la fonction SQL creer_devis : arrondi par ligne, puis TVA arrondie. */
export function calculerTotaux(
  lignes: { quantite: Centiemes; prixUnitaire: Centiemes }[],
  tauxTva: Centiemes,
): Totaux {
  const montants = lignes.map((l) => montantLigne(l.quantite, l.prixUnitaire));
  const totalHt = montants.reduce((s, m) => s + m, 0n);
  // HT (centimes) × taux (centièmes de %) / 100 / 100 → centimes
  const tva = diviserArrondi(totalHt * tauxTva, 10000n);
  return { lignes: montants, totalHt, tva, totalTtc: totalHt + tva };
}

/** Affichage écran : "1 282,50 €". Pour le PDF, utiliser formaterEurosPdf (espaces normales). */
export function formaterEuros(centimes: Centiemes | number): string {
  const valeur = typeof centimes === "bigint" ? Number(centimes) / 100 : centimes;
  return valeur.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

/** Depuis une valeur de la base (numeric renvoyé en nombre ou texte) vers des centimes. */
export function depuisBase(valeur: number | string | null): Centiemes {
  if (valeur === null) return 0n;
  const c = lireCentiemes(typeof valeur === "number" ? valeur.toFixed(2) : valeur);
  return c ?? 0n;
}

/** Taux affiché, recalculé depuis les montants (le taux n'est pas stocké). */
export function tauxDepuisMontants(totalHt: Centiemes, tva: Centiemes): string {
  if (totalHt === 0n) return "—";
  const taux = (Number(tva) / Number(totalHt)) * 100;
  return `${taux.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}
