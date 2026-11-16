import { creerClientServeur } from "@/lib/supabase/serveur";
import { ecartAvecFigé, lignesDeFacture } from "@/lib/finance-serveur";
import { genererPdfFacture, type DonneesFacturePdf } from "@/lib/pdf/facture-pdf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Réponse texte en français (jamais de page d'erreur 500 pour un simple refus). */
function refus(statut: number, message: string) {
  return new Response(message, {
    status: statut,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// GET /finance/factures/<id>/pdf               → téléchargement
// GET /finance/factures/<id>/pdf?mode=apercu   → affichage dans le navigateur
export async function GET(requete: Request, contexte: RouteContext<"/finance/factures/[id]/pdf">) {
  const supabase = await creerClientServeur();

  // 401 : personne n'est connecté
  const { data: session } = await supabase.auth.getClaims();
  const utilisateurId = session?.claims?.sub;
  if (!utilisateurId) return refus(401, "Connexion requise pour télécharger cette facture.");

  // 403 : connecté, mais pas administrateur (rôle relu dans la base, jamais depuis le navigateur)
  const { data: profil } = await supabase.from("profiles").select("role").eq("id", utilisateurId).maybeSingle();
  if (profil?.role !== "admin") return refus(403, "Accès refusé : les factures sont réservées à l'administrateur.");

  const { id } = await contexte.params;
  if (!UUID.test(id)) return refus(404, "Facture introuvable.");

  const { data: facture } = await supabase
    .from("factures")
    .select(
      "id, numero, date_emission, date_echeance, periode_debut, periode_fin, total_ht, tva, total_ttc, clients(nom, adresse, email_contact, telephone)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!facture) return refus(404, "Facture introuvable.");

  try {
    // Lignes reconstituées avec les taux D'AUJOURD'HUI : si elles ne collent plus aux montants figés, pas de PDF.
    const calcul = await lignesDeFacture(facture.id);
    const { ecart } = ecartAvecFigé(calcul, facture);
    if (ecart) {
      return refus(
        409,
        `PDF bloqué : un taux horaire a changé depuis l'émission de ${facture.numero}. Les lignes recalculées ne correspondent plus aux montants figés (voir l'alerte sur la page de la facture).`,
      );
    }

    const pdf = await genererPdfFacture(
      { ...facture, client: facture.clients as unknown as DonneesFacturePdf["client"] } as DonneesFacturePdf,
      calcul,
    );
    const apercu = new URL(requete.url).searchParams.get("mode") === "apercu";
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${apercu ? "inline" : "attachment"}; filename="${facture.numero}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error(`PDF ${facture.numero} :`, e);
    return refus(
      500,
      `Le PDF de ${facture.numero} n'a pas pu être produit. Réessayez ; si le problème persiste, prévenez Claude.`,
    );
  }
}
