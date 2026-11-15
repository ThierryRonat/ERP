"use client";

import { useState, useTransition } from "react";
import { changerStatutDevis } from "@/lib/actions/commercial";
import { LIBELLES_STATUT_DEVIS, STATUTS_DEVIS, type StatutDevis } from "@/lib/commercial";

export function SelecteurStatutDevis({
  devisId,
  numero,
  statut,
}: {
  devisId: string;
  numero: string;
  statut: StatutDevis;
}) {
  const [valeur, setValeur] = useState<StatutDevis>(statut);
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  return (
    <div>
      <select
        aria-label={`Statut du devis ${numero}`}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-60"
        value={valeur}
        disabled={enCours}
        onChange={(e) => {
          const nouveau = e.target.value as StatutDevis;
          const precedent = valeur;
          setValeur(nouveau);
          setErreur(null);
          demarrer(async () => {
            const resultat = await changerStatutDevis(devisId, nouveau);
            if (resultat.erreur) {
              setValeur(precedent); // on revient en arrière : l'écran ne ment pas
              setErreur(resultat.erreur);
            }
          });
        }}
      >
        {STATUTS_DEVIS.map((s) => (
          <option key={s} value={s}>
            {LIBELLES_STATUT_DEVIS[s]}
          </option>
        ))}
      </select>
      {enCours && <span className="ml-2 text-xs text-slate-500">Enregistrement…</span>}
      {erreur && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {erreur}
        </p>
      )}
    </div>
  );
}
