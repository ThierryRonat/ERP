"use client";

import { useState, useTransition } from "react";
import { changerStatutFacture } from "@/lib/actions/finance";
import { LIBELLES_STATUT_FACTURE, statutsPossibles, type StatutFacture } from "@/lib/finance";

export function SelecteurStatutFacture({ id, numero, statut }: { id: string; numero: string; statut: StatutFacture }) {
  const [valeur, setValeur] = useState<StatutFacture>(statut);
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  return (
    <div>
      <select
        aria-label={`Statut de la facture ${numero}`}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-60"
        value={valeur}
        disabled={enCours}
        onChange={(e) => {
          const nouveau = e.target.value as StatutFacture;
          const precedent = valeur;
          setValeur(nouveau);
          setErreur(null);
          demarrer(async () => {
            const r = await changerStatutFacture(id, nouveau);
            if (r.erreur) {
              setValeur(precedent);
              setErreur(r.erreur);
            }
          });
        }}
      >
        {statutsPossibles(statut).map((s) => (
          <option key={s} value={s}>
            {LIBELLES_STATUT_FACTURE[s]}
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
