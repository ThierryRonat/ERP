"use client";

import { useActionState } from "react";
import { creerPremierCompte } from "@/lib/actions/inscription";
import { ETAT_INITIAL, LONGUEUR_MIN_MOT_DE_PASSE } from "@/lib/formulaires";
import { ChampTexte, MessageErreur } from "@/composants/ChampTexte";

export function FormulaireInscription() {
  const [etat, action, enCours] = useActionState(creerPremierCompte, ETAT_INITIAL);

  return (
    <form action={action} className="space-y-4">
      <ChampTexte libelle="Votre email" nom="email" type="email" autoComplete="email" />
      <ChampTexte
        libelle={`Mot de passe (${LONGUEUR_MIN_MOT_DE_PASSE} caractères minimum)`}
        nom="mot_de_passe"
        type="password"
        autoComplete="new-password"
      />
      <ChampTexte libelle="Confirmez le mot de passe" nom="confirmation" type="password" autoComplete="new-password" />
      <MessageErreur texte={etat.erreur} />
      <button
        type="submit"
        disabled={enCours}
        className="w-full rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-60"
      >
        {enCours ? "Création…" : "Créer mon compte administrateur"}
      </button>
    </form>
  );
}
