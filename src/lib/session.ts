import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { creerClientServeur } from "@/lib/supabase/serveur";
import type { Role } from "@/lib/roles";

export type UtilisateurCourant = {
  id: string;
  email: string;
  role: Role | null; // null = aucune ligne profiles trouvée (anomalie)
  collaborateurId: string | null; // null = compte non rattaché → ne voit rien
};

/**
 * Lit l'utilisateur connecté ET son rôle dans la table profiles (jamais depuis le navigateur).
 * Redirige vers /connexion si personne n'est connecté.
 * cache() : un seul aller-retour vers Supabase par affichage de page.
 */
export const obtenirUtilisateurCourant = cache(async (): Promise<UtilisateurCourant> => {
  const supabase = await creerClientServeur();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  if (!id) redirect("/connexion");

  const { data: profil } = await supabase
    .from("profiles")
    .select("email, role, collaborateur_id")
    .eq("id", id)
    .maybeSingle();

  return {
    id,
    email: profil?.email ?? (data.claims.email as string | undefined) ?? "",
    role: (profil?.role as Role | undefined) ?? null,
    collaborateurId: profil?.collaborateur_id ?? null,
  };
});

/**
 * Pour les ACTIONS serveur : renvoie l'admin connecté, ou null s'il n'est pas admin.
 * Le rôle est relu dans la base à chaque appel : on ne fait jamais confiance à l'écran.
 */
export async function obtenirAdminOuNull(): Promise<UtilisateurCourant | null> {
  const utilisateur = await obtenirUtilisateurCourant();
  return utilisateur.role === "admin" ? utilisateur : null;
}

/** À appeler en tête de toute page réservée aux admins. */
export async function exigerAdmin(): Promise<UtilisateurCourant> {
  const utilisateur = await obtenirUtilisateurCourant();
  if (utilisateur.role !== "admin") redirect("/?refus=admin");
  return utilisateur;
}
