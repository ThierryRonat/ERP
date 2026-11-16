import { incoherencesMentions, mentionsManquantes } from "@/lib/entreprise";

/** Prévient tant que les mentions légales de src/lib/entreprise.ts sont incomplètes ou incohérentes. */
export function AlerteMentions() {
  const manquantes = mentionsManquantes();
  const incoherences = incoherencesMentions();
  if (manquantes.length === 0 && incoherences.length === 0) return null;
  return (
    <div
      role="alert"
      data-testid="alerte-mentions"
      className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      {manquantes.length > 0 && (
        <p>
          <strong>⚠️ Mentions légales incomplètes</strong> — vos factures afficheront « À RENSEIGNER » à la place de :{" "}
          <strong>{manquantes.join(", ")}</strong>.
        </p>
      )}
      {incoherences.length > 0 && (
        <p data-testid="alerte-incoherences">
          <strong>⚠️ Mentions légales incohérentes</strong> — {incoherences.join(" ; ")}.
        </p>
      )}
      <p className="mt-1">
        Elles se règlent dans le fichier <code className="rounded bg-amber-100 px-1">src/lib/entreprise.ts</code> :
        envoyez les corrections à Claude, il les y reportera.
      </p>
    </div>
  );
}

export function BoutonsPdf({ id, numero }: { id: string; numero: string }) {
  const style =
    "whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50";
  return (
    <div className="flex gap-2">
      <a
        href={`/finance/factures/${id}/pdf?mode=apercu`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Visualiser le PDF de ${numero}`}
        className={style}
      >
        👁 Visualiser
      </a>
      <a href={`/finance/factures/${id}/pdf`} download aria-label={`Télécharger le PDF de ${numero}`} className={style}>
        ⬇ Télécharger
      </a>
    </div>
  );
}
