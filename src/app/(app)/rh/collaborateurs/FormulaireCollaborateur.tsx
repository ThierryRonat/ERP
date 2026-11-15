"use client";

import { useActionState } from "react";
import { enregistrerCollaborateur } from "@/lib/actions/rh";
import { ETAT_INITIAL } from "@/lib/formulaires";

const champ = "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";

export type ValeursFiche = {
  id: string | null;
  nom: string;
  prenom: string;
  email: string;
  poste: string;
  date_entree: string;
  manager_id: string;
  taux_horaire: string; // lu côté serveur avec la clé secrète, déjà mis en forme (ex. "92,50")
};

export function FormulaireCollaborateur({
  valeurs,
  managers,
}: {
  valeurs: ValeursFiche;
  managers: { id: string; libelle: string }[]; // déjà filtrés : ni soi-même, ni un subordonné
}) {
  const [etat, action, enCours] = useActionState(enregistrerCollaborateur, ETAT_INITIAL);

  return (
    <form action={action} className="max-w-2xl space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <input type="hidden" name="id" value={valeurs.id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ libelle="Nom *" nom="nom" valeur={valeurs.nom} requis />
        <Champ libelle="Prénom" nom="prenom" valeur={valeurs.prenom} />
        <Champ libelle="Email" nom="email" type="email" valeur={valeurs.email} />
        <Champ libelle="Poste" nom="poste" valeur={valeurs.poste} />
        <Champ libelle="Date d'entrée" nom="date_entree" type="date" valeur={valeurs.date_entree} />
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Manager</span>
          <select name="manager_id" defaultValue={valeurs.manager_id} className={champ}>
            <option value="">— Aucun —</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.libelle}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            La liste exclut la personne elle-même et celles qu&apos;elle encadre.
          </span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Taux horaire (€ HT) *</span>
          <input
            name="taux_horaire"
            inputMode="decimal"
            defaultValue={valeurs.taux_horaire}
            placeholder="ex. 85 ou 92,50 — 0 si non applicable"
            className={champ}
          />
          <span className="mt-1 block text-xs text-slate-500">Confidentiel : visible uniquement sur cet écran.</span>
        </label>
      </div>

      {etat.erreur && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {etat.erreur}
        </p>
      )}

      <button
        type="submit"
        disabled={enCours}
        className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
      >
        {enCours ? "Enregistrement…" : "Enregistrer la fiche"}
      </button>
    </form>
  );
}

function Champ({
  libelle,
  nom,
  valeur,
  type = "text",
  requis = false,
}: {
  libelle: string;
  nom: string;
  valeur: string;
  type?: string;
  requis?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{libelle}</span>
      <input name={nom} type={type} defaultValue={valeur} required={requis} className={champ} />
    </label>
  );
}
