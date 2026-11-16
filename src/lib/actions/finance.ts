"use server";
// ⚠️ Fichier "use server" : il n'exporte QUE des fonctions asynchrones.
// Chaque action REVÉRIFIE que l'utilisateur est admin ; la base le revérifie (RLS + generer_facture).

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { obtenirAdminOuNull } from "@/lib/session";
import { premierJourDuMois, STATUTS_FACTURE } from "@/lib/finance";
import type { EtatFormulaire } from "@/lib/formulaires";
import { configurationEmail, envoyerEmail } from "@/lib/email";
import { pdfDeFacture } from "@/lib/facture-pdf-serveur";
import { ENTREPRISE } from "@/lib/entreprise";
import { aujourdhuiParis } from "@/lib/dates";

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

/**
 * Envoie la facture au contact du client, PDF en pièce jointe.
 * ORDRE IMPOSÉ : 1) PDF, 2) envoi de l'email, 3) SEULEMENT si l'envoi a réussi → statut « envoyée » + date.
 * Mode test (EMAIL_DESTINATAIRE_TEST) : l'email part vers cette adresse et la facture n'est PAS marquée envoyée.
 */
export async function envoyerFacture(factureId: string): Promise<EtatFormulaire> {
  if (!(await obtenirAdminOuNull())) return REFUS;

  const config = configurationEmail();
  if (!config.pret) return { erreur: config.probleme! };

  // 1) Le PDF (mêmes contrôles que le téléchargement : écart de taux → refus)
  const supabase = await creerClientServeur();
  const resultat = await pdfDeFacture(supabase, factureId);
  if (!resultat.ok) return { erreur: resultat.message };
  const { facture, pdf } = resultat;

  const emailClient = facture.client?.email_contact?.trim();
  if (!emailClient)
    return { erreur: `Le client ${facture.client?.nom ?? ""} n'a pas d'email de contact : envoi impossible.` };
  const destinataire = config.destinataireTest ?? emailClient;

  // 2) L'envoi
  const montant = Number(facture.total_ttc).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
  const echeance = facture.date_echeance.split("-").reverse().join("/");
  const sujet = `${config.destinataireTest ? `[TEST — destinataire réel : ${emailClient}] ` : ""}Facture ${facture.numero} — ${ENTREPRISE.raisonSociale}`;
  const texte = [
    "Bonjour,",
    "",
    `Veuillez trouver ci-joint la facture ${facture.numero} d'un montant de ${montant} TTC, à régler au plus tard le ${echeance}.`,
    "",
    "Cordialement,",
    ENTREPRISE.raisonSociale,
  ].join("\n");
  const html = texte
    .split("\n")
    .map((l) => (l ? `<p style="margin:0 0 8px">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>` : ""))
    .join("");
  const envoi = await envoyerEmail({
    a: destinataire,
    sujet,
    texte,
    html,
    pieceJointe: { nom: `${facture.numero}.pdf`, contenu: pdf },
    repondreA: ENTREPRISE.email.trim() || undefined,
  });
  if (!envoi.ok) return { erreur: `${envoi.erreur} La facture n'a PAS été marquée « envoyée ».` };

  // 3) Seulement maintenant : le statut
  if (config.destinataireTest) {
    return {
      succes: `Envoi de TEST réussi vers ${destinataire} (le client ${emailClient} n'a rien reçu). Statut inchangé (mode test).`,
    };
  }
  const nouveauStatut = facture.statut === "brouillon" || facture.statut === "emise" ? "envoyee" : facture.statut;
  const { error } = await supabase
    .from("factures")
    .update({ statut: nouveauStatut, date_envoi: aujourdhuiParis() })
    .eq("id", facture.id);
  revalidatePath("/finance");
  revalidatePath(`/finance/factures/${facture.id}`);
  if (error)
    return { erreur: `Email ENVOYÉ à ${destinataire}, mais le statut n'a pas pu être mis à jour : ${error.message}` };
  return { succes: `Facture ${facture.numero} envoyée à ${destinataire}.` };
}
