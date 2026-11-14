import Link from "next/link";
import { inscriptionEncorePossible } from "@/lib/actions/inscription";
import { FormulaireInscription } from "./FormulaireInscription";

// Page à usage UNIQUE : création du premier compte (administrateur). Supprimée à l'étape 5.
export default async function PageInscription() {
  const ouverte = await inscriptionEncorePossible();

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">Premier compte</h1>
        {ouverte ? (
          <>
            <p className="mb-6 text-sm text-slate-600">
              Ce compte sera l&apos;administrateur de l&apos;application. Cette page ne sert qu&apos;une seule fois.
            </p>
            <FormulaireInscription />
          </>
        ) : (
          <p className="text-sm text-slate-600">
            Un compte existe déjà : l&apos;inscription est fermée.{" "}
            <Link href="/connexion" className="text-blue-700 underline">
              Aller à la connexion
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
