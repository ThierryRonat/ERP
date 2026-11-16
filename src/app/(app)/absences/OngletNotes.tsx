import Link from "next/link";
import { creerClientServeur } from "@/lib/supabase/serveur";
import type { UtilisateurCourant } from "@/lib/session";
import {
  BUCKET_JUSTIFICATIFS,
  LIBELLES_STATUT_NOTE,
  peutTraiterAbsences,
  peutTraiterCetteDemande,
  type StatutNote,
} from "@/lib/absences";
import { nomComplet } from "@/lib/rh";
import { depuisBase, formaterEuros } from "@/lib/montants";
import { aujourdhuiParis, formaterDate } from "@/lib/dates";
import { FormulaireNote } from "./FormulaireNote";
import { ActionsNote } from "./ActionsNote";

const COULEURS: Record<StatutNote, string> = {
  soumise: "bg-amber-100 text-amber-800",
  validee: "bg-green-100 text-green-800",
  remboursee: "bg-blue-100 text-blue-800",
};

/** Durée de vie d'une adresse signée : courte, elle est REFABRIQUÉE à chaque affichage. */
const DUREE_ADRESSE_SECONDES = 600;

export async function OngletNotes({ utilisateur }: { utilisateur: UtilisateurCourant }) {
  const supabase = await creerClientServeur();
  const { data: notes, error } = await supabase
    .from("notes_de_frais")
    .select(
      "id, collaborateur_id, date_depense, montant, categorie, justificatif_url, statut, collaborateurs(prenom, nom)",
    )
    .order("date_depense", { ascending: false })
    .order("created_at", { ascending: false });

  // En base : le CHEMIN. Ici, à CHAQUE affichage : une adresse signée neuve, valable 10 minutes.
  // Elle est demandée avec la session de l'utilisateur : les règles du stockage s'appliquent.
  const chemins = (notes ?? []).map((n) => n.justificatif_url).filter((c): c is string => Boolean(c));
  const { data: signees } = chemins.length
    ? await supabase.storage.from(BUCKET_JUSTIFICATIFS).createSignedUrls(chemins, DUREE_ADRESSE_SECONDES)
    : { data: [] };
  const adresse = new Map((signees ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));

  const traiteur = peutTraiterAbsences(utilisateur.role);
  const total = (notes ?? []).length;

  return (
    <div role="tabpanel" aria-label="Notes de frais" className="space-y-6">
      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Lecture impossible : {error.message}
        </p>
      )}
      {utilisateur.collaborateurId && (
        <FormulaireNote collaborateurId={utilisateur.collaborateurId} aujourdhui={aujourdhuiParis()} />
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold">
          {traiteur ? "Toutes les notes de frais" : "Mes notes de frais"}{" "}
          <span className="text-sm font-normal text-slate-500">({total})</span>
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                {traiteur && <th className="px-4 py-2 font-medium">Collaborateur</th>}
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Catégorie</th>
                <th className="px-4 py-2 text-right font-medium">Montant</th>
                <th className="px-4 py-2 font-medium">Justificatif</th>
                <th className="px-4 py-2 font-medium">Statut</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {(notes ?? []).map((n) => {
                const statut = n.statut as StatutNote;
                const auteur = n.collaborateurs as unknown as { prenom: string | null; nom: string } | null;
                const lien = n.justificatif_url ? adresse.get(n.justificatif_url) : undefined;
                const estImage = /\.(jpe?g|png|webp)$/i.test(n.justificatif_url ?? "");
                const peutTraiter = peutTraiterCetteDemande(
                  utilisateur.role,
                  utilisateur.collaborateurId,
                  n.collaborateur_id,
                );
                const estAuteur = n.collaborateur_id === utilisateur.collaborateurId;
                return (
                  <tr key={n.id} className="border-b border-slate-100 last:border-0 align-top">
                    {traiteur && (
                      <td className="px-4 py-2">
                        {auteur ? (
                          <Link
                            href={`/rh/collaborateurs/${n.collaborateur_id}`}
                            className="text-blue-700 hover:underline"
                          >
                            {nomComplet(auteur)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-2 text-slate-700">{formaterDate(n.date_depense)}</td>
                    <td className="px-4 py-2 text-slate-700">{n.categorie ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formaterEuros(depuisBase(n.montant))}</td>
                    <td className="px-4 py-2">
                      {lien ? (
                        <a
                          href={lien}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid="lien-justificatif"
                          className="inline-flex items-center gap-2 text-blue-700 hover:underline"
                        >
                          {estImage && (
                            // eslint-disable-next-line @next/next/no-img-element -- adresse signée temporaire, hors optimiseur d'images
                            <img
                              src={lien}
                              alt="Justificatif"
                              className="h-12 w-12 rounded border border-slate-200 object-cover"
                            />
                          )}
                          Voir
                        </a>
                      ) : (
                        <span className="text-xs text-red-700">indisponible</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEURS[statut]}`}>
                        {LIBELLES_STATUT_NOTE[statut]}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <ActionsNote
                        noteId={n.id}
                        peutValider={peutTraiter && statut === "soumise"}
                        peutRembourser={peutTraiter && statut === "validee"}
                        peutSupprimer={estAuteur && statut === "soumise"}
                      />
                    </td>
                  </tr>
                );
              })}
              {total === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    Aucune note de frais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Les liens vers les justificatifs sont temporaires (10 minutes) et recréés à chaque affichage de la page.
        </p>
      </div>
    </div>
  );
}
