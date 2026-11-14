import { creerClientServeur } from "@/lib/supabase/serveur";

// Liste des fiches collaborateurs, lue avec la session de la personne connectée :
// ce sont les règles RLS de Supabase (et non l'écran) qui décident de ce qui s'affiche.
export default async function PageRH() {
  const supabase = await creerClientServeur();
  const { data: fiches, error } = await supabase
    .from("collaborateurs")
    .select("id, prenom, nom, email, poste, date_entree")
    .order("nom");

  return (
    <section>
      <h1 className="mb-1 text-2xl font-semibold">RH</h1>
      <p className="mb-6 text-slate-600">Collaborateurs, temps passés et notes de frais (module à venir).</p>

      <h2 className="mb-2 text-lg font-semibold">
        Fiches collaborateurs visibles : <span data-testid="nombre-fiches">{fiches?.length ?? 0}</span>
      </h2>
      {error && (
        <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Lecture impossible : {error.message}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Nom</th>
              <th className="px-4 py-3 font-medium">Poste</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Entrée</th>
            </tr>
          </thead>
          <tbody>
            {(fiches ?? []).map((f) => (
              <tr key={f.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-medium text-slate-900">{[f.prenom, f.nom].filter(Boolean).join(" ")}</td>
                <td className="px-4 py-3 text-slate-700">{f.poste ?? "—"}</td>
                <td className="px-4 py-3 text-slate-700">{f.email ?? "—"}</td>
                <td className="px-4 py-3 text-slate-700">
                  {f.date_entree ? new Date(f.date_entree).toLocaleDateString("fr-FR") : "—"}
                </td>
              </tr>
            ))}
            {fiches?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  Aucune fiche visible.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
