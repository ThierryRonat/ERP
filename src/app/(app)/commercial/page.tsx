import Link from "next/link";
import { obtenirUtilisateurCourant } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";
import {
  LIBELLES_STATUT_DEVIS,
  LIBELLES_STATUT_PROSPECT,
  peutGererCommercial,
  type StatutDevis,
  type StatutProspect,
} from "@/lib/commercial";
import { depuisBase, formaterEuros } from "@/lib/montants";
import { SelecteurStatutDevis } from "./SelecteurStatutDevis";
import { FormulaireProspect } from "./FormulaireProspect";
import { Onglets } from "@/composants/Onglets";

const COULEURS_DEVIS: Record<StatutDevis, string> = {
  brouillon: "bg-slate-100 text-slate-700",
  envoye: "bg-blue-100 text-blue-800",
  accepte: "bg-green-100 text-green-800",
  refuse: "bg-red-100 text-red-800",
};
const COULEURS_PROSPECT: Record<StatutProspect, string> = {
  contacte: "bg-slate-100 text-slate-700",
  devis_envoye: "bg-blue-100 text-blue-800",
  gagne: "bg-green-100 text-green-800",
  perdu: "bg-red-100 text-red-800",
};

type Onglet = "prospects" | "devis";

export default async function PageCommercial({ searchParams }: PageProps<"/commercial">) {
  const utilisateur = await obtenirUtilisateurCourant();
  const gestion = peutGererCommercial(utilisateur.role, utilisateur.collaborateurId);
  const { devis_cree, onglet: ongletDemande } = await searchParams;
  const onglet: Onglet = ongletDemande === "devis" ? "devis" : "prospects";

  // Lecture avec la session : la RLS décide de ce qui est visible.
  const supabase = await creerClientServeur();
  const [{ data: devis, error: e1 }, { data: prospects, error: e2 }] = await Promise.all([
    supabase
      .from("devis")
      .select("id, numero, date_emission, statut, total_ht, tva, total_ttc, prospects(nom, societe)")
      .order("numero", { ascending: false }),
    supabase.from("prospects").select("id, nom, societe, email, telephone, source, statut").order("nom"),
  ]);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Commercial</h1>
        <p className="text-slate-600">Prospects et devis.</p>
        {!gestion && (
          <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            👁️ Lecture seule : la création de prospects et de devis est réservée aux managers et administrateurs.
          </p>
        )}
        {(e1 || e2) && (
          <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Lecture impossible : {(e1 ?? e2)?.message}
          </p>
        )}
        {typeof devis_cree === "string" && devis_cree && (
          <p
            role="status"
            className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
          >
            Devis <strong>{devis_cree}</strong> créé.
          </p>
        )}
      </div>

      {/* ── Onglets ── */}
      <Onglets
        chemin="/commercial"
        libelle="Sections du Commercial"
        actif={onglet}
        onglets={[
          { cle: "prospects", libelle: "Prospects", nombre: prospects?.length ?? 0 },
          { cle: "devis", libelle: "Devis", nombre: devis?.length ?? 0 },
        ]}
      />

      {/* ── Devis ── */}
      {onglet === "devis" && (
        <div role="tabpanel" aria-label="Devis">
          <div className="mb-3 flex items-center justify-end">
            {gestion && (
              <Link
                href="/commercial/devis/nouveau"
                className="rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800"
              >
                + Nouveau devis
              </Link>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Numéro</th>
                  <th className="px-4 py-3 font-medium">Prospect</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 text-right font-medium">Total HT</th>
                  <th className="px-4 py-3 text-right font-medium">TVA</th>
                  <th className="px-4 py-3 text-right font-medium">Total TTC</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-4 py-3 font-medium">PDF</th>
                </tr>
              </thead>
              <tbody>
                {(devis ?? []).map((d) => {
                  const prospect = d.prospects as unknown as { nom: string; societe: string | null } | null;
                  const statut = d.statut as StatutDevis;
                  return (
                    <tr key={d.id} className="border-b border-slate-100 last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 font-mono font-medium text-slate-900">{d.numero}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {prospect?.nom}
                        {prospect?.societe && <span className="text-slate-500"> — {prospect.societe}</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {new Date(d.date_emission).toLocaleDateString("fr-FR")}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formaterEuros(depuisBase(d.total_ht))}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formaterEuros(depuisBase(d.tva))}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {formaterEuros(depuisBase(d.total_ttc))}
                      </td>
                      <td className="px-4 py-3">
                        {gestion ? (
                          <SelecteurStatutDevis devisId={d.id} numero={d.numero} statut={statut} />
                        ) : (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEURS_DEVIS[statut]}`}>
                            {LIBELLES_STATUT_DEVIS[statut]}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <a
                            href={`/commercial/devis/${d.id}/pdf?mode=apercu`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Visualiser le PDF du devis ${d.numero}`}
                            className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            👁 Visualiser
                          </a>
                          <a
                            href={`/commercial/devis/${d.id}/pdf`}
                            download
                            aria-label={`Télécharger le PDF du devis ${d.numero}`}
                            className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            ⬇ Télécharger
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {devis?.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                      Aucun devis pour l&apos;instant.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Prospects ── */}
      {onglet === "prospects" && (
        <div role="tabpanel" aria-label="Prospects">
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Nom</th>
                  <th className="px-4 py-3 font-medium">Société</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Téléphone</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {(prospects ?? []).map((p) => {
                  const statut = p.statut as StatutProspect;
                  return (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 font-medium text-slate-900">{p.nom}</td>
                      <td className="px-4 py-3 text-slate-700">{p.societe ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700">{p.email ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700">{p.telephone ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700">{p.source ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEURS_PROSPECT[statut]}`}>
                          {LIBELLES_STATUT_PROSPECT[statut]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {prospects?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                      Aucun prospect visible.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {gestion && <FormulaireProspect />}
        </div>
      )}
    </section>
  );
}
