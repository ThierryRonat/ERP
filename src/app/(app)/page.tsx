import { obtenirUtilisateurCourant } from "@/lib/session";
import { LIBELLES_ROLES } from "@/lib/roles";

export default async function PageAccueil({ searchParams }: PageProps<"/">) {
  const utilisateur = await obtenirUtilisateurCourant();
  const { refus } = await searchParams;

  return (
    <section>
      {refus === "admin" && (
        <p role="alert" className="mb-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Cette page est réservée aux administrateurs.
        </p>
      )}
      <h1 className="mb-2 text-2xl font-semibold">Accueil</h1>
      <p className="text-slate-600">
        Bienvenue, {utilisateur.email}. Vous êtes connecté en tant que{" "}
        <strong>{utilisateur.role ? LIBELLES_ROLES[utilisateur.role] : "rôle inconnu"}</strong>.
      </p>
    </section>
  );
}
