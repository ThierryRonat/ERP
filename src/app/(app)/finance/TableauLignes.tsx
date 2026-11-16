import { formaterEuros, versTexteDecimal } from "@/lib/montants";
import type { CalculFacture } from "@/lib/finance";

const heures = (c: bigint) =>
  versTexteDecimal(c)
    .replace(/\.?0+$/, "")
    .replace(".", ",");

/** Lignes « projet × taux » et totaux (aperçu ou facture reconstituée). */
export function TableauLignes({ calcul }: { calcul: CalculFacture }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Projet</th>
            <th className="px-4 py-2 text-left font-medium">Collaborateur(s)</th>
            <th className="px-4 py-2 text-right font-medium">Heures</th>
            <th className="px-4 py-2 text-right font-medium">Taux horaire HT</th>
            <th className="px-4 py-2 text-right font-medium">Montant HT</th>
          </tr>
        </thead>
        <tbody>
          {calcul.lignes.map((l) => (
            <tr key={`${l.projet}|${l.taux}`} className="border-b border-slate-100">
              <td className="px-4 py-2 text-slate-900">{l.projet}</td>
              <td className="px-4 py-2 text-slate-600">{l.collaborateurs.join(", ")}</td>
              <td className="px-4 py-2 text-right tabular-nums">{heures(l.heures)}</td>
              <td className={`px-4 py-2 text-right tabular-nums ${l.taux === 0n ? "font-semibold text-red-700" : ""}`}>
                {formaterEuros(l.taux)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums" data-testid="montant-ligne">
                {formaterEuros(l.montant)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-slate-200 bg-slate-50">
          <tr>
            <td colSpan={4} className="px-4 py-1.5 text-right text-slate-600">
              Total HT
            </td>
            <td className="px-4 py-1.5 text-right tabular-nums" data-testid="calcul-ht">
              {formaterEuros(calcul.totalHt)}
            </td>
          </tr>
          <tr>
            <td colSpan={4} className="px-4 py-1.5 text-right text-slate-600">
              TVA 20 %
            </td>
            <td className="px-4 py-1.5 text-right tabular-nums" data-testid="calcul-tva">
              {formaterEuros(calcul.tva)}
            </td>
          </tr>
          <tr className="font-semibold">
            <td colSpan={4} className="px-4 py-1.5 text-right">
              Total TTC
            </td>
            <td className="px-4 py-1.5 text-right tabular-nums" data-testid="calcul-ttc">
              {formaterEuros(calcul.totalTtc)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
