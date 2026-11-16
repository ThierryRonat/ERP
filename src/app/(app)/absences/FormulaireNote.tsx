"use client";

import { useRef, useState, useTransition } from "react";
import { creerNoteDeFrais } from "@/lib/actions/absences";
import { creerClientNavigateur } from "@/lib/supabase/navigateur";
import { BUCKET_JUSTIFICATIFS, CATEGORIES_NOTE, TAILLE_MAX_JUSTIFICATIF, TYPES_JUSTIFICATIF } from "@/lib/absences";
import { ETAT_INITIAL, type EtatFormulaire } from "@/lib/formulaires";

const champ = "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

/**
 * 1) La photo part DIRECTEMENT du navigateur vers le stockage, dans justificatifs/<mon id>/… :
 *    les règles du bucket n'autorisent que mon propre dossier.
 * 2) Le serveur enregistre la note avec le CHEMIN du fichier (jamais une adresse signée).
 */
export function FormulaireNote({ collaborateurId, aujourdhui }: { collaborateurId: string; aujourdhui: string }) {
  const [etat, setEtat] = useState<EtatFormulaire>(ETAT_INITIAL);
  const [enCours, demarrer] = useTransition();
  const formulaire = useRef<HTMLFormElement>(null);

  function envoyer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const donnees = new FormData(e.currentTarget);
    const fichier = donnees.get("photo") as File | null;
    if (!fichier || fichier.size === 0) return setEtat({ erreur: "Ajoutez la photo du justificatif." });
    if (!TYPES_JUSTIFICATIF.includes(fichier.type))
      return setEtat({ erreur: "Le justificatif doit être une photo (JPEG, PNG, WebP, HEIC) ou un PDF." });
    if (fichier.size > TAILLE_MAX_JUSTIFICATIF) return setEtat({ erreur: "Justificatif trop lourd (10 Mo maximum)." });

    setEtat(ETAT_INITIAL);
    demarrer(async () => {
      const chemin = `${collaborateurId}/${crypto.randomUUID()}.${EXTENSIONS[fichier.type]}`;
      const { error } = await creerClientNavigateur()
        .storage.from(BUCKET_JUSTIFICATIFS)
        .upload(chemin, fichier, { contentType: fichier.type, upsert: false });
      if (error) return setEtat({ erreur: `Dépôt du justificatif impossible : ${error.message}` });

      donnees.delete("photo");
      donnees.set("justificatif", chemin);
      const resultat = await creerNoteDeFrais(ETAT_INITIAL, donnees);
      setEtat(resultat);
      if (resultat.succes) formulaire.current?.reset();
    });
  }

  return (
    <form ref={formulaire} onSubmit={envoyer} className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 font-semibold">Nouvelle note de frais</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Date de la dépense *</span>
          <input
            name="date_depense"
            type="date"
            required
            defaultValue={aujourdhui}
            max={aujourdhui}
            className={champ}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Montant TTC (€) *</span>
          <input name="montant" inputMode="decimal" required placeholder="ex. 42,50" className={champ} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Catégorie *</span>
          <select name="categorie" required defaultValue="" className={champ}>
            <option value="" disabled>
              — Choisir —
            </option>
            {CATEGORIES_NOTE.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Justificatif (photo ou PDF, 10 Mo max) *</span>
          <input
            name="photo"
            type="file"
            required
            accept={TYPES_JUSTIFICATIF.join(",")}
            capture="environment"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5"
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={enCours}
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
        >
          {enCours ? "Envoi…" : "Enregistrer la note"}
        </button>
        {etat.erreur && (
          <p role="alert" className="text-sm text-red-700">
            {etat.erreur}
          </p>
        )}
        {etat.succes && (
          <p role="status" className="text-sm text-green-700">
            {etat.succes}
          </p>
        )}
      </div>
    </form>
  );
}
