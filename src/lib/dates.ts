// Dates « calendrier » au format AAAA-MM-JJ (fichier ordinaire, utilisable partout).
// Calculs faits à midi UTC pour ne jamais être décalés d'un jour par un changement d'heure.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const versDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
const versIso = (d: Date) => d.toISOString().slice(0, 10);

export function estDateIso(texte: unknown): texte is string {
  return typeof texte === "string" && ISO.test(texte) && !Number.isNaN(versDate(texte).getTime());
}

/** Date du jour à Paris (AAAA-MM-JJ). */
export function aujourdhuiParis(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
}

export function ajouterJours(iso: string, jours: number): string {
  const d = versDate(iso);
  d.setUTCDate(d.getUTCDate() + jours);
  return versIso(d);
}

/** Lundi de la semaine qui contient cette date. */
export function lundiDe(iso: string): string {
  const jour = versDate(iso).getUTCDay(); // 0 = dimanche
  return ajouterJours(iso, jour === 0 ? -6 : 1 - jour);
}

/** Les 7 jours (lundi → dimanche) de la semaine qui commence à `lundi`. */
export function joursDeLaSemaine(lundi: string): string[] {
  return Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));
}

/** Numéro de semaine ISO 8601. */
export function numeroSemaine(iso: string): number {
  // La semaine 1 est celle qui contient le 4 janvier ; on raisonne sur le jeudi de la semaine.
  const jeudi = versDate(ajouterJours(lundiDe(iso), 3));
  const quatreJanvier = versDate(`${jeudi.getUTCFullYear()}-01-04`);
  const jeudiSemaine1 = versDate(ajouterJours(lundiDe(versIso(quatreJanvier)), 3));
  return 1 + Math.round((jeudi.getTime() - jeudiSemaine1.getTime()) / (7 * 86_400_000));
}

export function formaterDate(iso: string, options: Intl.DateTimeFormatOptions = {}): string {
  return versDate(iso).toLocaleDateString("fr-FR", { timeZone: "UTC", ...options });
}

// ─── Heures : additionnées en centièmes entiers (jamais 0,1 + 0,2 = 0,30000000000000004) ───
export function enCentiemes(heures: number | string): number {
  return Math.round(Number(heures) * 100);
}

export function formaterHeures(centiemes: number): string {
  return (centiemes / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}
