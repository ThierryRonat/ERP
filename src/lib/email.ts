import "server-only";
import { Resend } from "resend";

// Envoi d'emails par Resend. La clé RESEND_API_KEY est SECRÈTE (jamais NEXT_PUBLIC_, jamais commitée).
// Elle doit être présente dans .env.local ET dans les variables d'environnement de Vercel.

export type ConfigurationEmail = {
  pret: boolean;
  probleme: string | null;
  expediteur: string;
  destinataireTest: string | null; // mode test : tout part vers cette adresse, rien n'est marqué « envoyée »
};

export function configurationEmail(): ConfigurationEmail {
  const cle = process.env.RESEND_API_KEY?.trim() ?? "";
  const expediteur = process.env.EMAIL_EXPEDITEUR?.trim() || "onboarding@resend.dev";
  const destinataireTest = process.env.EMAIL_DESTINATAIRE_TEST?.trim() || null;
  let probleme: string | null = null;
  if (!cle || cle === "COLLER_ICI") probleme = "La clé RESEND_API_KEY n'est pas renseignée (.env.local / Vercel).";
  else if (!cle.startsWith("re_"))
    probleme = "La clé RESEND_API_KEY ne ressemble pas à une clé Resend (elle doit commencer par re_).";
  return { pret: !probleme, probleme, expediteur, destinataireTest };
}

export type PieceJointe = { nom: string; contenu: Buffer };

/** Envoie un email. Ne lève jamais d'exception : renvoie le résultat. */
export async function envoyerEmail(options: {
  a: string;
  sujet: string;
  texte: string;
  html: string;
  pieceJointe?: PieceJointe;
  repondreA?: string;
}): Promise<{ ok: true; id: string } | { ok: false; erreur: string }> {
  const config = configurationEmail();
  if (!config.pret) return { ok: false, erreur: config.probleme! };
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: config.expediteur,
      to: options.a,
      subject: options.sujet,
      text: options.texte,
      html: options.html,
      replyTo: options.repondreA,
      attachments: options.pieceJointe
        ? [{ filename: options.pieceJointe.nom, content: options.pieceJointe.contenu }]
        : undefined,
    });
    if (error || !data?.id) return { ok: false, erreur: traduire(error?.message ?? "réponse vide du fournisseur") };
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, erreur: traduire(e instanceof Error ? e.message : String(e)) };
  }
}

/** Messages Resend les plus courants, en français. */
function traduire(message: string): string {
  if (/only send testing emails to your own email|verify a domain/i.test(message))
    return "Resend refuse : sans domaine vérifié, il n'envoie qu'à l'adresse de votre compte Resend. Vérifiez mission-webdev.fr chez Resend, ou laissez le mode test activé.";
  if (/api key is invalid|invalid api key|unauthorized/i.test(message))
    return "Resend refuse la clé d'API (RESEND_API_KEY invalide ou révoquée).";
  if (/domain is not verified/i.test(message))
    return "Resend refuse l'expéditeur : son domaine n'est pas vérifié (EMAIL_EXPEDITEUR).";
  return `Envoi refusé par Resend : ${message}`;
}
