import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenirUtilisateurCourant } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";
import {
  LIBELLES_STATUT_PROJET,
  LIBELLES_STATUT_TEMPS,
  nomComplet,
  type StatutProjet,
  type StatutTemps,
} from "@/lib/rh";
import {
  aujourdhuiParis,
  ajouterJours,
  enCentiemes,
  estDateIso,
  formaterDate,
  formaterHeures,
  joursDeLaSemaine,
  lundiDe,
  numeroSemaine,
} from "@/lib/dates";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COULEURS_TEMPS: Record<StatutTemps, string> = {
  brouillon: "bg-slate-100 text-slate-700",
  soumis: "bg-blue-100 text-blue-800",
  valide: "bg-green-100 text-green-800",
};

type LigneTemps = {
  id: string;
  date_saisie: string;
  heures: number;
  commentaire: string | null;
  statut: StatutTemps;
  projet_id: string;
  projet: { nom: string; statut: StatutProjet } | null;
};

/**
 * Fiche collaborateur en CONSULTATION. Tout est lu avec la session : la RLS décide.
 * - un collaborateur ne voit que SA fiche (une autre → 404) et ses temps ;
 * - manager et admin voient toutes les fiches et tous les temps.
 * Le taux horaire n'est JAMAIS lu ici (il ne l'est que sur l'écran « Modifier », côté serveur).
 */
export default async function PageFicheCollaborateur({ params, searchParams }: PageProps<"/rh/collaborateurs/[id]">) {
  const utilisateur = await obtenirUtilisateurCourant();
  const { id } = await params;
  const { semaine, enregistree } = await searchParams;
  if (!UUID.test(id)) notFound();

  const supabase = await creerClientServeur();
  const { data: fiche } = await supabase
    .from("collaborateurs")
    .select("id, nom, prenom, email, poste, date_entree, manager_id")
    .eq("id", id)
    .maybeSingle();
  if (!fiche) notFound(); // inexistante OU masquée par la RLS

  const [{ data: manager }, { data: brut }] = await Promise.all([
    fiche.manager_id
      ? supabase.from("collaborateurs").select("id, nom, prenom").eq("id", fiche.manager_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("temps")
      .select("id, date_saisie, heures, commentaire, statut, projet_id, projets(nom, statut)")
      .eq("collaborateur_id", id)
      .order("date_saisie", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  const temps: LigneTemps[] = (brut ?? []).map((t) => ({
    ...t,
    statut: t.statut as StatutTemps,
    projet: t.projets as unknown as LigneTemps["projet"],
  }));

  // ── Semaine affichée (en cours par défaut) ──
  const aujourdhui = aujourdhuiParis();
  const lundi = lundiDe(estDateIso(semaine) ? semaine : aujourdhui);
  const jours = joursDeLaSemaine(lundi);
  const estSemaineEnCours = lundi === lundiDe(aujourdhui);
  const tempsSemaine = temps.filter((t) => t.date_saisie >= jours[0] && t.date_saisie <= jours[6]);

  const projetsSemaine = [...new Map(tempsSemaine.map((t) => [t.projet_id, t.projet?.nom ?? "—"])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1], "fr"),
  );
  const cellule = (projetId: string, jour: string) =>
    tempsSemaine
      .filter((t) => t.projet_id === projetId && t.date_saisie === jour)
      .reduce((s, t) => s + enCentiemes(t.heures), 0);
  const totalJour = (jour: string) =>
    tempsSemaine.filter((t) => t.date_saisie === jour).reduce((s, t) => s + enCentiemes(t.heures), 0);
  const totalProjetSemaine = (projetId: string) =>
    tempsSemaine.filter((t) => t.projet_id === projetId).reduce((s, t) => s + enCentiemes(t.heures), 0);
  const totalSemaine = tempsSemaine.reduce((s, t) => s + enCentiemes(t.heures), 0);

  // ── Cumul par projet (depuis le début) ──
  const parProjet = new Map<
    string,
    { nom: string; statutProjet: StatutProjet | null; saisies: number } & Record<StatutTemps, number>
  >();
  for (const t of temps) {
    const ligne = parProjet.get(t.projet_id) ?? {
      nom: t.projet?.nom ?? "—",
      statutProjet: t.projet?.statut ?? null,
      saisies: 0,
      brouillon: 0,
      soumis: 0,
      valide: 0,
    };
    ligne.saisies += 1;
    ligne[t.statut] += enCentiemes(t.heures);
    parProjet.set(t.projet_id, ligne);
  }
  const projetsCumul = [...parProjet.entries()].sort((a, b) => a[1].nom.localeCompare(b[1].nom, "fr"));
  const totalStatut = (s: StatutTemps) => projetsCumul.reduce((acc, [, l]) => acc + l[s], 0);
  const totalGeneral = totalStatut("brouillon") + totalStatut("soumis") + totalStatut("valide");

  const estMaFiche = fiche.id === utilisateur.collaborateurId;
  const lienSemaine = (l: string) => `/rh/collaborateurs/${id}?semaine=${l}`;

  return (
    <section className="space-y-8">
      <div>
        <Link href="/rh?onglet=collaborateurs" className="text-sm text-blue-700 underline">
          ← Retour à RH
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {nomComplet(fiche)} {estMaFiche && <span className="text-base font-normal text-blue-700">(vous)</span>}
            </h1>
            <p className="text-slate-600">{fiche.poste ?? "Poste non renseigné"}</p>
          </div>
          {utilisateur.role === "admin" && (
            <Link
              href={`/rh/collaborateurs/${fiche.id}/modifier`}
              className="rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >
              Modifier la fiche
            </Link>
          )}
        </div>
        {enregistree === "1" && (
          <p
            role="status"
            className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
          >
            Fiche enregistrée.
          </p>
        )}
      </div>

      {/* ── Informations ── */}
      <dl className="grid gap-x-8 gap-y-3 rounded-lg border border-slate-200 bg-white p-5 text-sm sm:grid-cols-2">
        <Info libelle="Nom" valeur={fiche.nom} />
        <Info libelle="Prénom" valeur={fiche.prenom} />
        <Info libelle="Email" valeur={fiche.email} />
        <Info libelle="Poste" valeur={fiche.poste} />
        <Info
          libelle="Date d'entrée"
          valeur={fiche.date_entree ? formaterDate(fiche.date_entree, { dateStyle: "long" }) : null}
        />
        <Info
          libelle="Manager"
          valeur={manager ? nomComplet(manager) : fiche.manager_id ? "(non visible avec vos droits)" : null}
          lien={manager ? `/rh/collaborateurs/${manager.id}` : undefined}
        />
      </dl>

      {/* ── Semaine ── */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {estSemaineEnCours ? "Semaine en cours" : "Semaine"} — n° {numeroSemaine(lundi)}{" "}
            <span className="text-sm font-normal text-slate-500">
              du {formaterDate(jours[0], { day: "numeric", month: "long" })} au{" "}
              {formaterDate(jours[6], { day: "numeric", month: "long", year: "numeric" })}
            </span>
          </h2>
          <nav aria-label="Changer de semaine" className="flex gap-2 text-sm">
            <Link
              href={lienSemaine(ajouterJours(lundi, -7))}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50"
            >
              ← Précédente
            </Link>
            {!estSemaineEnCours && (
              <Link
                href={`/rh/collaborateurs/${id}`}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50"
              >
                Semaine en cours
              </Link>
            )}
            <Link
              href={lienSemaine(ajouterJours(lundi, 7))}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50"
            >
              Suivante →
            </Link>
          </nav>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Projet</th>
                {jours.map((j) => (
                  <th
                    key={j}
                    className={`px-3 py-2 text-right font-medium ${j === aujourdhui ? "bg-blue-50 text-blue-800" : ""}`}
                  >
                    <span className="capitalize">{formaterDate(j, { weekday: "short" })}</span>
                    <span className="block text-xs font-normal">
                      {formaterDate(j, { day: "2-digit", month: "2-digit" })}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {projetsSemaine.map(([projetId, nom]) => (
                <tr key={projetId} className="border-b border-slate-100">
                  <td className="px-3 py-2 text-slate-900">{nom}</td>
                  {jours.map((j) => {
                    const h = cellule(projetId, j);
                    return (
                      <td
                        key={j}
                        className={`px-3 py-2 text-right tabular-nums ${j === aujourdhui ? "bg-blue-50" : ""}`}
                      >
                        {h ? formaterHeures(h) : <span className="text-slate-300">·</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formaterHeures(totalProjetSemaine(projetId))}
                  </td>
                </tr>
              ))}
              {projetsSemaine.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                    Aucun temps enregistré cette semaine.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
              <tr>
                <td className="px-3 py-2">Total du jour</td>
                {jours.map((j) => (
                  <td key={j} className={`px-3 py-2 text-right tabular-nums ${j === aujourdhui ? "bg-blue-50" : ""}`}>
                    {totalJour(j) ? formaterHeures(totalJour(j)) : "—"}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums" data-testid="total-semaine">
                  {formaterHeures(totalSemaine)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {tempsSemaine.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-slate-700">
            {tempsSemaine.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-slate-500">
                  {formaterDate(t.date_saisie, { weekday: "short", day: "2-digit", month: "2-digit" })}
                </span>
                <span className="font-medium">{formaterHeures(enCentiemes(t.heures))} h</span>
                <span>{t.projet?.nom}</span>
                {t.commentaire && <span className="text-slate-500">— {t.commentaire}</span>}
                <Badge statut={t.statut} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Cumul par projet ── */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Temps par projet (depuis le début)</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Projet</th>
                <th className="px-4 py-2 text-left font-medium">Statut du projet</th>
                <th className="px-4 py-2 text-right font-medium">Saisies</th>
                <th className="px-4 py-2 text-right font-medium">Brouillon</th>
                <th className="px-4 py-2 text-right font-medium">Soumis</th>
                <th className="px-4 py-2 text-right font-medium">Validé</th>
                <th className="px-4 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {projetsCumul.map(([projetId, l]) => (
                <tr key={projetId} className="border-b border-slate-100" data-projet={l.nom}>
                  <td className="px-4 py-2 text-slate-900">{l.nom}</td>
                  <td className="px-4 py-2 text-slate-700">
                    {l.statutProjet ? LIBELLES_STATUT_PROJET[l.statutProjet] : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.saisies}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formaterHeures(l.brouillon)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formaterHeures(l.soumis)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formaterHeures(l.valide)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums" data-testid="total-projet">
                    {formaterHeures(l.brouillon + l.soumis + l.valide)}
                  </td>
                </tr>
              ))}
              {projetsCumul.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    Aucun temps enregistré.
                  </td>
                </tr>
              )}
            </tbody>
            {projetsCumul.length > 0 && (
              <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
                <tr>
                  <td className="px-4 py-2" colSpan={2}>
                    Total
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{temps.length}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formaterHeures(totalStatut("brouillon"))}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formaterHeures(totalStatut("soumis"))}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formaterHeures(totalStatut("valide"))}</td>
                  <td className="px-4 py-2 text-right tabular-nums" data-testid="total-general">
                    {formaterHeures(totalGeneral)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Historique ── */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">
          Historique des temps <span className="text-sm font-normal text-slate-500">({temps.length})</span>
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Projet</th>
                <th className="px-4 py-2 text-right font-medium">Heures</th>
                <th className="px-4 py-2 text-left font-medium">Commentaire</th>
                <th className="px-4 py-2 text-left font-medium">Statut</th>
              </tr>
            </thead>
            <tbody>
              {temps.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 text-slate-700">{formaterDate(t.date_saisie)}</td>
                  <td className="px-4 py-2 text-slate-900">{t.projet?.nom ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formaterHeures(enCentiemes(t.heures))}</td>
                  <td className="px-4 py-2 text-slate-700">{t.commentaire ?? "—"}</td>
                  <td className="px-4 py-2">
                    <Badge statut={t.statut} />
                  </td>
                </tr>
              ))}
              {temps.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    Aucun temps enregistré.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {estMaFiche && (
          <p className="mt-2 text-sm text-slate-600">
            Pour saisir ou modifier vos temps :{" "}
            <Link href="/rh?onglet=temps" className="text-blue-700 underline">
              RH → Temps
            </Link>
            .
          </p>
        )}
      </div>
    </section>
  );
}

function Info({ libelle, valeur, lien }: { libelle: string; valeur: string | null; lien?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{libelle}</dt>
      <dd className="mt-0.5 text-slate-900">
        {valeur ? (
          lien ? (
            <Link href={lien} className="text-blue-700 underline">
              {valeur}
            </Link>
          ) : (
            valeur
          )
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </dd>
    </div>
  );
}

function Badge({ statut }: { statut: StatutTemps }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEURS_TEMPS[statut]}`}>
      {LIBELLES_STATUT_TEMPS[statut]}
    </span>
  );
}
