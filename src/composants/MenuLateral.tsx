"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { EntreeMenu } from "@/lib/navigation";
import { seDeconnecter } from "@/lib/actions/authentification";

type Proprietes = {
  entrees: EntreeMenu[]; // déjà filtrées côté serveur selon le rôle
  email: string;
  libelleRole: string;
};

export function MenuLateral({ entrees, email, libelleRole }: Proprietes) {
  const cheminActuel = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="px-5 py-5 text-lg font-semibold text-slate-900">Mini-ERP</div>

      <nav className="flex-1 space-y-1 px-3">
        {entrees.map((entree) => {
          const actif =
            entree.chemin === "/" ? cheminActuel === "/" : cheminActuel.startsWith(entree.chemin);
          return (
            <Link
              key={entree.chemin}
              href={entree.chemin}
              className={`block rounded-md px-3 py-2 text-sm font-medium ${
                actif ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {entree.libelle}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 px-5 py-4">
        <p className="truncate text-sm font-medium text-slate-900" title={email}>
          {email}
        </p>
        <p className="mb-3 text-xs text-slate-500">Rôle : {libelleRole}</p>
        <form action={seDeconnecter}>
          <button type="submit" className="text-sm text-slate-600 underline hover:text-slate-900">
            Se déconnecter
          </button>
        </form>
      </div>
    </aside>
  );
}
