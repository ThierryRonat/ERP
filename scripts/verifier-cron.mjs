// Vérifie la tâche Supabase Cron « relances-factures » (clé de service → fonction etat_relances_cron()).
// Montre les derniers passages et les réponses de l'adresse /api/relances (code HTTP, début du bilan).
// --attendre : patiente (jusqu'à 7 min) qu'un passage ait eu lieu APRÈS le lancement du script.
// Lancement : node --env-file=.env.local scripts/verifier-cron.mjs [--attendre]

import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const attendre = process.argv.includes("--attendre");
const depart = new Date();
const heure = (iso) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" });

let etat;
for (let essai = 0; ; essai++) {
  const { data, error } = await admin.rpc("etat_relances_cron");
  if (error) {
    console.error(`❌ Lecture impossible : ${error.message} (migration relances_cron pas encore appliquée ?)`);
    process.exit(1);
  }
  etat = data;
  const recente = etat.reponses.find((r) => new Date(r.recue) > depart);
  if (!attendre || recente || essai >= 42) break;
  if (essai === 0) console.log(`⏳ Attente d'un passage de la tâche (toutes les 5 minutes)…`);
  await new Promise((r) => setTimeout(r, 10_000));
}

let echecs = 0;
const verifier = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) echecs++; };
verifier(etat.tache?.active && etat.tache?.frequence === "*/5 * * * *", `Tâche relances-factures : ${etat.tache ? `active=${etat.tache.active}, fréquence ${etat.tache.frequence}` : "ABSENTE"}`);
console.log("\nDerniers passages :");
for (const p of etat.passages.slice(0, 5)) console.log(`   ${heure(p.debut)}  ${p.statut}  ${p.message ?? ""}`);
console.log("\nDernières réponses de l'adresse :");
for (const r of etat.reponses.slice(0, 5)) {
  let resume = r.erreur ?? r.debut_reponse ?? "";
  try {
    const b = JSON.parse(r.debut_reponse);
    resume = b.erreur ? `erreur : ${b.erreur}` : `${b.facturesEchues} échue(s), ${b.envoyees} envoyée(s), ${b.ignorees} ignorée(s), ${b.echecs} échec(s) — origine ${b.origine}, force=${b.force}`;
  } catch { /* bilan tronqué : on garde le début */ resume = resume.replace(/\s+/g, " ").slice(0, 160); }
  console.log(`   ${heure(r.recue)}  HTTP ${r.code_http ?? "—"}${r.delai_depasse ? " (délai dépassé)" : ""}  ${resume}`);
}
const derniere = etat.reponses[0];
if (attendre) verifier(derniere && new Date(derniere.recue) > depart, "Un passage a eu lieu pendant l'attente");
verifier(derniere?.code_http === 200, `Dernière réponse : HTTP ${derniere?.code_http ?? "aucune"}${derniere?.code_http === 401 ? " → le jeton du Vault ne correspond pas à RELANCES_SECRET de Vercel" : ""}`);
verifier(etat.passages[0]?.statut === "succeeded", `Dernier passage : ${etat.passages[0]?.statut ?? "aucun"}`);
console.log(echecs ? `\n❌ ${echecs} contrôle(s) en échec` : "\n✅ La tâche tourne et l'adresse répond");
process.exit(echecs ? 1 : 0);
