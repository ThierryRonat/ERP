import Link from "next/link";
import { notFound } from "next/navigation";
import { exigerAdmin } from "@/lib/session";
import { creerClientServeur } from "@/lib/supabase/serveur";
import { creerClientAdmin } from "@/lib/supabase/admin";
import { ecartAvecFigé, lignesDeFacture } from "@/lib/finance-serveur";
import { type StatutFacture } from "@/lib/finance";
import { formaterEuros } from "@/lib/montants";
import { enCentiemes, formaterDate, formaterHeures } from "@/lib/dates";
import { SelecteurStatutFacture } from "../../SelecteurStatutFacture";
import { TableauLignes } from "../../TableauLignes";
import { AlerteMentions, BoutonsPdf } from "../../AlerteMentions";
import { BoutonEnvoyer } from "../../BoutonEnvoyer";
import { configurationEmail } from "@/lib/email";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PageFacture({ params, searchParams }: PageProps<"/finance/factures/[id]">) {
  await exigerAdmin();
  const { id } = await params;
  const { generee } = await searchParams;
  if (!UUID.test(id)) notFound();

  // La facture elle-même : lue avec la SESSION (RLS admin)
  const supabase = await creerClientServeur();
  const { data: facture } = await supabase
    .from("factures")
    .select(
      "id, numero, date_emission, date_echeance, periode_debut, periode_fin, total_ht, tva, total_ttc, statut, date_envoi, clients(nom, email_contact, telephone, adresse)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!facture) notFound();
  const client = facture.clients as unknown as {
    nom: string;
    email_contact: string | null;
    telephone: string | null;
    adresse: string | null;
  } | null;

  // Lignes reconstituées depuis les temps rattachés, avec le taux D'AUJOURD'HUI (lu par le serveur, clé secrète)
  const calcul = await lignesDeFacture(facture.id);
  const { ecart, figeHt, figeTva, figeTtc } = ecartAvecFigé(calcul, facture);
  const configEmail = configurationEmail();

  const { data: temps } = await creerClientAdmin()
    .from("temps")
    .select("id, date_saisie, heures, commentaire, collaborateurs(prenom, nom), projets(nom)")
    .eq("facture_id", facture.id)
    .order("date_saisie");

  return (
    <section className="space-y-8">
      <div>
        <Link href="/finance" className="text-sm text-blue-700 underline">
          ← Retour à Finance
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-semibold">{facture.numero}</h1>
            <p className="text-slate-600">
              {client?.nom} — période du {formaterDate(facture.periode_debut)} au {formaterDate(facture.periode_fin)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!ecart && <BoutonsPdf id={facture.id} numero={facture.numero} />}
            <SelecteurStatutFacture id={facture.id} numero={facture.numero} statut={facture.statut as StatutFacture} />
          </div>
        </div>
        {generee === "1" && (
          <p
            role="status"
            className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
          >
            Facture <strong>{facture.numero}</strong> générée.
          </p>
        )}
      </div>

      <AlerteMentions />

      <BoutonEnvoyer
        factureId={facture.id}
        numero={facture.numero}
        emailClient={client?.email_contact ?? null}
        destinataireTest={configEmail.destinataireTest}
        bloque={
          configEmail.probleme ??
          (ecart ? "un taux horaire a changé depuis l'émission (voir l'alerte ci-dessous)." : null) ??
          (client?.email_contact ? null : "le client n'a pas d'email de contact.")
        }
      />

      <dl className="grid gap-x-8 gap-y-3 rounded-lg border border-slate-200 bg-white p-5 text-sm sm:grid-cols-3">
        <Info libelle="Client" valeur={client?.nom} />
        <Info libelle="Email du contact" valeur={client?.email_contact} />
        <Info libelle="Téléphone" valeur={client?.telephone} />
        <Info libelle="Date d'émission" valeur={formaterDate(facture.date_emission, { dateStyle: "long" })} />
        <Info libelle="Échéance" valeur={formaterDate(facture.date_echeance, { dateStyle: "long" })} />
        <Info
          libelle="Envoyée le"
          valeur={facture.date_envoi ? formaterDate(facture.date_envoi, { dateStyle: "long" }) : null}
        />
      </dl>

      {/* ── Montants FIGÉS à l'émission (ce qui fait foi) ── */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Montants de la facture</h2>
        <dl className="grid w-80 grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <dt className="text-slate-600">Total HT</dt>
          <dd className="text-right tabular-nums" data-testid="fige-ht">
            {formaterEuros(figeHt)}
          </dd>
          <dt className="text-slate-600">TVA 20 %</dt>
          <dd className="text-right tabular-nums" data-testid="fige-tva">
            {formaterEuros(figeTva)}
          </dd>
          <dt className="font-semibold">Total TTC</dt>
          <dd className="text-right font-semibold tabular-nums" data-testid="fige-ttc">
            {formaterEuros(figeTtc)}
          </dd>
        </dl>
      </div>

      {/* ── Lignes reconstituées + contrôle d'écart ── */}
      <div>
        <h2 className="mb-1 text-lg font-semibold">Lignes (reconstituées depuis les temps facturés)</h2>
        <p className="mb-3 text-sm text-slate-600">
          Il n&apos;y a pas de table de lignes : chaque ligne regroupe les temps rattachés par projet et par taux
          horaire actuel.
        </p>
        {ecart ? (
          <p
            role="alert"
            data-testid="alerte-ecart"
            className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            ⚠️ <strong>Écart détecté</strong> : avec les taux horaires d&apos;aujourd&apos;hui, le total HT serait de{" "}
            <strong>{formaterEuros(calcul.totalHt)}</strong> au lieu de <strong>{formaterEuros(figeHt)}</strong> figés à
            l&apos;émission. Un taux a changé depuis. Les montants figés font foi ; le PDF est bloqué tant que
            l&apos;écart existe.
          </p>
        ) : (
          <p
            data-testid="controle-ok"
            className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
          >
            ✓ Contrôle : les lignes recalculées avec les taux actuels correspondent exactement aux montants figés.
          </p>
        )}
        <TableauLignes calcul={calcul} />
      </div>

      {/* ── Temps rattachés ── */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">
          Temps facturés <span className="text-sm font-normal text-slate-500">({temps?.length ?? 0})</span>
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Collaborateur</th>
                <th className="px-4 py-2 text-left font-medium">Projet</th>
                <th className="px-4 py-2 text-right font-medium">Heures</th>
                <th className="px-4 py-2 text-left font-medium">Commentaire</th>
              </tr>
            </thead>
            <tbody>
              {(temps ?? []).map((t) => {
                const c = t.collaborateurs as unknown as { prenom: string | null; nom: string } | null;
                return (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 text-slate-700">{formaterDate(t.date_saisie)}</td>
                    <td className="px-4 py-2 text-slate-900">
                      {c ? [c.prenom, c.nom].filter(Boolean).join(" ") : "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-700">
                      {(t.projets as unknown as { nom: string } | null)?.nom}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formaterHeures(enCentiemes(t.heures))}</td>
                    <td className="px-4 py-2 text-slate-700">{t.commentaire ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Info({ libelle, valeur }: { libelle: string; valeur: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{libelle}</dt>
      <dd className="mt-0.5 text-slate-900">{valeur || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}
