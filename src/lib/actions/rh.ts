"use server";
// ⚠️ Fichier "use server" : il n'exporte QUE des fonctions asynchrones.
// Les listes de statuts sont dans src/lib/rh.ts (fichier ordinaire).
// Chaque action REVÉRIFIE les droits ; la base les revérifie aussi (RLS + déclencheurs).

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { obtenirAdminOuNull, obtenirUtilisateurCourant } from "@/lib/session";
import { STATUTS_PROJET, STATUTS_TEMPS, STATUTS_TEMPS_SAISIE, peutValiderTemps } from "@/lib/rh";
import { lireCentiemes, versTexteDecimal } from "@/lib/montants";
import type { EtatFormulaire } from "@/lib/formulaires";

const REFUS_ADMIN: EtatFormulaire = { erreur: "Action réservée aux administrateurs." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Traduit les refus de la base en français lisible. */
function messageBase(message: string): string {
  if (message.includes("propre manager") || message.includes("Boucle de managers")) return message;
  if (message.includes("row-level security")) return "Refusé par les règles de sécurité de la base.";
  if (message.includes("permission denied")) return "Refusé : droits insuffisants sur cette donnée.";
  return message;
}

/** Crée (id vide) ou modifie une fiche collaborateur. Réservé à l'admin. */
export async function enregistrerCollaborateur(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  if (!(await obtenirAdminOuNull())) return REFUS_ADMIN;

  const id = String(donnees.get("id") ?? "").trim() || null;
  const texte = (cle: string) => String(donnees.get(cle) ?? "").trim() || null;
  const nom = texte("nom");
  const managerId = texte("manager_id");
  const dateEntree = texte("date_entree");
  const tauxSaisi = String(donnees.get("taux_horaire") ?? "").trim();

  if (id && !UUID.test(id)) return { erreur: "Fiche introuvable." };
  if (!nom) return { erreur: "Le nom est obligatoire." };
  // taux_horaire est NOT NULL dans la base : on refuse le vide AVANT d'aller vers une erreur illisible.
  if (tauxSaisi === "") return { erreur: "Le taux horaire est obligatoire (mettez 0 s'il ne s'applique pas)." };
  const taux = lireCentiemes(tauxSaisi);
  if (taux === null) return { erreur: "Taux horaire invalide : un nombre positif, 2 décimales maximum (ex. 85 ou 92,50)." };
  if (managerId && !UUID.test(managerId)) return { erreur: "Manager invalide." };
  if (id && managerId === id) return { erreur: "Un collaborateur ne peut pas être son propre manager." };
  if (dateEntree && !/^\d{4}-\d{2}-\d{2}$/.test(dateEntree)) return { erreur: "Date d'entrée invalide." };

  const valeurs = {
    nom,
    prenom: texte("prenom"),
    email: texte("email")?.toLowerCase() ?? null,
    poste: texte("poste"),
    date_entree: dateEntree,
    manager_id: managerId,
    taux_horaire: versTexteDecimal(taux),
  };

  // Client de SESSION : la règle « seul l'admin crée/modifie une fiche » et le garde-fou manager s'appliquent.
  // On ne relit jamais taux_horaire ici (colonne illisible par ce client) : seulement l'id.
  const supabase = await creerClientServeur();
  const requete = id
    ? supabase.from("collaborateurs").update(valeurs).eq("id", id).select("id")
    : supabase.from("collaborateurs").insert(valeurs).select("id");
  const { data, error } = await requete;
  if (error) return { erreur: `Enregistrement impossible : ${messageBase(error.message)}` };
  if (!data?.length) return { erreur: "Fiche introuvable ou modification refusée par la base." };

  revalidatePath("/rh");
  redirect(`/rh/collaborateurs/${data[0].id}?enregistree=1`);
}

/** Crée un projet. Réservé à l'admin. */
export async function creerProjet(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  if (!(await obtenirAdminOuNull())) return REFUS_ADMIN;

  const nom = String(donnees.get("nom") ?? "").trim();
  const clientId = String(donnees.get("client_id") ?? "").trim() || null;
  const devisId = String(donnees.get("devis_id") ?? "").trim() || null;
  if (!nom) return { erreur: "Le nom du projet est obligatoire." };
  if (!clientId || !UUID.test(clientId)) return { erreur: "Choisissez un client dans la liste." };
  if (devisId && !UUID.test(devisId)) return { erreur: "Devis invalide." };

  const supabase = await creerClientServeur();
  const { error } = await supabase.from("projets").insert({ nom, client_id: clientId, devis_id: devisId, statut: "en_cours" });
  if (error) return { erreur: `Création impossible : ${messageBase(error.message)}` };

  revalidatePath("/rh");
  return { succes: `Projet « ${nom} » créé.` };
}

/** Change le statut d'un projet. Réservé à l'admin. */
export async function changerStatutProjet(projetId: string, statut: string): Promise<EtatFormulaire> {
  if (!(await obtenirAdminOuNull())) return REFUS_ADMIN;
  if (!(STATUTS_PROJET as readonly string[]).includes(statut)) return { erreur: "Statut inconnu." };

  const supabase = await creerClientServeur();
  const { data, error } = await supabase.from("projets").update({ statut }).eq("id", projetId).select("nom");
  if (error) return { erreur: `Changement impossible : ${messageBase(error.message)}` };
  if (!data?.length) return { erreur: "Projet introuvable ou modification refusée par la base." };

  revalidatePath("/rh");
  return { succes: `Statut du projet « ${data[0].nom} » mis à jour.` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Temps
// ─────────────────────────────────────────────────────────────────────────────

/** Saisit un temps. Chacun ne saisit QUE les siens (règle d'insertion de la base). */
export async function saisirTemps(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const moi = await obtenirUtilisateurCourant();
  if (!moi.collaborateurId) return { erreur: "Votre compte n'est rattaché à aucune fiche : saisie impossible." };

  const collaborateurId = String(donnees.get("collaborateur_id") ?? "");
  const projetId = String(donnees.get("projet_id") ?? "");
  const date = String(donnees.get("date_saisie") ?? "");
  const heuresSaisies = String(donnees.get("heures") ?? "").trim();
  const commentaire = String(donnees.get("commentaire") ?? "").trim() || null;
  const statut = String(donnees.get("statut") ?? "brouillon");

  if (collaborateurId !== moi.collaborateurId) return { erreur: "Vous ne pouvez saisir que vos propres temps." };
  if (!UUID.test(projetId)) return { erreur: "Choisissez un projet dans la liste." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { erreur: "Date invalide." };
  if (heuresSaisies === "") return { erreur: "Le nombre d'heures est obligatoire." };
  const heures = lireCentiemes(heuresSaisies);
  if (heures === null || heures === 0n || heures > 2400n)
    return { erreur: "Nombre d'heures invalide : entre 0,01 et 24, 2 décimales maximum (ex. 7,5)." };
  if (!(STATUTS_TEMPS_SAISIE as readonly string[]).includes(statut))
    return { erreur: "À la saisie, le statut ne peut être que « Brouillon » ou « Soumis »." };

  const supabase = await creerClientServeur();
  const { error } = await supabase.from("temps").insert({
    collaborateur_id: collaborateurId,
    projet_id: projetId,
    date_saisie: date,
    heures: versTexteDecimal(heures),
    commentaire,
    statut,
  });
  if (error) {
    return {
      erreur: error.message.includes("row-level security")
        ? "Refusé par la base : le projet n'est peut-être plus en cours."
        : `Saisie impossible : ${messageBase(error.message)}`,
    };
  }

  revalidatePath("/rh");
  return { succes: `${heuresSaisies.replace(".", ",")} h enregistrées.` };
}

/** Change le statut d'un temps. Seuls manager et admin peuvent « valider ». */
export async function changerStatutTemps(tempsId: string, statut: string): Promise<EtatFormulaire> {
  const moi = await obtenirUtilisateurCourant();
  if (!moi.collaborateurId) return { erreur: "Compte non rattaché." };
  if (!UUID.test(tempsId)) return { erreur: "Temps introuvable." };
  if (!(STATUTS_TEMPS as readonly string[]).includes(statut)) return { erreur: "Statut inconnu." };
  if (statut === "valide" && !peutValiderTemps(moi.role)) return { erreur: "Seuls un manager ou un administrateur peuvent valider un temps." };

  const supabase = await creerClientServeur();
  const { data, error } = await supabase.from("temps").update({ statut }).eq("id", tempsId).select("id");
  if (error) return { erreur: `Changement impossible : ${messageBase(error.message)}` };
  if (!data?.length) return { erreur: "Temps introuvable, déjà validé, ou modification refusée par la base." };

  revalidatePath("/rh");
  return { succes: "Statut mis à jour." };
}

/** Supprime un temps (l'auteur tant qu'il n'est pas validé, ou l'admin). */
export async function supprimerTemps(tempsId: string): Promise<EtatFormulaire> {
  const moi = await obtenirUtilisateurCourant();
  if (!moi.collaborateurId) return { erreur: "Compte non rattaché." };
  if (!UUID.test(tempsId)) return { erreur: "Temps introuvable." };

  const supabase = await creerClientServeur();
  const { data, error } = await supabase.from("temps").delete().eq("id", tempsId).select("id");
  if (error) return { erreur: `Suppression impossible : ${messageBase(error.message)}` };
  if (!data?.length) return { erreur: "Temps introuvable, déjà validé, ou suppression refusée par la base." };

  revalidatePath("/rh");
  return { succes: "Temps supprimé." };
}
