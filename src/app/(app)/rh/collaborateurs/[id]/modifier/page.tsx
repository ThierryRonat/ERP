import Link from "next/link";
import { notFound } from "next/navigation";
import { exigerAdmin } from "@/lib/session";
import { creerClientAdmin } from "@/lib/supabase/admin";
import { depuisBase, versTexteDecimal } from "@/lib/montants";
import { FormulaireCollaborateur } from "../../FormulaireCollaborateur";
import { listeManagers } from "../../donnees";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PageModifierCollaborateur({ params }: PageProps<"/rh/collaborateurs/[id]/modifier">) {
  await exigerAdmin(); // l'écran d'édition est réservé à l'admin
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  // taux_horaire est illisible pour TOUS les comptes via l'API : seul le serveur, avec la clé
  // SECRÈTE, le lit — et uniquement ici, après la vérification admin ci-dessus.
  const { data: fiche } = await creerClientAdmin()
    .from("collaborateurs")
    .select("id, nom, prenom, email, poste, date_entree, manager_id, taux_horaire")
    .eq("id", id)
    .maybeSingle();
  if (!fiche) notFound();

  const managers = await listeManagers(fiche.id);

  return (
    <section>
      <Link href={`/rh/collaborateurs/${fiche.id}`} className="text-sm text-blue-700 underline">
        ← Retour à la fiche
      </Link>
      <h1 className="mb-6 mt-3 text-2xl font-semibold">
        Modifier la fiche de {[fiche.prenom, fiche.nom].filter(Boolean).join(" ")}
      </h1>
      <FormulaireCollaborateur
        valeurs={{
          id: fiche.id,
          nom: fiche.nom ?? "",
          prenom: fiche.prenom ?? "",
          email: fiche.email ?? "",
          poste: fiche.poste ?? "",
          date_entree: fiche.date_entree ?? "",
          manager_id: fiche.manager_id ?? "",
          taux_horaire: versTexteDecimal(depuisBase(fiche.taux_horaire)).replace(".", ","),
        }}
        managers={managers}
      />
    </section>
  );
}
