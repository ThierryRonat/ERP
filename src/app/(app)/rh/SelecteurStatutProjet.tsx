"use client";

import { useState, useTransition } from "react";
import { changerStatutProjet } from "@/lib/actions/rh";
import { LIBELLES_STATUT_PROJET, STATUTS_PROJET, type StatutProjet } from "@/lib/rh";

export function SelecteurStatutProjet({ projetId, nom, statut }: { projetId: string; nom: string; statut: StatutProjet }) {
  const [valeur, setValeur] = useState<StatutProjet>(statut);
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  return (
    <div>
      <select
        aria-label={`Statut du projet ${nom}`}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-60"
        value={valeur}
        disabled={enCours}
        onChange={(e) => {
          const nouveau = e.target.value as StatutProjet;
          const precedent = valeur;
          setValeur(nouveau);
          setErreur(null);
          demarrer(async () => {
            const r = await changerStatutProjet(projetId, nouveau);
            if (r.erreur) {
              setValeur(precedent);
              setErreur(r.erreur);
            }
          });
        }}
      >
        {STATUTS_PROJET.map((s) => (
          <option key={s} value={s}>
            {LIBELLES_STATUT_PROJET[s]}
          </option>
        ))}
      </select>
      {erreur && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {erreur}
        </p>
      )}
    </div>
  );
}
