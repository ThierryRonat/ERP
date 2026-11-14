// Lit sur GitHub le verdict de l'intégration Supabase pour le dernier envoi sur main.
// Lancement : node scripts/verifier-deploiement.mjs [--attendre]
// Code de sortie : 0 = migrations appliquées, 1 = échec, 2 = pas encore de verdict.

import { execSync } from "node:child_process";

const DEPOT = "ThierryRonat/ERP";
const attendre = process.argv.includes("--attendre");
const local = execSync("git rev-parse HEAD").toString().trim();

async function verdict() {
  const r = await fetch(`https://api.github.com/repos/${DEPOT}/commits/main/check-suites`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!r.ok) return { etat: "inconnu", detail: `GitHub HTTP ${r.status}` };
  const { check_suites } = await r.json();
  const suite = check_suites.find((s) => s.app?.slug === "supabase");
  if (!suite) return { etat: "attente", detail: "Supabase n'a pas encore réagi" };
  if (suite.head_sha !== local) return { etat: "attente", detail: "le dernier enregistrement local n'est pas encore sur GitHub (Push origin ?)" };
  if (suite.status !== "completed") return { etat: "attente", detail: `déploiement en cours (${suite.status})` };
  return suite.conclusion === "success"
    ? { etat: "ok", detail: "migrations appliquées" }
    : { etat: "echec", detail: `déploiement en échec (${suite.conclusion}) : voir Supabase → Branches → View Logs` };
}

for (let essai = 0; ; essai++) {
  const v = await verdict();
  if (v.etat !== "attente" || !attendre || essai >= 30) {
    console.log({ ok: "✅", echec: "❌", attente: "⏳", inconnu: "❓" }[v.etat] + " Supabase : " + v.detail);
    process.exit(v.etat === "ok" ? 0 : v.etat === "echec" ? 1 : 2);
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
