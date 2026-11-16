"use server";
// ⚠️ Fichier "use server" : il n'exporte QUE des fonctions asynchrones.
// Chaque action REVÉRIFIE que l'utilisateur est admin ; la base le revérifie (RLS + generer_facture).

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { obtenirAdminOuNull } from "@/lib/session";
import { premierJourDuMois, STATUTS_FACTURE } from "@/lib/finance";
import type { EtatFormulaire } from "@/lib/formulaires";

const REFUS: EtatFormulaire = { erreur: "Action réservée à l'administrateur." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Génère la facture : tout se passe DANS LA BASE (generer_facture), en une seule transaction. */
export async function genererFacture(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  if (!(await obtenirAdminOuNull())) return REFUS;
  const clientId = String(donnees.get("client_id") ?? "");
  const mois = premierJourDuMois(donnees.get("mois"));
  if (!UUID.test(clientId)) return { erreur: "Choisissez un client." };
  if (!mois) return { erreur: "Choisissez un mois." };

  const supabase = await creerClientServeur();
  const { data: id, error } = await supabase.rpc("generer_facture", { p_client_id: clientId, p_mois: mois });
  if (error || !id) {
    // Les messages de la base sont déjà en français (rien à facturer, taux à 0 nommé…)
    return { erreur: error?.message ?? "Génération impossible." };
  }

  revalidatePath("/finance");
  redirect(`/finance/factures/${id}?generee=1`);
}

/** Change le statut d'une facture (la base interdit le retour en brouillon). */
export async function changerStatutFacture(factureId: string, statut: string): Promise<EtatFormulaire> {
  if (!(await obtenirAdminOuNull())) return REFUS;
  if (!UUID.test(factureId)) return { erreur: "Facture introuvable." };
  if (!(STATUTS_FACTURE as readonly string[]).includes(statut)) return { erreur: "Statut inconnu." };

  const supabase = await creerClientServeur();
  const { data, error } = await supabase.from("factures").update({ statut }).eq("id", factureId).select("numero");
  if (error) return { erreur: error.message };
  if (!data?.length) return { erreur: "Facture introuvable ou modification refusée par la base." };

  revalidatePath("/finance");
  revalidatePath(`/finance/factures/${factureId}`);
  return { succes: `Statut de ${data[0].numero} mis à jour.` };
}
