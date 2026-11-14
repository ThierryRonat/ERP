// Fichier ORDINAIRE : les constantes partagées vivent ici, jamais dans un fichier "use server".

export type EntreeMenu = {
  libelle: string;
  chemin: string;
  adminSeulement: boolean;
};

// L'ordre du menu latéral.
export const ENTREES_MENU: EntreeMenu[] = [
  { libelle: "Accueil", chemin: "/", adminSeulement: false },
  { libelle: "Commercial", chemin: "/commercial", adminSeulement: false },
  { libelle: "RH", chemin: "/rh", adminSeulement: false },
  { libelle: "Finance", chemin: "/finance", adminSeulement: true },
  { libelle: "Absences", chemin: "/absences", adminSeulement: false },
  { libelle: "Utilisateurs", chemin: "/utilisateurs", adminSeulement: true },
];
