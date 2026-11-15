"use client";

import { useActionState } from "react";
import { creerProjet } from "@/lib/actions/rh";
import { ETAT_INITIAL } from "@/lib/formulaires";

const champ = "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";

export function FormulaireProjet({
  clients,
  devis,
}: {
  clients: { id: string; nom: string }[];
  devis: { id: string; libelle: string }[];
}) {
  const [etat, action, enCours] = useActionState(creerProjet, ETAT_INITIAL);

  return (
    <form action={action} className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 font-semibold">Nouveau projet (création manuelle)</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Nom du projet *</span>
          <input name="nom" required className={champ} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Client *</span>
          <select name="client_id" required defaultValue="" className={champ}>
            <option value="" disabled>
              — Choisir un client —
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Devis d&apos;origine (facultatif)</span>
          <select name="devis_id" defaultValue="" className={champ}>
            <option value="">— Aucun —</option>
            {devis.map((d) => (
              <option key={d.id} value={d.id}>
                {d.libelle}
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
          {enCours ? "Création…" : "Créer le projet"}
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
