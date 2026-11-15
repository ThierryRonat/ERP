"use server";
// ⚠️ Fichier "use server" : il n'exporte QUE des fonctions asynchrones.
// Les listes de statuts sont dans src/lib/rh.ts (fichier ordinaire).
// Chaque action REVÉRIFIE les droits ; la base les revérifie aussi (RLS + déclencheurs).

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { obtenirAdminOuNull } from "@/lib/session";
import { STATUTS_PROJET } from "@/lib/rh";
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
  redirect(`/rh?onglet=collaborateurs&fiche_enregistree=${encodeURIComponent([valeurs.prenom, nom].filter(Boolean).join(" "))}`);
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
