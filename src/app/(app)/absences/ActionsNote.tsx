"use client";

import { useState, useTransition } from "react";
import { changerStatutNoteDeFrais, supprimerNoteDeFrais } from "@/lib/actions/absences";
import type { EtatFormulaire } from "@/lib/formulaires";

export function ActionsNote({
  noteId,
  peutValider,
  peutRembourser,
  peutSupprimer,
}: {
  noteId: string;
  peutValider: boolean;
  peutRembourser: boolean;
  peutSupprimer: boolean;
}) {
  const [enCours, demarrer] = useTransition();
  const [resultat, setResultat] = useState<EtatFormulaire | null>(null);
  const lancer = (question: string, action: () => Promise<EtatFormulaire>) => {
    if (!window.confirm(question)) return;
    setResultat(null);
    demarrer(async () => setResultat(await action()));
  };
  const bouton = "rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50";
  if (!peutValider && !peutRembourser && !peutSupprimer) return null;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {peutValider && (
          <button
            type="button"
            disabled={enCours}
            className={`${bouton} bg-green-700 text-white hover:bg-green-800`}
            onClick={() => lancer("Valider cette note de frais ?", () => changerStatutNoteDeFrais(noteId, "validee"))}
          >
            Valider
          </button>
        )}
        {peutRembourser && (
          <button
            type="button"
            disabled={enCours}
            className={`${bouton} bg-blue-700 text-white hover:bg-blue-800`}
            onClick={() =>
              lancer("Marquer cette note comme remboursée ?", () => changerStatutNoteDeFrais(noteId, "remboursee"))
            }
          >
            Rembourser
          </button>
        )}
        {peutSupprimer && (
          <button
            type="button"
            disabled={enCours}
            className={`${bouton} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
            onClick={() =>
              lancer("Supprimer votre note de frais et son justificatif ?", () => supprimerNoteDeFrais(noteId))
            }
          >
            Supprimer
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
