"use server";
// ⚠️ Fichier "use server" : il n'exporte QUE des fonctions asynchrones.
// Les listes (types, statuts, catégories) sont dans src/lib/absences.ts (fichier ordinaire).
// Chaque action REVÉRIFIE les droits ; la base les revérifie (RLS + fonctions + déclencheurs).

import { revalidatePath } from "next/cache";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { obtenirUtilisateurCourant } from "@/lib/session";
import {
  BUCKET_JUSTIFICATIFS as BUCKET,
  CATEGORIES_NOTE,
  joursDeLaPeriode,
  peutTraiterAbsences,
  TAILLE_MAX_JUSTIFICATIF,
  TYPES_CONGE,
  TYPES_JUSTIFICATIF,
} from "@/lib/absences";
import { creerClientAdmin } from "@/lib/supabase/admin";
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

// ─────────────────────────────────────────────────────────────────────────────
// Notes de frais
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enregistre une note de frais. Le justificatif a DÉJÀ été déposé par le navigateur dans
 * justificatifs/<id collaborateur>/… : on n'enregistre que son CHEMIN (jamais une adresse signée, qui expire).
 */
export async function creerNoteDeFrais(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const moi = await obtenirUtilisateurCourant();
  if (!moi.collaborateurId) return { erreur: "Votre compte n'est rattaché à aucune fiche : note impossible." };

  const chemin = String(donnees.get("justificatif") ?? "");
  const date = String(donnees.get("date_depense") ?? "");
  const montantSaisi = String(donnees.get("montant") ?? "").trim();
  const categorie = String(donnees.get("categorie") ?? "");

  const admin = creerClientAdmin();
  const nettoyer = async () => {
    // Un fichier déposé pour une note refusée ne doit pas traîner (seul le serveur peut supprimer).
    if (chemin.startsWith(`${moi.collaborateurId}/`)) await admin.storage.from(BUCKET).remove([chemin]);
  };

  // Le chemin doit être dans MON dossier : c'est la clé des règles de sécurité du stockage.
  const [dossier, fichier, ...reste] = chemin.split("/");
  if (dossier !== moi.collaborateurId || !fichier || reste.length > 0)
    return { erreur: "Justificatif invalide : il doit être déposé dans votre propre dossier." };

  if (!estDateIso(date)) return (await nettoyer(), { erreur: "Date de dépense invalide." });
  if (!(CATEGORIES_NOTE as readonly string[]).includes(categorie))
    return (await nettoyer(), { erreur: "Choisissez une catégorie." });
  const montant = lireCentiemes(montantSaisi);
  if (montant === null || montant === 0n)
    return (await nettoyer(), { erreur: "Montant invalide : un nombre positif, 2 décimales maximum (ex. 42,50)." });

  // Le fichier existe-t-il vraiment, avec un type et une taille acceptés ? (contrôle serveur, pas seulement à l'écran)
  const { data: liste } = await admin.storage.from(BUCKET).list(dossier, { search: fichier, limit: 1 });
  const objet = liste?.find((o) => o.name === fichier);
  if (!objet) return { erreur: "Justificatif introuvable dans le stockage : déposez-le à nouveau." };
  const meta = objet.metadata as { mimetype?: string; size?: number } | null;
  if (!meta?.mimetype || !TYPES_JUSTIFICATIF.includes(meta.mimetype))
    return (await nettoyer(), { erreur: "Le justificatif doit être une photo (JPEG, PNG, WebP, HEIC) ou un PDF." });
  if ((meta.size ?? 0) > TAILLE_MAX_JUSTIFICATIF)
    return (await nettoyer(), { erreur: "Justificatif trop lourd (10 Mo maximum)." });

  const supabase = await creerClientServeur();
  const { error } = await supabase.from("notes_de_frais").insert({
    collaborateur_id: moi.collaborateurId,
    date_depense: date,
    montant: versTexteDecimal(montant),
    categorie,
    justificatif_url: chemin, // le CHEMIN, pas une adresse
  });
  if (error) return (await nettoyer(), { erreur: `Enregistrement impossible : ${error.message}` });

  rafraichir();
  return { succes: "Note de frais enregistrée." };
}

/** Valide (soumise → validée) ou rembourse (validée → remboursée). Manager ou admin. */
export async function changerStatutNoteDeFrais(noteId: string, statut: string): Promise<EtatFormulaire> {
  const moi = await obtenirUtilisateurCourant();
  if (!peutTraiterAbsences(moi.role) || !moi.collaborateurId)
    return { erreur: "Le traitement des notes de frais est réservé aux managers et administrateurs." };
  if (!UUID.test(noteId)) return { erreur: "Note introuvable." };
  if (statut !== "validee" && statut !== "remboursee") return { erreur: "Statut inconnu." };

  const supabase = await creerClientServeur();
  const { data, error } = await supabase.rpc("changer_statut_note", { p_note_id: noteId, p_statut: statut });
  if (error) return { erreur: error.message };
  rafraichir();
  if (data === "deja_traitee") return { succes: "Cette note était déjà traitée : rien n'a changé." };
  return { succes: statut === "validee" ? "Note de frais validée." : "Note de frais marquée remboursée." };
}

/** L'auteur supprime sa note tant qu'elle est « soumise » ; le serveur retire ensuite son justificatif. */
export async function supprimerNoteDeFrais(noteId: string): Promise<EtatFormulaire> {
  const moi = await obtenirUtilisateurCourant();
  if (!moi.collaborateurId) return { erreur: "Compte non rattaché." };
  if (!UUID.test(noteId)) return { erreur: "Note introuvable." };

  const supabase = await creerClientServeur();
  const { data, error } = await supabase.from("notes_de_frais").delete().eq("id", noteId).select("justificatif_url");
  if (error) return { erreur: `Suppression impossible : ${error.message}` };
  if (!data?.length) return { erreur: "Seule une note à vous, encore « soumise », peut être supprimée." };
  const chemin = data[0].justificatif_url;
  if (chemin?.startsWith(`${moi.collaborateurId}/`)) await creerClientAdmin().storage.from(BUCKET).remove([chemin]);
  rafraichir();
  return { succes: "Note de frais supprimée." };
}
