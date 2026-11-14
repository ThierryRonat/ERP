import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Client Supabase « au nom de l'utilisateur connecté » (clé publique + cookie de session).
 * Toutes les règles RLS s'appliquent.
 */
export async function creerClientServeur() {
  const magasinCookies = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return magasinCookies.getAll();
        },
        setAll(cookiesAEcrire) {
          try {
            for (const { name, value, options } of cookiesAEcrire) {
              magasinCookies.set(name, value, options);
            }
          } catch {
            // Appelé depuis un composant serveur (lecture seule) : sans gravité,
            // le proxy rafraîchit la session à chaque requête.
          }
        },
      },
    },
  );
}
