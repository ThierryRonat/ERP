import Link from "next/link";
import { redirect } from "next/navigation";
import { obtenirUtilisateurCourant } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { peutGererCommercial } from "@/lib/commercial";
import { FormulaireDevis } from "./FormulaireDevis";

export default async function PageNouveauDevis() {
  const utilisateur = await obtenirUtilisateurCourant();
  if (!peutGererCommercial(utilisateur.role, utilisateur.collaborateurId)) redirect("/commercial?onglet=devis");

  const supabase = await creerClientServeur();
  const { data: prospects } = await supabase.from("prospects").select("id, nom, societe").order("nom");

  return (
    <section>
      <Link href="/commercial?onglet=devis" className="text-sm text-blue-700 underline">
        ← Retour au Commercial
      </Link>
      <h1 className="mb-1 mt-3 text-2xl font-semibold">Nouveau devis</h1>
      <p className="mb-6 text-slate-600">
        Le numéro est attribué automatiquement à l&apos;enregistrement. Les totaux affichés sont indicatifs : ils sont
        recalculés par le serveur.
      </p>
      <FormulaireDevis prospects={prospects ?? []} />
    </section>
  );
}
