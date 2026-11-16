import Link from "next/link";
import { exigerAdmin } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { apercuFacturable } from "@/lib/finance-serveur";
import { LIBELLES_STATUT_FACTURE, premierJourDuMois, type StatutFacture } from "@/lib/finance";
import { depuisBase, formaterEuros } from "@/lib/montants";
import { aujourdhuiParis, formaterDate } from "@/lib/dates";
import { BoutonGenerer } from "./BoutonGenerer";
import { SelecteurStatutFacture } from "./SelecteurStatutFacture";
import { TableauLignes } from "./TableauLignes";
import { AlerteMentions, BoutonsPdf } from "./AlerteMentions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const champ = "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";

export default async function PageFinance({ searchParams }: PageProps<"/finance">) {
  await exigerAdmin(); // un non-admin qui tape l'adresse est renvoyé à l'accueil
  const { client, mois } = await searchParams;
  const clientChoisi = typeof client === "string" && UUID.test(client) ? client : null;
  const premierJour = premierJourDuMois(mois) ?? premierJourDuMois(aujourdhuiParis())!;
  const moisSaisie = premierJour.slice(0, 7);

  const supabase = await creerClientServeur(); // RLS : admin seul voit les factures
  const [{ data: clients }, { data: factures, error }] = await Promise.all([
    supabase.from("clients").select("id, nom").order("nom"),
    supabase
      .from("factures")
      .select("id, numero, date_emission, date_echeance, periode_debut, total_ht, tva, total_ttc, statut, clients(nom)")
      .order("numero", { ascending: false }),
  ]);

  const apercu = clientChoisi ? await apercuFacturable(clientChoisi, premierJour) : null;
  const nomClient = clients?.find((c) => c.id === clientChoisi)?.nom;

  return (
    <section className="space-y-10">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Finance</h1>
        <p className="text-slate-600">Facturation des temps validés.</p>
      </div>

      <AlerteMentions />

      {/* ── Nouvelle facture ── */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Nouvelle facture</h2>
        <form
          method="get"
          className="grid max-w-2xl gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
        >
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Client</span>
            <select name="client" required defaultValue={clientChoisi ?? ""} className={champ}>
              <option value="" disabled>
                — Choisir un client —
              </option>
              {(clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Mois</span>
            <input type="month" name="mois" required defaultValue={moisSaisie} className={champ} />
          </label>
          <button
            type="submit"
            className="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            Afficher les temps
          </button>
        </form>

        {apercu && (
          <div className="mt-4">
            <p className="mb-2 text-sm text-slate-700">
              Temps <strong>validés</strong> et <strong>non facturés</strong> de <strong>{nomClient}</strong> du{" "}
              {formaterDate(premierJour, { day: "numeric", month: "long", year: "numeric" })} à la fin du mois :{" "}
              <strong data-testid="nombre-temps">{apercu.nombreTemps}</strong> saisie(s).
            </p>
            {apercu.nombreTemps === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Rien à facturer sur cette période.
              </p>
            ) : (
              <>
                <TableauLignes calcul={apercu} />
                {apercu.tauxAZero.length > 0 && (
                  <p
                    role="alert"
                    className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  >
                    Génération impossible : taux horaire à 0 pour <strong>{apercu.tauxAZero.join(", ")}</strong>.
                    Renseignez-le dans RH → fiche → Modifier, puis revenez ici.
                  </p>
                )}
                <BoutonGenerer clientId={clientChoisi!} mois={premierJour} desactive={apercu.tauxAZero.length > 0} />
                <p className="mt-2 text-xs text-slate-500">
                  Le numéro est attribué à la génération. La base recalcule elle-même les montants sur les temps
                  réellement rattachés.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Factures ── */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">
          Factures <span className="text-sm font-normal text-slate-500">({factures?.length ?? 0})</span>
        </h2>
        {error && (
          <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Lecture impossible : {error.message}
          </p>
        )}
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">Numéro</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Période</th>
                <th className="px-4 py-3 font-medium">Émise le</th>
                <th className="px-4 py-3 font-medium">Échéance</th>
                <th className="px-4 py-3 text-right font-medium">Total HT</th>
                <th className="px-4 py-3 text-right font-medium">Total TTC</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                <th className="px-4 py-3 font-medium">PDF</th>
              </tr>
            </thead>
            <tbody>
              {(factures ?? []).map((f) => (
                <tr key={f.id} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-mono font-medium">
                    <Link href={`/finance/factures/${f.id}`} className="text-blue-700 hover:underline">
                      {f.numero}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{(f.clients as unknown as { nom: string } | null)?.nom}</td>
                  <td className="px-4 py-3 capitalize text-slate-700">
                    {formaterDate(f.periode_debut, { month: "long", year: "numeric" })}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{formaterDate(f.date_emission)}</td>
                  <td className="px-4 py-3 text-slate-700">{formaterDate(f.date_echeance)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formaterEuros(depuisBase(f.total_ht))}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {formaterEuros(depuisBase(f.total_ttc))}
                  </td>
                  <td className="px-4 py-3">
                    <SelecteurStatutFacture id={f.id} numero={f.numero} statut={f.statut as StatutFacture} />
                  </td>
                  <td className="px-4 py-3">
                    <BoutonsPdf id={f.id} numero={f.numero} />
                  </td>
                </tr>
              ))}
              {factures?.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-500">
                    Aucune facture pour l&apos;instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Statuts : {Object.values(LIBELLES_STATUT_FACTURE).join(" → ")}. Une facture n&apos;est jamais supprimée et son
          numéro ne change jamais.
        </p>
      </div>
    </section>
  );
}
