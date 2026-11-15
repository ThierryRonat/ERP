import "server-only";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { managersPossibles, nomComplet, type FicheResume } from "@/lib/rh";

/** Liste des managers proposables pour une fiche (règle identique au déclencheur verifier_manager). */
export async function listeManagers(ficheId: string | null) {
  const supabase = await creerClientServeur();
  const { data } = await supabase.from("collaborateurs").select("id, nom, prenom, manager_id").order("nom");
  return managersPossibles((data ?? []) as FicheResume[], ficheId).map((f) => ({ id: f.id, libelle: nomComplet(f) }));
}
