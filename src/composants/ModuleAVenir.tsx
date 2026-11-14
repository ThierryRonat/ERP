export function ModuleAVenir({ titre, description }: { titre: string; description: string }) {
  return (
    <section>
      <h1 className="mb-2 text-2xl font-semibold">{titre}</h1>
      <p className="text-slate-600">{description}</p>
      <p className="mt-6 inline-block rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
        Module à venir.
      </p>
    </section>
  );
}
