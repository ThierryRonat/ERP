import Link from "next/link";
import { obtenirUtilisateurCourant } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { LIBELLES_STATUT_PROJET, nomComplet, type StatutProjet } from "@/lib/rh";
import { Onglets } from "@/composants/Onglets";
import { SelecteurStatutProjet } from "./SelecteurStatutProjet";
import { FormulaireProjet } from "./FormulaireProjet";

type Onglet = "collaborateurs" | "projets";

const COULEURS_PROJET: Record<StatutProjet, string> = {
  en_cours: "bg-blue-100 text-blue-800",
  termine: "bg-green-100 text-green-800",
  annule: "bg-slate-200 text-slate-700",
};

export default async function PageRH({ searchParams }: PageProps<"/rh">) {
  const utilisateur = await obtenirUtilisateurCourant();
  const estAdmin = utilisateur.role === "admin";
  const { onglet: demande, fiche_enregistree } = await searchParams;
  const onglet: Onglet = demande === "projets" ? "projets" : "collaborateurs";

  // Lecture avec la SESSION : la RLS décide de ce qui est visible. taux_horaire n'est JAMAIS demandé ici.
  const supabase = await creerClientServeur();
  const [{ data: fiches, error: e1 }, { data: projets, error: e2 }] = await Promise.all([
    supabase.from("collaborateurs").select("id, prenom, nom, email, poste, date_entree, manager_id").order("nom"),
    supabase
      .from("projets")
      .select("id, nom, statut, created_at, clients(nom), devis(numero)")
      .order("created_at", { ascending: false }),
  ]);

  const parId = new Map((fiches ?? []).map((f) => [f.id, f]));

  return (
    <section className="space-y-6">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">RH</h1>
        <p className="text-slate-600">Collaborateurs et projets.</p>
        {(e1 || e2) && (
          <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Lecture impossible : {(e1 ?? e2)?.message}
          </p>
        )}
        {typeof fiche_enregistree === "string" && fiche_enregistree && (
          <p role="status" className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            Fiche de <strong>{fiche_enregistree}</strong> enregistrée.
          </p>
        )}
      </div>

      <Onglets
        chemin="/rh"
        libelle="Sections RH"
        actif={onglet}
        onglets={[
          { cle: "collaborateurs", libelle: "Collaborateurs", nombre: fiches?.length ?? 0 },
          { cle: "projets", libelle: "Projets", nombre: projets?.length ?? 0 },
        ]}
      />

      {/* ── Collaborateurs ── */}
      {onglet === "collaborateurs" && (
        <div role="tabpanel" aria-label="Collaborateurs">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Fiches collaborateurs visibles : <span data-testid="nombre-fiches">{fiches?.length ?? 0}</span>
            </h2>
            {estAdmin && (
              <Link
                href="/rh/collaborateurs/nouveau"
                className="rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800"
              >
                + Nouvelle fiche
              </Link>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Nom</th>
                  <th className="px-4 py-3 font-medium">Poste</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Entrée</th>
                  <th className="px-4 py-3 font-medium">Manager</th>
                  {estAdmin && <th className="px-4 py-3 font-medium" />}
                </tr>
              </thead>
              <tbody>
                {(fiches ?? []).map((f) => {
                  const manager = f.manager_id ? parId.get(f.manager_id) : null;
                  return (
                    <tr key={f.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 font-medium text-slate-900">{nomComplet(f)}</td>
                      <td className="px-4 py-3 text-slate-700">{f.poste ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700">{f.email ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {f.date_entree ? new Date(f.date_entree).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {manager ? nomComplet(manager) : f.manager_id ? <em className="text-slate-400">non visible</em> : "—"}
                      </td>
                      {estAdmin && (
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/rh/collaborateurs/${f.id}`}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Modifier
                          </Link>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {fiches?.length === 0 && (
                  <tr>
                    <td colSpan={estAdmin ? 6 : 5} className="px-4 py-6 text-center text-slate-500">
                      Aucune fiche visible.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Projets ── */}
      {onglet === "projets" && (
        <div role="tabpanel" aria-label="Projets">
          <p className="mb-3 text-sm text-slate-600">
            Un projet est créé automatiquement quand un devis passe à « Accepté ».
            {!estAdmin && " La création manuelle et le changement de statut sont réservés à l'administrateur."}
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Projet</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Devis d&apos;origine</th>
                  <th className="px-4 py-3 font-medium">Créé le</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {(projets ?? []).map((p) => {
                  const client = p.clients as unknown as { nom: string } | null;
                  const devis = p.devis as unknown as { numero: string } | null;
                  const statut = p.statut as StatutProjet;
                  return (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 font-medium text-slate-900">{p.nom}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {client?.nom ?? <em className="text-slate-400">réservé manager / admin</em>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-700">{devis?.numero ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700">{new Date(p.created_at).toLocaleDateString("fr-FR")}</td>
                      <td className="px-4 py-3">
                        {estAdmin ? (
                          <SelecteurStatutProjet projetId={p.id} nom={p.nom} statut={statut} />
                        ) : (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEURS_PROJET[statut]}`}>
                            {LIBELLES_STATUT_PROJET[statut]}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {projets?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      Aucun projet visible.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {estAdmin && <ZoneCreationProjet />}
        </div>
      )}
    </section>
  );
}

/** Formulaire de création : listes construites sur ce que l'admin a le droit de choisir. */
async function ZoneCreationProjet() {
  const supabase = await creerClientServeur();
  const [{ data: clients }, { data: devis }, { data: projets }] = await Promise.all([
    supabase.from("clients").select("id, nom").order("nom"),
    supabase.from("devis").select("id, numero, prospects(nom, societe)").order("numero"),
    supabase.from("projets").select("devis_id"),
  ]);
  const devisDejaLies = new Set((projets ?? []).map((p) => p.devis_id).filter(Boolean));
  const devisLibres = (devis ?? [])
    .filter((d) => !devisDejaLies.has(d.id))
    .map((d) => {
      const p = d.prospects as unknown as { nom: string; societe: string | null } | null;
      return { id: d.id, libelle: `${d.numero} — ${p?.societe ?? p?.nom ?? ""}` };
    });
  return <FormulaireProjet clients={clients ?? []} devis={devisLibres} />;
}
