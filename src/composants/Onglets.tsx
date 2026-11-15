import Link from "next/link";

export type DefinitionOnglet = { cle: string; libelle: string; nombre?: number };

/** Barre d'onglets pilotée par l'adresse (?onglet=…) : l'onglet reste ouvert si on recharge la page. */
export function Onglets({
  chemin,
  onglets,
  actif,
  libelle,
}: {
  chemin: string;
  onglets: DefinitionOnglet[];
  actif: string;
  libelle: string;
}) {
  return (
    <nav role="tablist" aria-label={libelle} className="flex gap-1 border-b border-slate-200">
      {onglets.map((o) => {
        const estActif = o.cle === actif;
        return (
          <Link
            key={o.cle}
            href={`${chemin}?onglet=${o.cle}`}
            role="tab"
            aria-selected={estActif}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              estActif
                ? "border-blue-700 text-blue-800"
                : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
            }`}
          >
            {o.libelle}
            {o.nombre !== undefined && (
              <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs ${estActif ? "bg-blue-100" : "bg-slate-100"}`}>
                {o.nombre}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
