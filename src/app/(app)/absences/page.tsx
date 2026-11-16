import Link from "next/link";
import { obtenirUtilisateurCourant } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";
import {
  LIBELLES_STATUT_CONGE,
  LIBELLES_TYPE_CONGE,
  peutTraiterAbsences,
  peutTraiterCetteDemande,
  type StatutConge,
  type TypeConge,
} from "@/lib/absences";
import { nomComplet } from "@/lib/rh";
import { aujourdhuiParis, enCentiemes, formaterDate, formaterHeures } from "@/lib/dates";
import { Onglets } from "@/composants/Onglets";
import { FormulaireConge } from "./FormulaireConge";
import { ActionsConge } from "./ActionsConge";

type Onglet = "conges" | "notes";
type Personne = { prenom: string | null; nom: string } | null;

const COULEURS: Record<StatutConge, string> = {
  demandee: "bg-amber-100 text-amber-800",
  validee: "bg-green-100 text-green-800",
  refusee: "bg-red-100 text-red-800",
};
const jours = (n: number | string) => formaterHeures(enCentiemes(n)); // même mise en forme : 2,5

export default async function PageAbsences({ searchParams }: PageProps<"/absences">) {
  const utilisateur = await obtenirUtilisateurCourant();
  const { onglet: demande } = await searchParams;
  const onglet: Onglet = demande === "notes" ? "notes" : "conges";
  const traiteur = peutTraiterAbsences(utilisateur.role);

  // Lecture avec la SESSION : la RLS décide (les miens ; tout pour manager et admin).
  // ⚠️ conges pointe DEUX FOIS vers collaborateurs : on précise la colonne (sinon erreur PGRST201).
  const supabase = await creerClientServeur();
  const [{ data: conges, error }, { data: maFiche }] = await Promise.all([
    supabase
      .from("conges")
      .select(
        "id, collaborateur_id, type, date_debut, date_fin, nb_jours, motif, statut, created_at, demandeur:collaborateurs!collaborateur_id(prenom, nom), validateur:collaborateurs!valide_par(prenom, nom)",
      )
      .order("date_debut", { ascending: false }),
    utilisateur.collaborateurId
      ? supabase.from("collaborateurs").select("solde_conges").eq("id", utilisateur.collaborateurId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const tous = conges ?? [];
  const mesConges = tous.filter((c) => c.collaborateur_id === utilisateur.collaborateurId);
  const aTraiter = tous.filter(
    (c) =>
      c.statut === "demandee" &&
      peutTraiterCetteDemande(utilisateur.role, utilisateur.collaborateurId, c.collaborateur_id),
  );

  return (
    <section className="space-y-6">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Absences</h1>
        <p className="text-slate-600">Congés et notes de frais.</p>
        {error && (
          <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Lecture impossible : {error.message}
          </p>
        )}
      </div>

      <Onglets
        chemin="/absences"
        libelle="Sections Absences"
        actif={onglet}
        onglets={[
          { cle: "conges", libelle: "Congés", nombre: tous.length },
          { cle: "notes", libelle: "Notes de frais" },
        ]}
      />

      {onglet === "conges" && (
        <div role="tabpanel" aria-label="Congés" className="space-y-8">
          {utilisateur.collaborateurId && (
            <div className="flex flex-wrap items-stretch gap-4">
              <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Mon solde de congés</p>
                <p className="text-3xl font-semibold tabular-nums" data-testid="mon-solde">
                  {maFiche ? jours(maFiche.solde_conges) : "—"}
                  <span className="ml-1 text-base font-normal text-slate-500">jour(s)</span>
                </p>
                <p className="text-xs text-slate-500">Décompté à la validation (congés payés et RTT).</p>
              </div>
              <div className="min-w-72 flex-1">
                <FormulaireConge aujourdhui={aujourdhuiParis()} />
              </div>
            </div>
          )}

          {traiteur && (
            <div>
              <h2 className="mb-3 text-lg font-semibold">
                Demandes à traiter <span className="text-sm font-normal text-slate-500">({aTraiter.length})</span>
              </h2>
              <TableauConges
                conges={aTraiter}
                avecDemandeur
                actions={(c) => ({ peutTraiter: true, peutAnnuler: false, id: c.id })}
              />
            </div>
          )}

          <div>
            <h2 className="mb-3 text-lg font-semibold">
              Mes demandes <span className="text-sm font-normal text-slate-500">({mesConges.length})</span>
            </h2>
            <TableauConges
              conges={mesConges}
              actions={(c) => ({
                id: c.id,
                peutAnnuler: c.statut === "demandee",
                peutTraiter: c.statut === "demandee" && utilisateur.role === "admin",
              })}
            />
          </div>

          {traiteur && (
            <div>
              <h2 className="mb-3 text-lg font-semibold">
                Toutes les demandes <span className="text-sm font-normal text-slate-500">({tous.length})</span>
              </h2>
              <TableauConges conges={tous} avecDemandeur />
            </div>
          )}
        </div>
      )}

      {onglet === "notes" && (
        <div role="tabpanel" aria-label="Notes de frais">
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Les notes de frais arrivent à l&apos;étape suivante.
          </p>
        </div>
      )}
    </section>
  );
}

type LigneConge = {
  id: string;
  collaborateur_id: string;
  type: string;
  date_debut: string;
  date_fin: string;
  nb_jours: number | string;
  motif: string | null;
  statut: string;
  demandeur: unknown;
  validateur: unknown;
};

function TableauConges({
  conges,
  avecDemandeur = false,
  actions,
}: {
  conges: LigneConge[];
  avecDemandeur?: boolean;
  actions?: (c: LigneConge) => { id: string; peutTraiter: boolean; peutAnnuler: boolean };
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            {avecDemandeur && <th className="px-4 py-2 font-medium">Collaborateur</th>}
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Période</th>
            <th className="px-4 py-2 text-right font-medium">Jours</th>
            <th className="px-4 py-2 font-medium">Motif</th>
            <th className="px-4 py-2 font-medium">Statut</th>
            {actions && <th className="px-4 py-2 font-medium" />}
          </tr>
        </thead>
        <tbody>
          {conges.map((c) => {
            const demandeur = c.demandeur as Personne;
            const validateur = c.validateur as Personne;
            const statut = c.statut as StatutConge;
            const a = actions?.(c);
            return (
              <tr key={c.id} className="border-b border-slate-100 last:border-0 align-top">
                {avecDemandeur && (
                  <td className="px-4 py-2">
                    {demandeur ? (
                      <Link href={`/rh/collaborateurs/${c.collaborateur_id}`} className="text-blue-700 hover:underline">
                        {nomComplet(demandeur)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                )}
                <td className="px-4 py-2 text-slate-900">{LIBELLES_TYPE_CONGE[c.type as TypeConge]}</td>
                <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                  {formaterDate(c.date_debut)} → {formaterDate(c.date_fin)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{jours(c.nb_jours)}</td>
                <td className="px-4 py-2 text-slate-700">{c.motif ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEURS[statut]}`}>
                    {LIBELLES_STATUT_CONGE[statut]}
                  </span>
                  {validateur && statut !== "demandee" && (
                    <span className="mt-1 block text-xs text-slate-500">par {nomComplet(validateur)}</span>
                  )}
                </td>
                {actions && (
                  <td className="px-4 py-2">
                    {a && (a.peutTraiter || a.peutAnnuler) && (
                      <ActionsConge congeId={a.id} peutTraiter={a.peutTraiter} peutAnnuler={a.peutAnnuler} />
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {conges.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                Aucune demande.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
