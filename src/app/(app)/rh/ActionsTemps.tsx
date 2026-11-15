"use client";

import { useState, useTransition } from "react";
import { changerStatutTemps, supprimerTemps } from "@/lib/actions/rh";
import { LIBELLES_STATUT_TEMPS, type StatutTemps } from "@/lib/rh";

/** Menu de statut + suppression d'un temps. Les choix proposés sont ceux que la base accepte. */
export function ActionsTemps({
  tempsId,
  statut,
  statutsPossibles,
  peutSupprimer,
}: {
  tempsId: string;
  statut: StatutTemps;
  statutsPossibles: StatutTemps[]; // vide → simple étiquette
  peutSupprimer: boolean;
}) {
  const [valeur, setValeur] = useState<StatutTemps>(statut);
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {statutsPossibles.length > 0 ? (
        <select
          aria-label="Statut du temps"
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-60"
          value={valeur}
          disabled={enCours}
          onChange={(e) => {
            const nouveau = e.target.value as StatutTemps;
            const precedent = valeur;
            setValeur(nouveau);
            setErreur(null);
            demarrer(async () => {
              const r = await changerStatutTemps(tempsId, nouveau);
              if (r.erreur) {
                setValeur(precedent);
                setErreur(r.erreur);
              }
            });
          }}
        >
          {statutsPossibles.map((s) => (
            <option key={s} value={s}>
              {LIBELLES_STATUT_TEMPS[s]}
            </option>
          ))}
        </select>
      ) : (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            statut === "valide"
              ? "bg-green-100 text-green-800"
              : statut === "soumis"
                ? "bg-blue-100 text-blue-800"
                : "bg-slate-100 text-slate-700"
          }`}
        >
          {LIBELLES_STATUT_TEMPS[statut]}
        </span>
      )}
      {peutSupprimer && (
        <button
          type="button"
          aria-label="Supprimer ce temps"
          disabled={enCours}
          className="text-slate-400 hover:text-red-600 disabled:opacity-50"
          onClick={() => {
            if (!window.confirm("Supprimer ce temps ?")) return;
            setErreur(null);
            demarrer(async () => {
              const r = await supprimerTemps(tempsId);
              if (r.erreur) setErreur(r.erreur);
            });
          }}
        >
          ✕
        </button>
      )}
      {erreur && (
        <p role="alert" className="text-xs text-red-700">
          {erreur}
        </p>
      )}
    </div>
  );
}
