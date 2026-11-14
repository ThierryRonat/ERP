import "server-only";
import { randomInt } from "node:crypto";

// Sans caractères ambigus (0/O, 1/l/I) pour pouvoir être lu sans erreur.
const LETTRES = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const CHIFFRES = "23456789";
const SYMBOLES = "-_.!?";

/** Mot de passe provisoire aléatoire de 16 caractères (au moins un chiffre et un symbole). */
export function genererMotDePasseProvisoire(): string {
  const tous = LETTRES + CHIFFRES + SYMBOLES;
  const caracteres = [
    CHIFFRES[randomInt(CHIFFRES.length)],
    SYMBOLES[randomInt(SYMBOLES.length)],
    ...Array.from({ length: 14 }, () => tous[randomInt(tous.length)]),
  ];
  // Mélange (Fisher-Yates)
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres.join("");
}
