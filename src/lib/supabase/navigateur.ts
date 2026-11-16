"use client";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Client Supabase côté NAVIGATEUR (clé publique + cookie de session de l'utilisateur).
 * Sert uniquement à déposer les justificatifs directement dans le stockage : les règles du bucket
 * (« je ne dépose que dans mon dossier ») s'appliquent. Jamais de clé secrète ici.
 */
export function creerClientNavigateur() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
