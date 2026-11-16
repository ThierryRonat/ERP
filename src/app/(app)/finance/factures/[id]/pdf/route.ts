import { creerClientServeur } from "@/lib/supabase/serveur";
import { pdfDeFacture } from "@/lib/facture-pdf-serveur";

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
  const resultat = await pdfDeFacture(supabase, id); // 404 / 409 / 500 en français
  if (!resultat.ok) return refus(resultat.statut, resultat.message);

  const apercu = new URL(requete.url).searchParams.get("mode") === "apercu";
  return new Response(new Uint8Array(resultat.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${apercu ? "inline" : "attachment"}; filename="${resultat.facture.numero}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
