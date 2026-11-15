import { obtenirUtilisateurCourant } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { genererPdfDevis, type DonneesDevisPdf } from "@/lib/pdf/devis-pdf";

// GET /commercial/devis/<id>/pdf → téléchargement du PDF du devis.
// Lecture avec la SESSION : la RLS décide si la personne a le droit de voir ce devis.
export async function GET(_requete: Request, contexte: RouteContext<"/commercial/devis/[id]/pdf">) {
  await obtenirUtilisateurCourant(); // redirige vers /connexion si personne n'est connecté
  const { id } = await contexte.params;

  const supabase = await creerClientServeur();
  const { data: devis } = await supabase
    .from("devis")
    .select(
      "numero, date_emission, total_ht, tva, total_ttc, prospects(nom, societe, email, telephone), devis_lignes(designation, quantite, prix_unitaire, montant_ht, created_at)",
    )
    .eq("id", id)
    .order("created_at", { referencedTable: "devis_lignes" })
    .maybeSingle();

  if (!devis) return new Response("Devis introuvable.", { status: 404 });

  const pdf = await genererPdfDevis({
    ...devis,
    prospect: devis.prospects as unknown as DonneesDevisPdf["prospect"],
    lignes: devis.devis_lignes,
  } as DonneesDevisPdf);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${devis.numero}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
