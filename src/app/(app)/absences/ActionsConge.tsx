"use client";

import { useState, useTransition } from "react";
import { annulerConge, refuserConge, validerConge } from "@/lib/actions/absences";
import type { EtatFormulaire } from "@/lib/formulaires";

/** Boutons d'une demande : Valider / Refuser (manager, admin) ou Annuler (auteur, tant que « demandée »). */
export function ActionsConge({
  congeId,
  peutTraiter,
  peutAnnuler,
}: {
  congeId: string;
  peutTraiter: boolean;
  peutAnnuler: boolean;
}) {
  const [enCours, demarrer] = useTransition();
  const [resultat, setResultat] = useState<EtatFormulaire | null>(null);
  const lancer = (question: string, action: () => Promise<EtatFormulaire>) => {
    if (!window.confirm(question)) return;
    setResultat(null);
    demarrer(async () => setResultat(await action()));
  };
  const bouton = "rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50";

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {peutTraiter && (
          <>
            <button
              type="button"
              disabled={enCours}
              className={`${bouton} bg-green-700 text-white hover:bg-green-800`}
              onClick={() =>
                lancer("Valider ce congé ? Le solde sera décompté (congés payés et RTT).", () => validerConge(congeId))
              }
            >
              Valider
            </button>
            <button
              type="button"
              disabled={enCours}
              className={`${bouton} border border-red-300 bg-white text-red-700 hover:bg-red-50`}
              onClick={() => lancer("Refuser ce congé ?", () => refuserConge(congeId))}
            >
              Refuser
            </button>
          </>
        )}
        {peutAnnuler && (
          <button
            type="button"
            disabled={enCours}
            className={`${bouton} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
            onClick={() => lancer("Annuler votre demande ?", () => annulerConge(congeId))}
          >
            Annuler
          </button>
        )}
      </div>
      {resultat?.erreur && (
        <p role="alert" className="mt-1 max-w-60 text-xs text-red-700">
          {resultat.erreur}
        </p>
      )}
      {resultat?.succes && (
        <p role="status" className="mt-1 max-w-60 text-xs text-green-700">
          {resultat.succes}
        </p>
      )}
    </div>
  );
}
