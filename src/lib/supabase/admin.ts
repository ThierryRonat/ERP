import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Client Supabase avec la clé SECRÈTE : contourne toutes les règles RLS.
 * À n'utiliser QUE dans des actions serveur qui ont déjà vérifié les droits.
 * "server-only" fait échouer la compilation si ce fichier est importé côté navigateur.
 */
export function creerClientAdmin() {
  const cleSecrete = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cleSecrete) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY manquante dans .env.local");
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, cleSecrete, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
