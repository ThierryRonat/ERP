"use server";
// ⚠️ Fichier "use server" : il n'exporte QUE des fonctions asynchrones.
// Les listes de statuts sont dans src/lib/commercial.ts (fichier ordinaire).
// Chaque action REVÉRIFIE le rôle ; la base le revérifie aussi (RLS + creer_devis).

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { obtenirUtilisateurCourant } from "@/lib/session";
import { STATUTS_DEVIS, STATUTS_PROSPECT, peutGererCommercial, type LigneSaisie } from "@/lib/commercial";
import { calculerTotaux, depuisBase, lireCentiemes, versTexteDecimal } from "@/lib/montants";
import type { EtatFormulaire } from "@/lib/formulaires";

const REFUS: EtatFormulaire = { erreur: "Action réservée aux managers et administrateurs." };

async function autorise(): Promise<boolean> {
  const u = await obtenirUtilisateurCourant();
  return peutGererCommercial(u.role, u.collaborateurId);
}

export async function creerProspect(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  if (!(await autorise())) return REFUS;

  const texte = (cle: string) => String(donnees.get(cle) ?? "").trim() || null;
  const nom = texte("nom");
  const statut = String(donnees.get("statut") ?? "contacte");
  if (!nom) return { erreur: "Le nom du prospect est obligatoire." };
  if (!(STATUTS_PROSPECT as readonly string[]).includes(statut)) return { erreur: "Statut inconnu." };

  const supabase = await creerClientServeur();
  const { error } = await supabase.from("prospects").insert({
    nom,
    societe: texte("societe"),
    email: texte("email"),
    telephone: texte("telephone"),
    source: texte("source"),
    statut,
  });
  if (error) return { erreur: `Création impossible : ${error.message}` };

  revalidatePath("/commercial");
  return { succes: `Prospect « ${nom} » créé.` };
}

/**
 * Crée un devis. Les totaux éventuellement affichés à l'écran sont IGNORÉS :
 * ils sont recalculés ici à partir des lignes, puis une 3e fois par la fonction SQL creer_devis,
 * qui prend le numéro dans la même transaction que l'enregistrement.
 */
export async function creerDevis(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  if (!(await autorise())) return REFUS;

  const prospectId = String(donnees.get("prospect_id") ?? "");
  if (!prospectId) return { erreur: "Choisissez un prospect dans la liste." };

  const taux = lireCentiemes(String(donnees.get("taux_tva") ?? ""));
  if (taux === null || taux > 10000n) return { erreur: "Taux de TVA invalide (nombre entre 0 et 100, 2 décimales maximum)." };

  let saisies: LigneSaisie[];
  try {
    saisies = JSON.parse(String(donnees.get("lignes") ?? "[]"));
    if (!Array.isArray(saisies)) throw new Error();
  } catch {
    return { erreur: "Lignes illisibles." };
  }

  const lignes: { designation: string; quantite: bigint; prixUnitaire: bigint }[] = [];
  for (const [i, s] of saisies.entries()) {
    const designation = String(s?.designation ?? "").trim();
    const quantite = lireCentiemes(s?.quantite);
    const prixUnitaire = lireCentiemes(s?.prixUnitaire);
    if (!designation) return { erreur: `Ligne ${i + 1} : la désignation est obligatoire.` };
    if (quantite === null || quantite === 0n)
      return { erreur: `Ligne ${i + 1} : quantité invalide (supérieure à 0, 2 décimales maximum).` };
    if (prixUnitaire === null) return { erreur: `Ligne ${i + 1} : prix unitaire invalide (2 décimales maximum).` };
    lignes.push({ designation, quantite, prixUnitaire });
  }
  if (lignes.length === 0) return { erreur: "Ajoutez au moins une ligne." };

  const totaux = calculerTotaux(lignes, taux); // recalcul serveur (contrôle de cohérence ci-dessous)

  const supabase = await creerClientServeur();
  const { data: id, error } = await supabase.rpc("creer_devis", {
    p_prospect_id: prospectId,
    p_taux_tva: versTexteDecimal(taux),
    p_lignes: lignes.map((l) => ({
      designation: l.designation,
      quantite: versTexteDecimal(l.quantite),
      prix_unitaire: versTexteDecimal(l.prixUnitaire),
    })),
  });
  if (error || !id) return { erreur: `Création du devis impossible : ${error?.message ?? "raison inconnue"}` };

  const { data: devis } = await supabase.from("devis").select("numero, total_ttc").eq("id", id).single();
  if (devis && depuisBase(devis.total_ttc) !== totaux.totalTtc) {
    console.error(`Écart de total sur ${devis.numero} : base ${devis.total_ttc}, serveur ${versTexteDecimal(totaux.totalTtc)}`);
  }

  revalidatePath("/commercial");
  redirect(`/commercial?devis_cree=${encodeURIComponent(devis?.numero ?? "")}`);
}

export async function changerStatutDevis(devisId: string, statut: string): Promise<EtatFormulaire> {
  if (!(await autorise())) return REFUS;
  if (!(STATUTS_DEVIS as readonly string[]).includes(statut)) return { erreur: "Statut inconnu." };

  const supabase = await creerClientServeur();
  const { data, error } = await supabase.from("devis").update({ statut }).eq("id", devisId).select("numero");
  if (error) return { erreur: `Changement de statut impossible : ${error.message}` };
  if (!data?.length) return { erreur: "Devis introuvable ou modification refusée par la base." };

  revalidatePath("/commercial");
  return { succes: `Statut du devis ${data[0].numero} mis à jour.` };
}
