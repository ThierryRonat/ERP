// Test du MOTEUR de relances (src/lib/relances.ts), appelé directement.
//  A. Données IMITÉES (aucun accès réseau, aucun email) : client sans email, envoi raté, PDF bloqué, exception,
//     facture déjà relancée aujourd'hui → chaque facture a son résultat, les autres continuent ; journal APRÈS l'envoi.
//  B. Clé de service absente ou remplacée par la clé publique → ERREUR explicite (jamais « 0 facture » silencieux).
//  C. Sur la VRAIE base, avec une FAUSSE clé Resend : l'envoi échoue → rien n'est journalisé. Aucun email ne part.
//     (Prérequis : au moins une facture échue, voir « Rendre une facture échue » ou scripts/tester-relances.mjs.)
// Lancement :
//   npx --yes tsx --conditions=react-server --tsconfig tsconfig.json --env-file=.env.local scripts/tester-relances-moteur.mts

import { createClient } from "@supabase/supabase-js";
import { traiterRelances, type OutilsRelances } from "../src/lib/relances";
import { aujourdhuiParis, ajouterJours } from "../src/lib/dates";

let echecs = 0;
const verifier = (c: unknown, m: string) => {
  console.log(`${c ? "✅" : "❌"} ${m}`);
  if (!c) echecs++;
};

// ── A. Imitation de la base ──────────────────────────────────────────────────
const hier = ajouterJours(aujourdhuiParis(), -1);
const factures = [
  { id: "a", numero: "FAC-T-A", statut: "emise", date_echeance: hier, total_ttc: 100, clients: { nom: "Sans Email", email_contact: null } },
  { id: "b", numero: "FAC-T-B", statut: "envoyee", date_echeance: hier, total_ttc: 200, clients: { nom: "Bon Client", email_contact: "bon@exemple.test" } },
  { id: "c", numero: "FAC-T-C", statut: "emise", date_echeance: hier, total_ttc: 300, clients: { nom: "Envoi Rate", email_contact: "rate@exemple.test" } },
  { id: "d", numero: "FAC-T-D", statut: "emise", date_echeance: hier, total_ttc: 400, clients: { nom: "Deja Relance", email_contact: "deja@exemple.test" } },
  { id: "e", numero: "FAC-T-E", statut: "emise", date_echeance: hier, total_ttc: 500, clients: { nom: "Pdf Bloque", email_contact: "pdf@exemple.test" } },
  { id: "f", numero: "FAC-T-F", statut: "emise", date_echeance: hier, total_ttc: 600, clients: { nom: "Panne Brutale", email_contact: "panne@exemple.test" } },
];
function imitation() {
  const journal: string[] = []; // ordre des opérations
  const inserts: Record<string, unknown>[] = [];
  const relancesExistantes = [{ facture_id: "d", date_envoi: new Date().toISOString() }];
  const client = {
    from(table: string) {
      const q = {
        select: () => q,
        in: () => q,
        lt: () => q,
        gte: () => q,
        order: () => q,
        then: (ok: (v: unknown) => void) => ok({ data: table === "factures" ? factures : relancesExistantes, error: null }),
        insert: async (ligne: Record<string, unknown>) => {
          journal.push(`journal:${ligne.facture_id}`);
          inserts.push(ligne);
          return { error: null };
        },
      };
      return q;
    },
  } as unknown as NonNullable<OutilsRelances["client"]>;
  const outils: OutilsRelances = {
    client,
    pdf: (async (_s: unknown, id: string) =>
      id === "e"
        ? { ok: false, statut: 409, message: "Écart de taux : PDF bloqué" }
        : { ok: true, facture: {}, pdf: Buffer.from("%PDF") }) as unknown as OutilsRelances["pdf"],
    envoyer: (async (o: { a: string; sujet: string }) => {
      journal.push(`envoi:${o.sujet}`);
      if (o.sujet.includes("FAC-T-C")) return { ok: false, erreur: "Resend : boîte refusée" };
      if (o.sujet.includes("FAC-T-F")) throw new Error("coupure réseau imprévue");
      return { ok: true, id: "faux-id" };
    }) as unknown as OutilsRelances["envoyer"],
  };
  return { outils, journal, inserts };
}

console.log("\n── A. Données imitées (aucun email ne part) ──");
process.env.RESEND_API_KEY ||= "re_imitation"; // seule la forme compte ici, l'envoi est imité
const destinataireTest = process.env.EMAIL_DESTINATAIRE_TEST;
delete process.env.EMAIL_DESTINATAIRE_TEST; // vrai mode : vers l'adresse du client
{
  const { outils, journal, inserts } = imitation();
  const b = await traiterRelances({ origine: "essai" }, outils);
  const r = Object.fromEntries(b.details.map((d) => [d.numero, d]));
  verifier(b.facturesEchues === 6, `6 factures échues traitées (toutes, malgré les échecs) : ${b.facturesEchues}`);
  verifier(r["FAC-T-A"].resultat === "echec" && r["FAC-T-A"].motif.includes("n'a pas d'email"), `Client sans email → échec : « ${r["FAC-T-A"].motif} »`);
  verifier(r["FAC-T-B"].resultat === "envoyee" && r["FAC-T-B"].motif.includes("bon@exemple.test"), `Facture après le client sans email → envoyée : « ${r["FAC-T-B"].motif} »`);
  verifier(r["FAC-T-C"].resultat === "echec" && r["FAC-T-C"].motif.includes("refusée"), `Envoi raté → échec : « ${r["FAC-T-C"].motif} »`);
  verifier(r["FAC-T-D"].resultat === "ignoree" && r["FAC-T-D"].motif.startsWith("déjà relancée aujourd'hui"), `Déjà relancée aujourd'hui → ignorée : « ${r["FAC-T-D"].motif} »`);
  verifier(r["FAC-T-E"].resultat === "echec" && r["FAC-T-E"].motif.includes("PDF bloqué"), `PDF bloqué → échec : « ${r["FAC-T-E"].motif} »`);
  verifier(r["FAC-T-F"].resultat === "echec" && r["FAC-T-F"].motif.includes("coupure"), `Exception imprévue → échec pour CETTE facture seulement : « ${r["FAC-T-F"].motif} »`);
  verifier(inserts.length === 1 && inserts[0].facture_id === "b", `Journal : UNE seule ligne (la facture réellement envoyée) — ${inserts.length}`);
  verifier(inserts[0]?.canal === "email", `Canal « email » hors mode test : ${inserts[0]?.canal}`);
  const iEnvoi = journal.findIndex((x) => x.startsWith("envoi:") && x.includes("FAC-T-B"));
  verifier(iEnvoi >= 0 && journal.indexOf("journal:b") > iEnvoi, "Journal écrit APRÈS l'envoi réussi (ordre des opérations vérifié)");
  verifier(!journal.includes("journal:c") && !journal.includes("journal:f"), "Envoi raté ou interrompu → rien de journalisé");
  verifier(!journal.some((x) => x.includes("FAC-T-D")), "Déjà relancée → aucun envoi tenté");
}
{
  const { outils, inserts } = imitation();
  const b = await traiterRelances({ forcer: true, origine: "essai" }, outils);
  const d = b.details.find((x) => x.numero === "FAC-T-D")!;
  verifier(d.resultat === "envoyee" && String(inserts.find((i) => i.facture_id === "d")?.message).includes("FORCÉ"), "Forcé → la facture déjà relancée repart, journal marqué « FORCÉ »");
}
if (destinataireTest) process.env.EMAIL_DESTINATAIRE_TEST = destinataireTest;
{
  const { outils, inserts } = imitation();
  const b = await traiterRelances({ origine: "essai" }, outils);
  const B = b.details.find((x) => x.numero === "FAC-T-B")!;
  if (destinataireTest)
    verifier(
      B.motif.includes(destinataireTest) && inserts[0]?.canal === "email (test)" && b.modeTest === destinataireTest,
      `Mode test → envoi vers l'adresse de test, canal « email (test) » : « ${B.motif} »`,
    );
}

// ── B. Clé de service absente / clé publique ─────────────────────────────────
console.log("\n── B. Sans clé de service ──");
const vraie = process.env.SUPABASE_SERVICE_ROLE_KEY;
for (const [cas, valeur] of [
  ["clé de service ABSENTE", ""],
  ["clé PUBLIQUE à la place de la clé de service", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""],
]) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = valeur;
  try {
    const b = await traiterRelances({ origine: "essai" });
    verifier(false, `${cas} → réponse SILENCIEUSE (${b.facturesEchues} facture)`);
  } catch (e) {
    verifier(true, `${cas} → erreur explicite : « ${(e as Error).message} »`);
  }
}
process.env.SUPABASE_SERVICE_ROLE_KEY = vraie;

// ── C. Vraie base, fausse clé Resend : échec, rien de journalisé ─────────────
console.log("\n── C. Vraie base, fausse clé Resend ──");
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, vraie!, { auth: { persistSession: false } });
const nbRelances = async () => (await service.from("relances").select("id", { count: "exact", head: true })).count;
const avant = await nbRelances();
const vraieResend = process.env.RESEND_API_KEY;
process.env.RESEND_API_KEY = "re_FAUSSE_CLE_DE_TEST";
const b = await traiterRelances({ forcer: true, origine: "essai fausse clé" }); // forcé : pour passer l'anti-doublon
process.env.RESEND_API_KEY = vraieResend;
if (b.facturesEchues === 0) verifier(false, "Aucune facture échue sur la base : lancer d'abord scripts/tester-relances.mjs");
else {
  for (const d of b.details) console.log(`   ${d.numero} (${d.client}) → ${d.resultat} : ${d.motif}`);
  verifier(b.envoyees === 0 && b.echecs === b.facturesEchues, `Fausse clé → ${b.echecs} échec(s), 0 envoyée`);
  verifier((await nbRelances()) === avant, `Table relances inchangée (${avant} ligne(s)) : un envoi raté n'est JAMAIS journalisé`);
}

// ── D. L'adresse elle-même : clé de service ou jeton absents côté serveur → erreur explicite ──
console.log("\n── D. Adresse /api/relances mal configurée ──");
const { GET } = await import("../src/app/api/relances/route");
const jeton = process.env.RELANCES_SECRET!;
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
let rep = await GET(new Request(`http://local/api/relances?secret=${jeton}`));
verifier(rep.status === 503, `Clé de service absente → ${rep.status} : ${(await rep.json()).erreur}`);
process.env.SUPABASE_SERVICE_ROLE_KEY = vraie;
process.env.RELANCES_SECRET = "";
rep = await GET(new Request(`http://local/api/relances?secret=`));
verifier(rep.status === 500, `RELANCES_SECRET absent sur le serveur → ${rep.status} : ${(await rep.json()).erreur}`);
process.env.RELANCES_SECRET = jeton;

console.log(echecs ? `\n❌ ${echecs} contrôle(s) en échec` : "\n✅ Tous les contrôles du moteur sont passés");
process.exit(echecs ? 1 : 0);
