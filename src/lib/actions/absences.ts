"use server";
// ⚠️ Fichier "use server" : il n'exporte QUE des fonctions asynchrones.
// Les listes (types, statuts, catégories) sont dans src/lib/absences.ts (fichier ordinaire).
// Chaque action REVÉRIFIE les droits ; la base les revérifie (RLS + fonctions + déclencheurs).

import { revalidatePath } from "next/cache";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { obtenirUtilisateurCourant } from "@/lib/session";
import { joursDeLaPeriode, peutTraiterAbsences, TYPES_CONGE } from "@/lib/absences";
import { lireCentiemes, versTexteDecimal } from "@/lib/montants";
import { estDateIso } from "@/lib/dates";
import type { EtatFormulaire } from "@/lib/formulaires";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rafraichir() {
  revalidatePath("/absences");
  revalidatePath("/rh/collaborateurs/[id]", "page");
}

// ─────────────────────────────────────────────────────────────────────────────
// Congés
// ─────────────────────────────────────────────────────────────────────────────

/** Demande de congé : chacun ne crée que LES SIENNES, au statut « demandée ». */
export async function demanderConge(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const moi = await obtenirUtilisateurCourant();
  if (!moi.collaborateurId) return { erreur: "Votre compte n'est rattaché à aucune fiche : demande impossible." };

  const type = String(donnees.get("type") ?? "");
  const debut = String(donnees.get("date_debut") ?? "");
  const fin = String(donnees.get("date_fin") ?? "");
  const joursSaisis = String(donnees.get("nb_jours") ?? "").trim();
  const motif = String(donnees.get("motif") ?? "").trim() || null;

  if (!(TYPES_CONGE as readonly string[]).includes(type)) return { erreur: "Choisissez un type de congé." };
  if (!estDateIso(debut) || !estDateIso(fin)) return { erreur: "Dates invalides." };
  if (fin < debut) return { erreur: "La date de fin doit être postérieure ou égale à la date de début." };
  if (joursSaisis === "") return { erreur: "Le nombre de jours est obligatoire." };
  const jours = lireCentiemes(joursSaisis);
  if (jours === null || jours === 0n || jours % 50n !== 0n)
    return { erreur: "Nombre de jours invalide : par demi-journées (ex. 1, 2,5, 0,5)." };
  const periode = joursDeLaPeriode(debut, fin);
  if (jours > BigInt(periode) * 100n)
    return { erreur: `${joursSaisis.replace(".", ",")} jours sur une période de ${periode} jour(s) : impossible.` };

  const supabase = await creerClientServeur();
  const { error } = await supabase.from("conges").insert({
    collaborateur_id: moi.collaborateurId,
    type,
    date_debut: debut,
    date_fin: fin,
    nb_jours: versTexteDecimal(jours),
    motif,
  });
  if (error) return { erreur: `Demande impossible : ${error.message}` };

  rafraichir();
  return { succes: "Demande de congé envoyée." };
}

/**
 * Valide un congé. Tout se passe DANS LA BASE (valider_conge) : le statut d'abord, uniquement s'il est
 * « demandée », et le solde n'est décrémenté que si une ligne a réellement changé.
 * Appelée deux fois de suite, la 2e ne change rien et ne décompte rien.
 */
export async function validerConge(congeId: string): Promise<EtatFormulaire> {
  const moi = await obtenirUtilisateurCourant();
  if (!peutTraiterAbsences(moi.role) || !moi.collaborateurId)
    return { erreur: "La validation est réservée aux managers et administrateurs." };
  if (!UUID.test(congeId)) return { erreur: "Congé introuvable." };

  const supabase = await creerClientServeur();
  const { data, error } = await supabase.rpc("valider_conge", { p_conge_id: congeId });
  if (error) return { erreur: error.message };
  rafraichir();
  return data === "validee"
    ? { succes: "Congé validé : le solde a été décompté." }
    : { succes: "Ce congé était déjà validé : rien n'a changé, le solde n'a pas été décompté une seconde fois." };
}

export async function refuserConge(congeId: string): Promise<EtatFormulaire> {
  const moi = await obtenirUtilisateurCourant();
  if (!peutTraiterAbsences(moi.role) || !moi.collaborateurId)
    return { erreur: "Le refus est réservé aux managers et administrateurs." };
  if (!UUID.test(congeId)) return { erreur: "Congé introuvable." };

  const supabase = await creerClientServeur();
  const { data, error } = await supabase.rpc("refuser_conge", { p_conge_id: congeId });
  if (error) return { erreur: error.message };
  rafraichir();
  return data === "refusee" ? { succes: "Congé refusé." } : { succes: "Ce congé était déjà traité : rien n'a changé." };
}

/** L'auteur annule (supprime) sa demande tant qu'elle n'est pas traitée. */
export async function annulerConge(congeId: string): Promise<EtatFormulaire> {
  const moi = await obtenirUtilisateurCourant();
  if (!moi.collaborateurId) return { erreur: "Compte non rattaché." };
  if (!UUID.test(congeId)) return { erreur: "Congé introuvable." };

  const supabase = await creerClientServeur();
  const { data, error } = await supabase.from("conges").delete().eq("id", congeId).select("id");
  if (error) return { erreur: `Annulation impossible : ${error.message}` };
  if (!data?.length) return { erreur: "Seule une demande à vous, encore « demandée », peut être annulée." };
  rafraichir();
  return { succes: "Demande annulée." };
}
