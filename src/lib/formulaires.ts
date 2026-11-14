// Types et constantes partagés par les formulaires (fichier ordinaire).

export type EtatFormulaire = {
  erreur?: string;
  succes?: string;
};

export const ETAT_INITIAL: EtatFormulaire = {};

export const LONGUEUR_MIN_MOT_DE_PASSE = 10;
