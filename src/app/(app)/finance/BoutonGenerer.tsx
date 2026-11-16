"use client";

import { useActionState } from "react";
import { genererFacture } from "@/lib/actions/finance";
import { ETAT_INITIAL } from "@/lib/formulaires";

export function BoutonGenerer({ clientId, mois, desactive }: { clientId: string; mois: string; desactive: boolean }) {
  const [etat, action, enCours] = useActionState(genererFacture, ETAT_INITIAL);
  return (
    <form action={action} className="mt-4 flex flex-wrap items-center gap-3">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="mois" value={mois} />
      <button
        type="submit"
        disabled={enCours || desactive}
        className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {enCours ? "Génération…" : "Générer la facture"}
      </button>
      {etat.erreur && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {etat.erreur}
        </p>
      )}
    </form>
  );
}
