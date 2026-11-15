"use client";

import { useActionState, useEffect, useRef } from "react";
import { creerProspect } from "@/lib/actions/commercial";
import { LIBELLES_STATUT_PROSPECT, STATUTS_PROSPECT } from "@/lib/commercial";
import { ETAT_INITIAL } from "@/lib/formulaires";

export function FormulaireProspect() {
  const [etat, action, enCours] = useActionState(creerProspect, ETAT_INITIAL);
  const formulaire = useRef<HTMLFormElement>(null);

  // Formulaire vidé après une création réussie.
  useEffect(() => {
    if (etat.succes) formulaire.current?.reset();
  }, [etat]);

  return (
    <form ref={formulaire} action={action} className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 font-semibold">Nouveau prospect</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Champ libelle="Nom *" nom="nom" requis />
        <Champ libelle="Société" nom="societe" />
        <Champ libelle="Source" nom="source" />
        <Champ libelle="Email" nom="email" type="email" />
        <Champ libelle="Téléphone" nom="telephone" type="tel" />
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Statut</span>
          <select name="statut" defaultValue="contacte" className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5">
            {STATUTS_PROSPECT.map((s) => (
              <option key={s} value={s}>
                {LIBELLES_STATUT_PROSPECT[s]}
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
          {enCours ? "Création…" : "Créer le prospect"}
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

function Champ({ libelle, nom, type = "text", requis = false }: { libelle: string; nom: string; type?: string; requis?: boolean }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{libelle}</span>
      <input name={nom} type={type} required={requis} className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5" />
    </label>
  );
}
