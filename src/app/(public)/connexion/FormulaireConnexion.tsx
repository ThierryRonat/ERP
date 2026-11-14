"use client";

import { useActionState } from "react";
import { seConnecter } from "@/lib/actions/authentification";
import { ETAT_INITIAL } from "@/lib/formulaires";
import { ChampTexte, MessageErreur } from "@/composants/ChampTexte";

export function FormulaireConnexion({ suite }: { suite: string }) {
  const [etat, action, enCours] = useActionState(seConnecter, ETAT_INITIAL);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="suite" value={suite} />
      <ChampTexte libelle="Email" nom="email" type="email" autoComplete="email" />
      <ChampTexte libelle="Mot de passe" nom="mot_de_passe" type="password" autoComplete="current-password" />
      <MessageErreur texte={etat.erreur} />
      <button
        type="submit"
        disabled={enCours}
        className="w-full rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-60"
      >
        {enCours ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
