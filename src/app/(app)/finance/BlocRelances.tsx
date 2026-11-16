"use client";

import { useState, useTransition } from "react";
import {
  forcerRelance,
  rendreFactureEchue,
  testerRelance,
  type ResultatRelance,
} from "@/lib/actions/relances";

const COULEURS = {
  envoyee: "bg-green-100 text-green-800",
  ignoree: "bg-slate-100 text-slate-700",
  echec: "bg-red-100 text-red-800",
};
const LIBELLES = { envoyee: "Envoyée", ignoree: "Ignorée", echec: "Échec" };

export function BlocRelances({
  factures,
}: {
  factures: { id: string; libelle: string }[];
}) {
  const [enCours, demarrer] = useTransition();
  const [resultat, setResultat] = useState<ResultatRelance | null>(null);
  const [choix, setChoix] = useState(factures[0]?.id ?? "");
  const lancer = (
    question: string | null,
    action: () => Promise<ResultatRelance>,
  ) => {
    if (question && !window.confirm(question)) return;
    setResultat(null);
    demarrer(async () => setResultat(await action()));
  };
  const bouton =
    "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50";
  const bilan = resultat?.bilan;

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          disabled={enCours}
          className={`${bouton} bg-blue-700 text-white hover:bg-blue-800`}
          onClick={() => lancer(null, testerRelance)}
        >
          Tester la relance
        </button>
        <button
          type="button"
          disabled={enCours}
          className={`${bouton} border border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100`}
          onClick={() =>
            lancer(
              "Forcer l'envoi ? Les factures échues seront relancées MÊME si elles l'ont déjà été aujourd'hui.",
              forcerRelance,
            )
          }
        >
          Forcer l&apos;envoi
        </button>
        <span className="mx-1 hidden h-8 border-l border-slate-200 sm:block" />
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Cas de test
          </span>
          <select
            value={choix}
            onChange={(e) => setChoix(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            {factures.map((f) => (
              <option key={f.id} value={f.id}>
                {f.libelle}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={enCours || !choix}
          className={`${bouton} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}
          onClick={() =>
            lancer(
              "Rendre cette facture échue ? Son échéance passera à HIER (modification réelle, sans retour automatique).",
              () => rendreFactureEchue(choix),
            )
          }
        >
          Rendre une facture échue
        </button>
        {enCours && <span className="text-sm text-slate-500">Traitement…</span>}
      </div>

      {resultat?.erreur && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {resultat.erreur}
        </p>
      )}
      {resultat?.succes && (
        <p
          role="status"
          className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          {resultat.succes}
        </p>
      )}

      {bilan && (
        <div data-testid="bilan-relances">
          <p className="mb-2 text-sm text-slate-700">
            Bilan du {bilan.jour.split("-").reverse().join("/")} (
            {bilan.origine}
            {bilan.force ? ", anti-doublon IGNORÉ" : ""}) :{" "}
            <strong>{bilan.facturesEchues}</strong> facture(s) échue(s) —{" "}
            <strong>{bilan.envoyees}</strong> envoyée(s),{" "}
            <strong>{bilan.ignorees}</strong> ignorée(s),{" "}
            <strong>{bilan.echecs}</strong> échec(s).
            {bilan.modeTest && (
              <span className="text-amber-800">
                {" "}
                Mode test : emails vers {bilan.modeTest}.
              </span>
            )}
          </p>
          {bilan.details.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">Facture</th>
                    <th className="px-3 py-2 font-medium">Client</th>
                    <th className="px-3 py-2 font-medium">Échéance</th>
                    <th className="px-3 py-2 font-medium">Résultat</th>
                    <th className="px-3 py-2 font-medium">Détail</th>
                  </tr>
                </thead>
                <tbody>
                  {bilan.details.map((d) => (
                    <tr
                      key={d.numero}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-mono">
                        {d.numero}
                      </td>
                      <td className="px-3 py-2">{d.client}</td>
                      <td className="px-3 py-2">
                        {d.echeance.split("-").reverse().join("/")}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEURS[d.resultat]}`}
                        >
                          {LIBELLES[d.resultat]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{d.motif}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
