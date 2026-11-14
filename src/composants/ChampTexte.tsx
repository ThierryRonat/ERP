type Proprietes = {
  libelle: string;
  nom: string;
  type?: string;
  autoComplete?: string;
  requis?: boolean;
};

export function ChampTexte({ libelle, nom, type = "text", autoComplete, requis = true }: Proprietes) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{libelle}</span>
      <input
        name={nom}
        type={type}
        autoComplete={autoComplete}
        required={requis}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}

export function MessageErreur({ texte }: { texte?: string }) {
  if (!texte) return null;
  return (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {texte}
    </p>
  );
}
