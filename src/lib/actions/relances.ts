"use server";
// ⚠️ Fichier "use server" : il n'exporte QUE des fonctions asynchrones (les types ne comptent pas).
// Bloc admin des relances : chaque action REVÉRIFIE que l'utilisateur est admin.
// « Forcer » n'existe QUE ici (admin connecté) : l'adresse du planificateur ne peut jamais forcer.

import { revalidatePath } from "next/cache";
import { obtenirAdminOuNull } from "@/lib/session";
import {
  creerClientRelances,
  ErreurConfigurationRelances,
  traiterRelances,
  type BilanRelances,
} from "@/lib/relances";
import { ajouterJours, aujourdhuiParis } from "@/lib/dates";

export type ResultatRelance = {
  erreur?: string;
  succes?: string;
  bilan?: BilanRelances;
};

const REFUS: ResultatRelance = {
  erreur: "Action réservée à l'administrateur.",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function lancer(forcer: boolean): Promise<ResultatRelance> {
  try {
    const bilan = await traiterRelances({
      forcer,
      origine: forcer ? "forçage admin" : "test admin",
    });
    revalidatePath("/finance");
    return { bilan };
  } catch (e) {
    return {
      erreur:
        e instanceof ErreurConfigurationRelances || e instanceof Error
          ? e.message
          : String(e),
    };
  }
}

/** Même traitement que le planificateur (anti-doublon respecté). */
export async function testerRelance(): Promise<ResultatRelance> {
  if (!(await obtenirAdminOuNull())) return REFUS;
  return lancer(false);
}

/** Ignore l'anti-doublon du jour. Admin connecté UNIQUEMENT. */
export async function forcerRelance(): Promise<ResultatRelance> {
  if (!(await obtenirAdminOuNull())) return REFUS;
  return lancer(true);
}

/**
 * Crée un cas de test : échéance à HIER (et « émise » si la facture était en brouillon, car un brouillon
 * n'est jamais relancé). L'API n'autorise pas ces colonnes : on passe par la clé de service, après le contrôle admin.
 */
export async function rendreFactureEchue(
  factureId: string,
): Promise<ResultatRelance> {
  if (!(await obtenirAdminOuNull())) return REFUS;
  if (!UUID.test(factureId)) return { erreur: "Choisissez une facture." };
  try {
    const service = creerClientRelances();
    const { data: f } = await service
      .from("factures")
      .select("numero, statut")
      .eq("id", factureId)
      .maybeSingle();
    if (!f) return { erreur: "Facture introuvable." };
    if (f.statut === "payee")
      return {
        erreur: `${f.numero} est payée : une facture payée n'est jamais relancée.`,
      };
    const hier = ajouterJours(aujourdhuiParis(), -1);
    const { error } = await service
      .from("factures")
      .update({
        date_echeance: hier,
        ...(f.statut === "brouillon" ? { statut: "emise" } : {}),
      })
      .eq("id", factureId);
    if (error) return { erreur: `Modification impossible : ${error.message}` };
    revalidatePath("/finance");
    return {
      succes: `${f.numero} est maintenant échue (échéance au ${hier.split("-").reverse().join("/")})${
        f.statut === "brouillon" ? " et passée en « émise »" : ""
      }.`,
    };
  } catch (e) {
    return { erreur: e instanceof Error ? e.message : String(e) };
  }
}
