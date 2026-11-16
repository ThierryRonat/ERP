import { timingSafeEqual } from "node:crypto";
import { ErreurConfigurationRelances, traiterRelances } from "@/lib/relances";

// Adresse appelée depuis l'EXTÉRIEUR (Supabase Cron) : aucune session, protégée par un jeton secret.
//   POST|GET /api/relances   avec   Authorization: Bearer <RELANCES_SECRET>   OU   ?secret=<RELANCES_SECRET>
// Elle ne peut JAMAIS forcer : l'anti-doublon s'applique toujours (le forçage n'existe que dans le bloc admin).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(statut: number, corps: unknown) {
  return new Response(JSON.stringify(corps, null, 2), {
    status: statut,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function jetonValide(fourni: string | null, attendu: string): boolean {
  if (!fourni) return false;
  const a = Buffer.from(fourni);
  const b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b); // comparaison à temps constant
}

async function traiter(requete: Request) {
  const attendu = process.env.RELANCES_SECRET?.trim();
  if (!attendu || attendu.length < 32) {
    return json(500, { erreur: "RELANCES_SECRET absent ou trop court côté serveur : relances désactivées." });
  }

  const enTete = requete.headers.get("authorization");
  const viaEnTete = enTete?.toLowerCase().startsWith("bearer ") ? enTete.slice(7).trim() : null;
  const viaParametre = new URL(requete.url).searchParams.get("secret");
  if (!jetonValide(viaEnTete, attendu) && !jetonValide(viaParametre, attendu)) {
    return json(401, { erreur: "Jeton absent ou invalide." });
  }

  try {
    const bilan = await traiterRelances({ forcer: false, origine: "planificateur" }); // jamais forcé ici
    return json(200, bilan);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Erreur EXPLICITE (jamais un « 0 facture » silencieux)
    return json(e instanceof ErreurConfigurationRelances ? 503 : 500, { erreur: message });
  }
}

export const GET = traiter;
export const POST = traiter;
