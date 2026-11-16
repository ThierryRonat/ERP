// Constantes et types du module Finance (fichier ORDINAIRE, pas "use server").

import type { Centiemes } from "@/lib/montants";

export const STATUTS_FACTURE = ["brouillon", "emise", "envoyee", "payee"] as const;
export type StatutFacture = (typeof STATUTS_FACTURE)[number];
export const LIBELLES_STATUT_FACTURE: Record<StatutFacture, string> = {
  brouillon: "Brouillon",
  emise: "Émise",
  envoyee: "Envoyée",
  payee: "Payée",
};

/** Statuts proposables depuis un statut donné (même règle que le déclencheur : pas de retour en brouillon). */
export function statutsPossibles(actuel: StatutFacture): StatutFacture[] {
  return actuel === "brouillon" ? [...STATUTS_FACTURE] : STATUTS_FACTURE.filter((s) => s !== "brouillon");
}

/** TVA des factures : 20 %, en centièmes de pour cent (même valeur que generer_facture). */
export const TAUX_TVA_FACTURE: Centiemes = 2000n;

/** Une ligne de facture = un projet × un taux horaire (reconstituée depuis les temps). */
export type LigneFacture = {
  projet: string;
  heures: Centiemes; // centièmes d'heure
  taux: Centiemes; // centimes par heure
  montant: Centiemes; // centimes
  collaborateurs: string[];
};

export type CalculFacture = {
  lignes: LigneFacture[];
  totalHt: Centiemes;
  tva: Centiemes;
  totalTtc: Centiemes;
  nombreTemps: number;
  tauxAZero: string[]; // collaborateurs concernés dont le taux est à 0 → génération refusée
};

/** "2026-11" ou "2026-11-15" → "2026-11-01" ; null si invalide. */
export function premierJourDuMois(saisie: unknown): string | null {
  if (typeof saisie !== "string") return null;
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(saisie);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

export function dernierJourDuMois(premier: string): string {
  const [a, m] = premier.split("-").map(Number);
  const dernier = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${premier.slice(0, 8)}${String(dernier).padStart(2, "0")}`;
}
