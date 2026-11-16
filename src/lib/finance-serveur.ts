import "server-only";
import { creerClientAdmin } from "@/lib/supabase/admin";
import { calculerTotaux, depuisBase, montantLigne } from "@/lib/montants";
import { dernierJourDuMois, TAUX_TVA_FACTURE, type CalculFacture, type LigneFacture } from "@/lib/finance";

// ⚠️ Ces fonctions lisent taux_horaire avec la clé SECRÈTE : à n'appeler qu'APRÈS exigerAdmin().
// Le taux n'est jamais lisible par l'API (même pour l'admin) : seul le serveur le lit.

type TempsBrut = {
  heures: number | string;
  projets: { nom: string } | null;
  collaborateurs: { prenom: string | null; nom: string; taux_horaire: number | string } | null;
};

const nom = (c: { prenom: string | null; nom: string }) => [c.prenom, c.nom].filter(Boolean).join(" ");

/** Regroupe des temps en lignes « projet × taux », exactement comme generer_facture (somme des heures, puis × taux, arrondi). */
export function regrouperEnLignes(temps: TempsBrut[]): CalculFacture {
  const groupes = new Map<string, { projet: string; heures: bigint; taux: bigint; collaborateurs: Set<string> }>();
  const tauxAZero = new Set<string>();
  for (const t of temps) {
    const taux = depuisBase(t.collaborateurs?.taux_horaire ?? 0);
    const projet = t.projets?.nom ?? "—";
    if (taux === 0n && t.collaborateurs) tauxAZero.add(nom(t.collaborateurs));
    const cle = `${projet}|${taux}`;
    const g = groupes.get(cle) ?? { projet, heures: 0n, taux, collaborateurs: new Set<string>() };
    g.heures += depuisBase(t.heures);
    if (t.collaborateurs) g.collaborateurs.add(nom(t.collaborateurs));
    groupes.set(cle, g);
  }
  const lignes: LigneFacture[] = [...groupes.values()]
    .map((g) => ({
      projet: g.projet,
      heures: g.heures,
      taux: g.taux,
      montant: montantLigne(g.heures, g.taux),
      collaborateurs: [...g.collaborateurs].sort(),
    }))
    .sort((a, b) => a.projet.localeCompare(b.projet, "fr") || Number(a.taux - b.taux));
  const totaux = calculerTotaux(
    lignes.map((l) => ({ quantite: l.heures, prixUnitaire: l.taux })),
    TAUX_TVA_FACTURE,
  );
  return {
    lignes,
    totalHt: totaux.totalHt,
    tva: totaux.tva,
    totalTtc: totaux.totalTtc,
    nombreTemps: temps.length,
    tauxAZero: [...tauxAZero].sort(),
  };
}

const COLONNES = "heures, projets!inner(nom, client_id), collaborateurs(prenom, nom, taux_horaire)";

/** Aperçu AVANT génération : temps VALIDÉS, NON facturés, du client, sur le mois. */
export async function apercuFacturable(clientId: string, premierJour: string): Promise<CalculFacture> {
  const { data, error } = await creerClientAdmin()
    .from("temps")
    .select(COLONNES)
    .eq("statut", "valide")
    .is("facture_id", null)
    .eq("projets.client_id", clientId)
    .gte("date_saisie", premierJour)
    .lte("date_saisie", dernierJourDuMois(premierJour));
  if (error) throw new Error(`Lecture des temps impossible : ${error.message}`);
  return regrouperEnLignes((data ?? []) as unknown as TempsBrut[]);
}

/** Lignes d'une facture émise, reconstituées depuis SES temps rattachés, avec le taux D'AUJOURD'HUI. */
export async function lignesDeFacture(factureId: string): Promise<CalculFacture> {
  const { data, error } = await creerClientAdmin()
    .from("temps")
    .select("heures, projets(nom), collaborateurs(prenom, nom, taux_horaire)")
    .eq("facture_id", factureId);
  if (error) throw new Error(`Lecture des temps facturés impossible : ${error.message}`);
  return regrouperEnLignes((data ?? []) as unknown as TempsBrut[]);
}

/** Écart entre les montants FIGÉS à l'émission et ceux recalculés avec les taux d'aujourd'hui. */
export function ecartAvecFigé(
  calcul: CalculFacture,
  fige: { total_ht: number | string; tva: number | string; total_ttc: number | string },
) {
  const ht = depuisBase(fige.total_ht);
  const tva = depuisBase(fige.tva);
  const ttc = depuisBase(fige.total_ttc);
  const ecart = ht !== calcul.totalHt || tva !== calcul.tva || ttc !== calcul.totalTtc;
  return { ecart, figeHt: ht, figeTva: tva, figeTtc: ttc };
}
