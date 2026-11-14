"use server";
// ⚠️ Fichier "use server" : il n'exporte QUE des fonctions asynchrones.

import { redirect } from "next/navigation";
import { creerClientServeur } from "@/lib/supabase/serveur";
import type { EtatFormulaire } from "@/lib/formulaires";

export async function seConnecter(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const email = String(donnees.get("email") ?? "").trim().toLowerCase();
  const motDePasse = String(donnees.get("mot_de_passe") ?? "");
  const suite = String(donnees.get("suite") ?? "/");

  if (!email || !motDePasse) return { erreur: "Saisissez votre email et votre mot de passe." };

  const supabase = await creerClientServeur();
  const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse });
  if (error) {
    return {
      erreur:
        error.code === "invalid_credentials"
          ? "Email ou mot de passe incorrect."
          : `Connexion impossible : ${error.message}`,
    };
  }

  // On n'accepte qu'un chemin interne ("/rh"), jamais une adresse externe.
  redirect(suite.startsWith("/") && !suite.startsWith("//") ? suite : "/");
}

export async function seDeconnecter(): Promise<void> {
  const supabase = await creerClientServeur();
  await supabase.auth.signOut();
  redirect("/connexion");
}
