import Link from "next/link";
import { exigerAdmin } from "@/lib/session";
import { FormulaireCollaborateur } from "../FormulaireCollaborateur";
import { listeManagers } from "../donnees";

export default async function PageNouvelleFiche() {
  await exigerAdmin();
  const managers = await listeManagers(null);

  return (
    <section>
      <Link href="/rh?onglet=collaborateurs" className="text-sm text-blue-700 underline">
        ← Retour à RH
      </Link>
      <h1 className="mb-6 mt-3 text-2xl font-semibold">Nouvelle fiche collaborateur</h1>
      <FormulaireCollaborateur
        valeurs={{ id: null, nom: "", prenom: "", email: "", poste: "", date_entree: "", manager_id: "", taux_horaire: "" }}
        managers={managers}
      />
    </section>
  );
}
