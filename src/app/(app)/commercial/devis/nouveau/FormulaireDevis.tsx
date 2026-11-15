"use client";

import { useActionState, useState } from "react";
import { creerDevis } from "@/lib/actions/commercial";
import { TAUX_TVA_PAR_DEFAUT, type LigneSaisie } from "@/lib/commercial";
import { calculerTotaux, formaterEuros, lireCentiemes } from "@/lib/montants";
import { ETAT_INITIAL } from "@/lib/formulaires";

type Prospect = { id: string; nom: string; societe: string | null };

const LIGNE_VIDE: LigneSaisie = { designation: "", quantite: "1", prixUnitaire: "" };
const champ = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";

export function FormulaireDevis({ prospects }: { prospects: Prospect[] }) {
  const [etat, action, enCours] = useActionState(creerDevis, ETAT_INITIAL);
  const [lignes, setLignes] = useState<LigneSaisie[]>([{ ...LIGNE_VIDE }]);
  const [taux, setTaux] = useState(TAUX_TVA_PAR_DEFAUT);

  // Totaux INDICATIFS (le serveur recalcule) : seules les lignes complètes et valides comptent.
  const lues = lignes.map((l) => ({ quantite: lireCentiemes(l.quantite), prixUnitaire: lireCentiemes(l.prixUnitaire) }));
  const valides = lues.filter((l) => l.quantite !== null && l.prixUnitaire !== null) as {
    quantite: bigint;
    prixUnitaire: bigint;
  }[];
  const tauxLu = lireCentiemes(taux);
  const totaux = calculerTotaux(valides, tauxLu ?? 0n);

  function modifier(i: number, cle: keyof LigneSaisie, valeur: string) {
    setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, [cle]: valeur } : l)));
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="lignes" value={JSON.stringify(lignes)} />

      <div className="grid max-w-2xl gap-4 sm:grid-cols-[1fr_10rem]">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Prospect *</span>
          <select name="prospect_id" required defaultValue="" className={champ}>
            <option value="" disabled>
              — Choisir un prospect —
            </option>
            {prospects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
                {p.societe ? ` — ${p.societe}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Taux de TVA (%)</span>
          <input
            name="taux_tva"
            inputMode="decimal"
            value={taux}
            onChange={(e) => setTaux(e.target.value)}
            className={`${champ} ${tauxLu === null || tauxLu > 10000n ? "border-red-400" : ""}`}
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Désignation</th>
              <th className="w-28 px-3 py-2 font-medium">Quantité</th>
              <th className="w-36 px-3 py-2 font-medium">Prix unitaire HT (€)</th>
              <th className="w-36 px-3 py-2 text-right font-medium">Montant HT</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => {
              const lue = lues[i];
              const montant =
                lue.quantite !== null && lue.prixUnitaire !== null
                  ? formaterEuros(calculerTotaux([lue as { quantite: bigint; prixUnitaire: bigint }], 0n).totalHt)
                  : "—";
              return (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2">
                    <input
                      aria-label={`Désignation ligne ${i + 1}`}
                      value={l.designation}
                      onChange={(e) => modifier(i, "designation", e.target.value)}
                      className={champ}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      aria-label={`Quantité ligne ${i + 1}`}
                      inputMode="decimal"
                      value={l.quantite}
                      onChange={(e) => modifier(i, "quantite", e.target.value)}
                      className={`${champ} ${l.quantite && lue.quantite === null ? "border-red-400" : ""}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      aria-label={`Prix unitaire ligne ${i + 1}`}
                      inputMode="decimal"
                      value={l.prixUnitaire}
                      onChange={(e) => modifier(i, "prixUnitaire", e.target.value)}
                      className={`${champ} ${l.prixUnitaire && lue.prixUnitaire === null ? "border-red-400" : ""}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{montant}</td>
                  <td className="px-3 py-2 text-right">
                    {lignes.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Supprimer la ligne ${i + 1}`}
                        onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))}
                        className="text-slate-400 hover:text-red-600"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => setLignes((ls) => [...ls, { ...LIGNE_VIDE }])}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
      >
        + Ajouter une ligne
      </button>

      <dl className="ml-auto grid w-72 grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <dt className="text-slate-600">Total HT</dt>
        <dd className="text-right tabular-nums" data-testid="total-ht">{formaterEuros(totaux.totalHt)}</dd>
        <dt className="text-slate-600">TVA ({tauxLu !== null ? taux.replace(".", ",") : "?"} %)</dt>
        <dd className="text-right tabular-nums" data-testid="total-tva">{formaterEuros(totaux.tva)}</dd>
        <dt className="font-semibold">Total TTC</dt>
        <dd className="text-right font-semibold tabular-nums" data-testid="total-ttc">{formaterEuros(totaux.totalTtc)}</dd>
      </dl>

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
        {enCours ? "Enregistrement…" : "Enregistrer le devis"}
      </button>
    </form>
  );
}
