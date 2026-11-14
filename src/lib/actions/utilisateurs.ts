"use server";
// ⚠️ Fichier "use server" : il n'exporte QUE des fonctions asynchrones.
// Chaque action REFAIT la vérification « êtes-vous admin ? » : une action serveur
// est une adresse appelable directement, sans passer par l'écran.

import { revalidatePath } from "next/cache";
import { creerClientAdmin } from "@/lib/supabase/admin";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { obtenirAdminOuNull } from "@/lib/session";
import { genererMotDePasseProvisoire } from "@/lib/mot-de-passe";
import { ROLES, type Role } from "@/lib/roles";
import type { ResultatAction } from "@/lib/utilisateurs";

const REFUS_ADMIN: ResultatAction = { erreur: "Action réservée aux administrateurs." };

function estRole(valeur: unknown): valeur is Role {
  return typeof valeur === "string" && (ROLES as readonly string[]).includes(valeur);
}

function rafraichir() {
  revalidatePath("/utilisateurs");
}

/** Crée le compte avec l'email de la fiche, le rattache, applique le rôle, renvoie un mot de passe provisoire. */
export async function creerAcces(collaborateurId: string, role: string): Promise<ResultatAction> {
  if (!(await obtenirAdminOuNull())) return REFUS_ADMIN;
  if (!estRole(role)) return { erreur: "Rôle inconnu." };

  const admin = creerClientAdmin();
  const { data: fiche } = await admin
    .from("collaborateurs")
    .select("id, nom, prenom, email")
    .eq("id", collaborateurId)
    .maybeSingle();
  if (!fiche) return { erreur: "Fiche collaborateur introuvable." };
  const email = fiche.email?.trim().toLowerCase();
  if (!email) return { erreur: `La fiche de ${fiche.prenom ?? ""} ${fiche.nom} n'a pas d'email.` };

  const { data: dejaRattache } = await admin.from("profiles").select("id").eq("collaborateur_id", fiche.id).maybeSingle();
  if (dejaRattache) return { erreur: "Ce collaborateur a déjà un accès." };

  const motDePasse = genererMotDePasseProvisoire();
  const { data: cree, error } = await admin.auth.admin.createUser({ email, password: motDePasse, email_confirm: true });
  if (error || !cree.user) {
    return {
      erreur:
        error?.code === "email_exists"
          ? `Un compte existe déjà avec l'email ${email}. Rattachez-le dans la section « Comptes non rattachés ».`
          : `Création du compte impossible : ${error?.message ?? "raison inconnue"}`,
    };
  }

  const nomComplet = [fiche.prenom, fiche.nom].filter(Boolean).join(" ");
  const { error: erreurProfil } = await admin
    .from("profiles")
    .update({ role, collaborateur_id: fiche.id, nom: nomComplet })
    .eq("id", cree.user.id);
  if (erreurProfil) {
    // On annule : pas de compte à moitié configuré.
    await admin.from("profiles").delete().eq("id", cree.user.id);
    await admin.auth.admin.deleteUser(cree.user.id);
    return { erreur: `Compte annulé, rattachement impossible : ${erreurProfil.message}` };
  }

  rafraichir();
  return { succes: `Accès créé pour ${nomComplet}.`, identifiants: { email, motDePasse } };
}

/** Change le rôle d'un compte. Un admin ne peut pas changer son propre rôle. */
export async function changerRole(compteId: string, role: string): Promise<ResultatAction> {
  const moi = await obtenirAdminOuNull();
  if (!moi) return REFUS_ADMIN;
  if (!estRole(role)) return { erreur: "Rôle inconnu." };
  if (compteId === moi.id) return { erreur: "Vous ne pouvez pas modifier votre propre rôle." };

  // Client de SESSION : la règle RLS « seul l'admin modifie profiles » s'applique en plus.
  const supabase = await creerClientServeur();
  const { data, error } = await supabase.from("profiles").update({ role }).eq("id", compteId).select("id");
  if (error) return { erreur: `Changement de rôle impossible : ${error.message}` };
  if (!data?.length) return { erreur: "Compte introuvable ou modification refusée par la base." };

  rafraichir();
  return { succes: "Rôle mis à jour." };
}

/** Génère un nouveau mot de passe provisoire, affiché une fois. */
export async function reinitialiserMotDePasse(compteId: string): Promise<ResultatAction> {
  if (!(await obtenirAdminOuNull())) return REFUS_ADMIN;

  const admin = creerClientAdmin();
  const motDePasse = genererMotDePasseProvisoire();
  const { data, error } = await admin.auth.admin.updateUserById(compteId, { password: motDePasse });
  if (error || !data.user?.email) return { erreur: `Réinitialisation impossible : ${error?.message ?? "compte introuvable"}` };

  return { succes: "Nouveau mot de passe provisoire généré.", identifiants: { email: data.user.email, motDePasse } };
}

/** Supprime le compte de connexion. La fiche collaborateur, elle, est conservée. */
export async function revoquerAcces(compteId: string): Promise<ResultatAction> {
  const moi = await obtenirAdminOuNull();
  if (!moi) return REFUS_ADMIN;
  if (compteId === moi.id) return { erreur: "Vous ne pouvez pas révoquer votre propre accès." };

  const admin = creerClientAdmin();
  const { error: erreurProfil } = await admin.from("profiles").delete().eq("id", compteId);
  if (erreurProfil) return { erreur: `Révocation impossible : ${erreurProfil.message}` };
  const { error } = await admin.auth.admin.deleteUser(compteId);
  if (error) return { erreur: `Révocation incomplète : ${error.message}` };

  rafraichir();
  return { succes: "Accès révoqué. La fiche collaborateur est conservée." };
}

/** Rattache un compte existant (par ex. votre compte admin) à une fiche collaborateur sans accès. */
export async function rattacherCompte(compteId: string, collaborateurId: string): Promise<ResultatAction> {
  if (!(await obtenirAdminOuNull())) return REFUS_ADMIN;
  if (!collaborateurId) return { erreur: "Choisissez une fiche." };

  const supabase = await creerClientServeur();
  const { data: dejaRattache } = await supabase
    .from("profiles")
    .select("id")
    .eq("collaborateur_id", collaborateurId)
    .maybeSingle();
  if (dejaRattache) return { erreur: "Cette fiche est déjà rattachée à un autre compte." };

  const { data, error } = await supabase
    .from("profiles")
    .update({ collaborateur_id: collaborateurId })
    .eq("id", compteId)
    .select("id");
  if (error) return { erreur: `Rattachement impossible : ${error.message}` };
  if (!data?.length) return { erreur: "Compte introuvable ou modification refusée par la base." };

  rafraichir();
  return { succes: "Compte rattaché à la fiche." };
}

/** Crée une fiche collaborateur pour un compte orphelin, puis l'y rattache. */
export async function creerFicheEtRattacher(compteId: string, donnees: FormData): Promise<ResultatAction> {
  if (!(await obtenirAdminOuNull())) return REFUS_ADMIN;

  const prenom = String(donnees.get("prenom") ?? "").trim();
  const nom = String(donnees.get("nom") ?? "").trim();
  const poste = String(donnees.get("poste") ?? "").trim() || null;
  const tauxHoraire = Number(String(donnees.get("taux_horaire") ?? "0").replace(",", "."));
  if (!nom || !prenom) return { erreur: "Le prénom et le nom sont obligatoires." };
  if (!Number.isFinite(tauxHoraire) || tauxHoraire < 0) return { erreur: "Taux horaire invalide (0 si non applicable)." };

  const supabase = await creerClientServeur();
  const { data: compte } = await supabase.from("profiles").select("email, collaborateur_id").eq("id", compteId).maybeSingle();
  if (!compte) return { erreur: "Compte introuvable." };
  if (compte.collaborateur_id) return { erreur: "Ce compte est déjà rattaché." };

  // Client de SESSION : la règle RLS « seul l'admin crée une fiche » s'applique.
  const { data: fiche, error } = await supabase
    .from("collaborateurs")
    .insert({ nom, prenom, poste, email: compte.email, taux_horaire: tauxHoraire })
    .select("id")
    .single();
  if (error || !fiche) return { erreur: `Création de la fiche impossible : ${error?.message ?? "raison inconnue"}` };

  const { error: erreurRattachement } = await supabase
    .from("profiles")
    .update({ collaborateur_id: fiche.id, nom: `${prenom} ${nom}` })
    .eq("id", compteId);
  if (erreurRattachement) return { erreur: `Fiche créée mais rattachement impossible : ${erreurRattachement.message}` };

  rafraichir();
  return { succes: `Fiche de ${prenom} ${nom} créée et rattachée.` };
}
