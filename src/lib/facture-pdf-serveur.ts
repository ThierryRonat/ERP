import "server-only";
import type { creerClientServeur } from "@/lib/supabase/serveur";
import { ecartAvecFigé, lignesDeFacture } from "@/lib/finance-serveur";
import { genererPdfFacture, type DonneesFacturePdf } from "@/lib/pdf/facture-pdf";

type ClientSession = Awaited<ReturnType<typeof creerClientServeur>>;

export type FacturePourPdf = {
  id: string;
  numero: string;
  statut: string;
  date_echeance: string;
  total_ttc: number | string;
  client: { nom: string; email_contact: string | null } | null;
};

export type ResultatPdf =
  { ok: true; facture: FacturePourPdf; pdf: Buffer } | { ok: false; statut: 404 | 409 | 500; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fabrique le PDF d'une facture (même fichier pour le téléchargement et pour l'email).
 * À appeler APRÈS avoir vérifié que l'utilisateur est admin. La facture est lue avec la session (RLS admin).
 * Refuse (409) si les lignes recalculées aux taux d'aujourd'hui ne collent plus aux montants figés.
 */
export async function pdfDeFacture(supabase: ClientSession, id: string): Promise<ResultatPdf> {
  if (!UUID.test(id)) return { ok: false, statut: 404, message: "Facture introuvable." };

  const { data: facture } = await supabase
    .from("factures")
    .select(
      "id, numero, statut, date_emission, date_echeance, periode_debut, periode_fin, total_ht, tva, total_ttc, clients(nom, adresse, email_contact, telephone)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!facture) return { ok: false, statut: 404, message: "Facture introuvable." };

  try {
    const calcul = await lignesDeFacture(facture.id);
    if (ecartAvecFigé(calcul, facture).ecart) {
      return {
        ok: false,
        statut: 409,
        message: `PDF bloqué : un taux horaire a changé depuis l'émission de ${facture.numero}. Les lignes recalculées ne correspondent plus aux montants figés (voir l'alerte sur la page de la facture).`,
      };
    }
    const client = facture.clients as unknown as DonneesFacturePdf["client"];
    const pdf = await genererPdfFacture({ ...facture, client } as DonneesFacturePdf, calcul);
    return {
      ok: true,
      pdf,
      facture: {
        id: facture.id,
        numero: facture.numero,
        statut: facture.statut,
        date_echeance: facture.date_echeance,
        total_ttc: facture.total_ttc,
        client: client ? { nom: client.nom, email_contact: client.email_contact } : null,
      },
    };
  } catch (e) {
    console.error(`PDF ${facture.numero} :`, e);
    return {
      ok: false,
      statut: 500,
      message: `Le PDF de ${facture.numero} n'a pas pu être produit. Réessayez ; si le problème persiste, prévenez Claude.`,
    };
  }
}
