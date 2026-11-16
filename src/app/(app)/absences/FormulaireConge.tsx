"use client";

import { useActionState, useState } from "react";
import { demanderConge } from "@/lib/actions/absences";
import { joursDeLaPeriode, LIBELLES_TYPE_CONGE, TYPES_CONGE } from "@/lib/absences";
import { ETAT_INITIAL } from "@/lib/formulaires";

const champ = "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";

export function FormulaireConge({ aujourdhui }: { aujourdhui: string }) {
  const [etat, action, enCours] = useActionState(demanderConge, ETAT_INITIAL);
  const [debut, setDebut] = useState(aujourdhui);
  const [fin, setFin] = useState(aujourdhui);
  const periode = debut && fin && fin >= debut ? joursDeLaPeriode(debut, fin) : null;

  return (
    <form action={action} className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 font-semibold">Nouvelle demande de congé</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Type *</span>
          <select name="type" defaultValue="conges_payes" className={champ}>
            {TYPES_CONGE.map((t) => (
              <option key={t} value={t}>
                {LIBELLES_TYPE_CONGE[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Du *</span>
          <input
            name="date_debut"
            type="date"
            required
            value={debut}
            onChange={(e) => setDebut(e.target.value)}
            className={champ}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Au (inclus) *</span>
          <input
            name="date_fin"
            type="date"
            required
            value={fin}
            min={debut}
            onChange={(e) => setFin(e.target.value)}
            className={champ}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Nombre de jours *</span>
          <input name="nb_jours" inputMode="decimal" required placeholder="ex. 3 ou 0,5" className={champ} />
          <span className="mt-1 block text-xs text-slate-500">
            À saisir vous-même (jours ouvrés, demi-journées possibles)
            {periode ? ` — période de ${periode} jour(s) calendaire(s)` : ""}.
          </span>
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-slate-700">Motif (facultatif)</span>
          <input name="motif" className={champ} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={enCours}
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
        >
          {enCours ? "Envoi…" : "Demander"}
        </button>
        {etat.erreur && (
          <p role="alert" className="text-sm text-red-700">
            {etat.erreur}
          </p>
        )}
        {etat.succes && (
          <p role="status" className="text-sm text-green-700">
            {etat.succes}
          </p>
        )}
      </div>
    </form>
  );
}
