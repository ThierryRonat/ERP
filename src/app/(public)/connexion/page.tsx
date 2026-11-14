import { FormulaireConnexion } from "./FormulaireConnexion";

export default async function PageConnexion({ searchParams }: PageProps<"/connexion">) {
  const { suite } = await searchParams;
  const cheminSuite = typeof suite === "string" ? suite : "/";

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">Mini-ERP</h1>
        <p className="mb-6 text-sm text-slate-600">Connectez-vous pour continuer.</p>
        <FormulaireConnexion suite={cheminSuite} />
      </div>
    </main>
  );
}
