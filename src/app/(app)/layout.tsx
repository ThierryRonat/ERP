import Link from "next/link";
import { obtenirUtilisateurCourant } from "@/lib/session";
import { ENTREES_MENU } from "@/lib/navigation";
import { LIBELLES_ROLES } from "@/lib/roles";
import { MenuLateral } from "@/composants/MenuLateral";

// Mise en page de TOUTES les pages protégées.
// Double protection : le proxy redirige déjà, et obtenirUtilisateurCourant() redirige aussi.
export default async function MiseEnPageApplication({ children }: LayoutProps<"/">) {
  const utilisateur = await obtenirUtilisateurCourant();
  const estAdmin = utilisateur.role === "admin";

  // Le filtrage se fait côté serveur : un non-admin ne reçoit même pas les liens Finance/Utilisateurs.
  const entrees = ENTREES_MENU.filter((e) => !e.adminSeulement || estAdmin);

  return (
    <div className="flex min-h-screen">
      <MenuLateral
        entrees={entrees}
        email={utilisateur.email}
        libelleRole={utilisateur.role ? LIBELLES_ROLES[utilisateur.role] : "aucun"}
      />
      <div className="flex-1">
        {utilisateur.role === null && (
          <BandeauAlerte titre="Profil introuvable">
            Votre compte n&apos;a pas de ligne dans la table profiles : aucun rôle ne peut vous être appliqué.
            Prévenez un administrateur.
          </BandeauAlerte>
        )}
        {utilisateur.role !== null && !utilisateur.collaborateurId && (
          <BandeauAlerte titre="Compte non rattaché à une fiche collaborateur">
            Tant que votre compte n&apos;est pas rattaché à une fiche collaborateur, les règles de sécurité vous
            masquent toutes les données : les écrans resteront vides, sans autre message d&apos;erreur.{" "}
            {estAdmin ? (
              <Link href="/utilisateurs" className="font-semibold underline">
                Rattacher mon compte dans l&apos;écran Utilisateurs
              </Link>
            ) : (
              "Demandez à un administrateur de vous rattacher."
            )}
          </BandeauAlerte>
        )}
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}

function BandeauAlerte({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div role="alert" className="border-b border-amber-300 bg-amber-50 px-8 py-3 text-sm text-amber-900">
      <strong className="mr-1">⚠️ {titre}.</strong>
      {children}
    </div>
  );
}
