import { exigerAdmin } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { creerClientAdmin } from "@/lib/supabase/admin";
import type { CompteAcces, FicheCollaborateur } from "@/lib/utilisateurs";
import type { Role } from "@/lib/roles";
import { EcranUtilisateurs } from "./EcranUtilisateurs";

export default async function PageUtilisateurs() {
  const moi = await exigerAdmin();

  // Lecture avec la session de l'admin : la RLS (admin voit tout) s'applique.
  const supabase = await creerClientServeur();
  const [{ data: fiches, error: e1 }, { data: profils, error: e2 }] = await Promise.all([
    supabase.from("collaborateurs").select("id, nom, prenom, email, poste").order("nom"),
    supabase.from("profiles").select("id, email, role, collaborateur_id").order("created_at"),
  ]);

  // Dates de dernière connexion (information du service d'authentification).
  const { data: comptesAuth } = await creerClientAdmin().auth.admin.listUsers({ perPage: 1000 });
  const derniereConnexion = new Map(comptesAuth?.users.map((u) => [u.id, u.last_sign_in_at ?? null]) ?? []);

  const comptes: CompteAcces[] = (profils ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    role: p.role as Role,
    collaborateurId: p.collaborateur_id,
    derniereConnexion: derniereConnexion.get(p.id) ?? null,
  }));

  return (
    <section>
      <h1 className="mb-1 text-2xl font-semibold">Utilisateurs</h1>
      <p className="mb-6 text-slate-600">Accès des collaborateurs à l&apos;application.</p>
      {(e1 || e2) && (
        <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Lecture impossible : {(e1 ?? e2)?.message}
        </p>
      )}
      <EcranUtilisateurs fiches={(fiches ?? []) as FicheCollaborateur[]} comptes={comptes} monId={moi.id} />
    </section>
  );
}
