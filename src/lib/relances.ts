import "server-only";
import { createClient } from "@supabase/supabase-js";
import { configurationEmail, envoyerEmail } from "@/lib/email";
import { pdfDeFacture } from "@/lib/facture-pdf-serveur";
import { ENTREPRISE } from "@/lib/entreprise";
import { aujourdhuiParis } from "@/lib/dates";

// ═══════════════════════════════════════════════════════════════════════════════
//  RELANCES DES FACTURES IMPAYÉES — utilisé par le planificateur (sans session) ET par le bloc admin.
//
//  PIÈGE : un planificateur n'a AUCUNE session. Avec la clé publique, la RLS ne lui montre aucune facture
//  et le traitement répondrait « 0 facture en retard » sans rien envoyer. On utilise donc un client dédié
//  avec la CLÉ DE SERVICE ; si elle manque (ou si c'est la clé publique), on lève une ERREUR EXPLICITE.
// ═══════════════════════════════════════════════════════════════════════════════

export class ErreurConfigurationRelances extends Error {}

export function creerClientRelances() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) throw new ErreurConfigurationRelances("NEXT_PUBLIC_SUPABASE_URL absente : relances impossibles.");
  if (!cle)
    throw new ErreurConfigurationRelances(
      "SUPABASE_SERVICE_ROLE_KEY absente : sans clé de service, le planificateur ne verrait AUCUNE facture (règles RLS). Relances arrêtées.",
    );
  if (cle === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || cle.startsWith("sb_publishable_"))
    throw new ErreurConfigurationRelances(
      "SUPABASE_SERVICE_ROLE_KEY contient la clé PUBLIQUE : le planificateur ne verrait aucune facture. Relances arrêtées.",
    );
  return createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type ResultatFacture = {
  numero: string;
  client: string;
  echeance: string;
  resultat: "envoyee" | "ignoree" | "echec";
  motif: string;
};

export type BilanRelances = {
  jour: string; // AAAA-MM-JJ (Paris)
  origine: string;
  force: boolean;
  modeTest: string | null;
  facturesEchues: number;
  envoyees: number;
  ignorees: number;
  echecs: number;
  details: ResultatFacture[];
};

const jourParis = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const heureParis = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const dateFr = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Relance les factures « émises » ou « envoyées » dont l'échéance est dépassée.
 * - Anti-doublon : une seule relance par facture et par jour (Paris), sauf `forcer` (bloc admin UNIQUEMENT).
 * - Un client sans email (ou un PDF bloqué) donne un « échec » pour CETTE facture ; les autres continuent.
 * - La relance est journalisée APRÈS l'envoi réussi, jamais avant.
 */
export async function traiterRelances({
  forcer = false,
  origine,
}: {
  forcer?: boolean;
  origine: string;
}): Promise<BilanRelances> {
  const service = creerClientRelances(); // erreur explicite si la clé manque
  const jour = aujourdhuiParis();
  const config = configurationEmail();

  const { data: factures, error } = await service
    .from("factures")
    .select("id, numero, statut, date_echeance, total_ttc, clients(nom, email_contact)")
    .in("statut", ["emise", "envoyee"])
    .lt("date_echeance", jour)
    .order("date_echeance");
  if (error) throw new Error(`Lecture des factures impossible : ${error.message}`);

  // Relances récentes (2 jours suffisent pour savoir si une a déjà eu lieu « aujourd'hui » à Paris)
  const ids = (factures ?? []).map((f) => f.id);
  const depuis = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { data: recentes } = ids.length
    ? await service.from("relances").select("facture_id, date_envoi").in("facture_id", ids).gte("date_envoi", depuis)
    : { data: [] };
  const dejaAujourdhui = new Map<string, string>();
  for (const r of recentes ?? []) if (jourParis(r.date_envoi) === jour) dejaAujourdhui.set(r.facture_id, r.date_envoi);

  const details: ResultatFacture[] = [];
  for (const f of factures ?? []) {
    const client = f.clients as unknown as { nom: string; email_contact: string | null } | null;
    const ligne = { numero: f.numero, client: client?.nom ?? "—", echeance: f.date_echeance };
    try {
      const deja = dejaAujourdhui.get(f.id);
      if (deja && !forcer) {
        details.push({ ...ligne, resultat: "ignoree", motif: `déjà relancée aujourd'hui à ${heureParis(deja)}` });
        continue;
      }
      if (!config.pret) {
        details.push({ ...ligne, resultat: "echec", motif: config.probleme! });
        continue;
      }
      const email = client?.email_contact?.trim();
      if (!email) {
        details.push({ ...ligne, resultat: "echec", motif: `le client ${ligne.client} n'a pas d'email de contact` });
        continue;
      }

      const pdf = await pdfDeFacture(service, f.id);
      if (!pdf.ok) {
        details.push({ ...ligne, resultat: "echec", motif: pdf.message });
        continue;
      }

      const destinataire = config.destinataireTest ?? email;
      const montant = Number(f.total_ttc).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
      const texte = [
        "Bonjour,",
        "",
        `Sauf erreur de notre part, la facture ${f.numero} d'un montant de ${montant} TTC, arrivée à échéance le ${dateFr(f.date_echeance)}, reste à ce jour impayée.`,
        "Vous la trouverez ci-jointe. Merci de bien vouloir procéder à son règlement dans les meilleurs délais.",
        "Si vous avez réglé cette facture entre-temps, merci de ne pas tenir compte de ce message.",
        "",
        "Cordialement,",
        ENTREPRISE.raisonSociale,
      ].join("\n");
      const envoi = await envoyerEmail({
        a: destinataire,
        sujet: `${config.destinataireTest ? `[TEST — destinataire réel : ${email}] ` : ""}Rappel — facture ${f.numero} échue — ${ENTREPRISE.raisonSociale}`,
        texte,
        html: texte
          .split("\n")
          .map((l) => (l ? `<p style="margin:0 0 8px">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>` : ""))
          .join(""),
        pieceJointe: { nom: `${f.numero}.pdf`, contenu: pdf.pdf },
        repondreA: ENTREPRISE.email.trim() || undefined,
      });
      if (!envoi.ok) {
        // Rien n'est journalisé : la vraie relance reste possible aujourd'hui.
        details.push({ ...ligne, resultat: "echec", motif: envoi.erreur });
        continue;
      }

      // Journal APRÈS l'envoi réussi
      const { error: erreurJournal } = await service.from("relances").insert({
        facture_id: f.id,
        canal: config.destinataireTest ? "email (test)" : "email",
        message: `Rappel envoyé à ${destinataire}${config.destinataireTest ? ` (mode test, client : ${email})` : ""} — ${origine}${forcer ? " — FORCÉ" : ""} — Resend ${envoi.id}`,
      });
      details.push({
        ...ligne,
        resultat: "envoyee",
        motif: erreurJournal
          ? `envoyée à ${destinataire}, MAIS non journalisée (${erreurJournal.message})`
          : `envoyée à ${destinataire}${config.destinataireTest ? " (mode test)" : ""}${forcer ? " — forcée" : ""}`,
      });
    } catch (e) {
      details.push({ ...ligne, resultat: "echec", motif: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    jour,
    origine,
    force: forcer,
    modeTest: config.destinataireTest,
    facturesEchues: details.length,
    envoyees: details.filter((d) => d.resultat === "envoyee").length,
    ignorees: details.filter((d) => d.resultat === "ignoree").length,
    echecs: details.filter((d) => d.resultat === "echec").length,
    details,
  };
}
