"use client";

import { useActionState } from "react";
import { saisirTemps } from "@/lib/actions/rh";
import { LIBELLES_STATUT_TEMPS, STATUTS_TEMPS_SAISIE } from "@/lib/rh";
import { ETAT_INITIAL } from "@/lib/formulaires";

const champ = "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";

/**
 * Les deux listes sont construites sur la RÈGLE D'INSERTION de la base :
 * - collaborateurs : uniquement soi-même (« je saisis les miens ») ;
 * - projets : uniquement ceux « en cours ».
 * On ne propose donc jamais un choix que la base refuserait.
 */
export function FormulaireTemps({
  collaborateurs,
  projets,
  aujourdhui,
}: {
  collaborateurs: { id: string; libelle: string }[];
  projets: { id: string; nom: string }[];
  aujourdhui: string;
}) {
  const [etat, action, enCours] = useActionState(saisirTemps, ETAT_INITIAL);

  if (projets.length === 0) {
    return (
      <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        Aucun projet en cours : impossible de saisir des temps pour l&apos;instant.
      </p>
    );
  }

  return (
    <form action={action} className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 font-semibold">Saisir un temps</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Collaborateur</span>
          <select name="collaborateur_id" defaultValue={collaborateurs[0]?.id} className={champ}>
            {collaborateurs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.libelle}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">Chacun saisit uniquement ses propres temps.</span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Projet (en cours) *</span>
          <select name="projet_id" required defaultValue="" className={champ}>
            <option value="" disabled>
              — Choisir un projet —
            </option>
            {projets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Date *</span>
          <input name="date_saisie" type="date" required defaultValue={aujourdhui} className={champ} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Heures * (0,01 à 24)</span>
          <input name="heures" inputMode="decimal" required placeholder="ex. 7,5" className={champ} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Commentaire</span>
          <input name="commentaire" className={champ} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Statut</span>
          <select name="statut" defaultValue="brouillon" className={champ}>
            {STATUTS_TEMPS_SAISIE.map((s) => (
              <option key={s} value={s}>
                {LIBELLES_STATUT_TEMPS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={enCours}
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
        >
          {enCours ? "Enregistrement…" : "Enregistrer le temps"}
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
