// Types partagés de l'écran Utilisateurs (fichier ORDINAIRE, importable partout).

import type { Role } from "@/lib/roles";

export type Identifiants = {
  email: string;
  motDePasse: string;
};

export type ResultatAction = {
  erreur?: string;
  succes?: string;
  identifiants?: Identifiants; // mot de passe provisoire, affiché UNE fois puis oublié
};

export type FicheCollaborateur = {
  id: string;
  nom: string;
  prenom: string | null;
  email: string | null;
  poste: string | null;
};

export type CompteAcces = {
  id: string;
  email: string | null;
  role: Role;
  collaborateurId: string | null;
  derniereConnexion: string | null;
};
