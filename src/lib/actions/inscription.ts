"use server";
// ⚠️ Fichier "use server" : il n'exporte QUE des fonctions asynchrones.
// Page à usage UNIQUE : elle sera supprimée à l'étape 5.

import { redirect } from "next/navigation";
import { creerClientAdmin } from "@/lib/supabase/admin";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { LONGUEUR_MIN_MOT_DE_PASSE, type EtatFormulaire } from "@/lib/formulaires";

/** Vrai tant qu'aucun compte n'existe dans Supabase. */
export async function inscriptionEncorePossible(): Promise<boolean> {
  const admin = creerClientAdmin();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw new Error(`Lecture des comptes impossible : ${error.message}`);
  return data.users.length === 0;
}

/**
 * Crée le TOUT PREMIER compte côté serveur, déjà confirmé (pas d'email à attendre),
 * puis connecte directement. Le déclencheur de la base lui donne le rôle admin.
 */
export async function creerPremierCompte(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const email = String(donnees.get("email") ?? "").trim().toLowerCase();
  const motDePasse = String(donnees.get("mot_de_passe") ?? "");
  const confirmation = String(donnees.get("confirmation") ?? "");

  if (!email.includes("@")) return { erreur: "Adresse email invalide." };
  if (motDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE)
    return { erreur: `Le mot de passe doit faire au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.` };
  if (motDePasse !== confirmation) return { erreur: "Les deux mots de passe ne sont pas identiques." };

  // Contrôle refait CÔTÉ SERVEUR : impossible de créer un 2e compte par cette page.
  if (!(await inscriptionEncorePossible())) {
    return { erreur: "Un compte existe déjà : l'inscription est fermée. Demandez un accès à un administrateur." };
  }

  const admin = creerClientAdmin();
  const { data: cree, error: erreurCreation } = await admin.auth.admin.createUser({
    email,
    password: motDePasse,
    email_confirm: true,
  });
  if (erreurCreation || !cree.user) {
    return { erreur: `Création du compte impossible : ${erreurCreation?.message ?? "raison inconnue"}` };
  }

  // Vérification : le déclencheur a-t-il bien créé le profil admin ?
  const { data: profil } = await admin.from("profiles").select("role").eq("id", cree.user.id).maybeSingle();
  if (profil?.role !== "admin") {
    return {
      erreur: `Compte créé, mais son rôle est « ${profil?.role ?? "aucun profil"} » au lieu de « admin ». Prévenez Claude.`,
    };
  }

  const supabase = await creerClientServeur();
  const { error: erreurConnexion } = await supabase.auth.signInWithPassword({ email, password: motDePasse });
  if (erreurConnexion) return { erreur: `Compte créé mais connexion impossible : ${erreurConnexion.message}` };

  redirect("/");
}
