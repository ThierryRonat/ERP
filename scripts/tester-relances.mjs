// Test RÉEL des relances, en contournant l'interface (serveur de dev, port 3000, ou URL_APP=<adresse>).
//  1. Mesure : la MÊME requête avec la clé publique (sans session / session non-admin) et avec la clé de service.
//  2. Adresse /api/relances : jamais redirigée, 401 sans jeton ou mauvais jeton, jeton en en-tête ET en ?secret=.
//  3. Anti-doublon : appels répétés → UNE relance par jour ; l'adresse ne peut jamais forcer.
//  4. Bloc admin : réservé à l'admin (actions appelées en direct), « Forcer » repart, « Rendre échue » contrôlé.
// ⚠️ Envoie de VRAIS emails, UNIQUEMENT vers EMAIL_DESTINATAIRE_TEST (refuse de tourner si le mode test est vide).
// ⚠️ La 1re fois, rend FAC-2026-0001 échue (échéance = hier) : changement réel accepté, sans retour automatique.
// Nettoyage : comptes et fiches jetables supprimés, relances créées par le test supprimées ; base comparée avant/après.
// Lancement : node --env-file=.env.local scripts/tester-relances.mjs

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node");

const URL_APP = process.env.URL_APP ?? "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET = process.env.RELANCES_SECRET;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options); // clé de SERVICE

if (!process.env.EMAIL_DESTINATAIRE_TEST?.trim()) {
  console.error("❌ EMAIL_DESTINATAIRE_TEST est vide : ce test enverrait des emails à de vrais clients. Arrêt.");
  process.exit(1);
}
if (!SECRET) {
  console.error("❌ RELANCES_SECRET absent de .env.local. Arrêt.");
  process.exit(1);
}

let echecs = 0;
const verifier = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) echecs++; };
const idActionDe = (nom) => {
  const manifeste = JSON.parse(readFileSync(".next/dev/server/server-reference-manifest.json", "utf8"));
  const trouve = Object.entries(manifeste.node).find(([, v]) => v.exportedName === nom);
  if (!trouve) throw new Error(`Action « ${nom} » inconnue du serveur (page pas encore compilée ?)`);
  return trouve[0];
};
async function idActionAvecCompilation(nom, cookie, chemin) {
  try { return idActionDe(nom); } catch {
    await fetch(URL_APP + chemin, { headers: { cookie }, redirect: "manual" });
    await new Promise((r) => setTimeout(r, 800));
    return idActionDe(nom);
  }
}
const comptes = [], fiches = [];
async function compte(role) {
  const { data: f } = await admin.from("collaborateurs").insert({ nom: `Relances-${role}`, prenom: "Jetable", taux_horaire: 0 }).select("id").single();
  fiches.push(f.id);
  const email = `jetable-rel-${role}-${Date.now()}-${randomBytes(3).toString("hex")}@exemple.test`;
  const password = randomBytes(18).toString("base64url");
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  comptes.push(data.user.id);
  await admin.from("profiles").update({ role, collaborateur_id: f.id }).eq("id", data.user.id);
  const jarre = new Map();
  const ssr = createServerClient(url, ANON, { cookies: {
    getAll: () => [...jarre].map(([name, value]) => ({ name, value })),
    setAll: (l) => l.forEach(({ name, value }) => (value ? jarre.set(name, value) : jarre.delete(name))),
  } });
  await ssr.auth.signInWithPassword({ email, password });
  const api = createClient(url, ANON, options);
  await api.auth.signInWithPassword({ email, password });
  return { cookie: [...jarre].map(([n, v]) => `${n}=${v}`).join("; "), api };
}
/** Appelle une action serveur en direct et renvoie son résultat ({ erreur | succes | bilan }). */
async function action(cookie, nom, ...args) {
  const corps = await encodeReply(args);
  const r = await fetch(URL_APP + "/finance", {
    method: "POST",
    headers: { cookie, "Next-Action": await idActionAvecCompilation(nom, cookie, "/finance"), Accept: "text/x-component",
      ...(typeof corps === "string" ? { "Content-Type": "text/plain;charset=UTF-8" } : {}) },
    body: corps, redirect: "manual",
  });
  const texte = await r.text();
  for (const ligne of texte.split("\n")) {
    const m = ligne.match(/^[0-9a-f]+:(\{.*\})$/);
    if (!m) continue;
    try { const o = JSON.parse(m[1]); if (o.erreur || o.succes || o.bilan) return o; } catch { /* ligne suivante */ }
  }
  return { brut: texte.slice(0, 300) };
}
async function appel(chemin, init = {}) {
  const r = await fetch(URL_APP + chemin, { redirect: "manual", ...init });
  let corps = null; try { corps = JSON.parse(await r.text()); } catch { /* pas du JSON */ }
  return { statut: r.status, vers: r.headers.get("location"), type: r.headers.get("content-type") ?? "", corps };
}
const ligneDe = (bilan, numero) => bilan?.details?.find((d) => d.numero === numero);
const idsRelances = async () => new Set(((await admin.from("relances").select("id")).data ?? []).map((r) => r.id));
const instantane = async () => {
  const t = await Promise.all(["clients", "collaborateurs", "relances"].map(async (n) => (await admin.from(n).select("*").order("id")).data));
  const f = (await admin.from("factures").select("*").order("id")).data.map(({ date_echeance, ...reste }) => reste); // échéance : changement accepté
  const p = (await admin.from("profiles").select("id", { count: "exact", head: true })).count;
  return JSON.stringify([t, f, p]);
};

const avant = await instantane();
const relancesAvant = await idsRelances();
const { data: fac } = await admin.from("factures").select("id, numero, statut, date_echeance").eq("numero", "FAC-2026-0001").single();
const aujourdhui = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

try {
  const C = await compte("collaborateur");
  const M = await compte("manager");
  const A = await compte("admin");

  // ── Bloc admin : droits ──
  console.log("\n── Bloc admin : réservé à l'admin (actions appelées en direct, sans l'écran) ──");
  for (const [qui, X] of [["Collaborateur", C], ["Manager", M]]) {
    for (const [nom, args] of [["testerRelance", []], ["forcerRelance", []], ["rendreFactureEchue", [fac.id]]]) {
      const r = await action(X.cookie, nom, ...args);
      verifier(r.erreur?.includes("réservée à l'administrateur"), `${qui} : ${nom} → refusé (« ${r.erreur ?? JSON.stringify(r)} »)`);
    }
  }
  verifier((await idsRelances()).size === relancesAvant.size, "Aucune relance créée par ces tentatives");
  let r = await action(A.cookie, "rendreFactureEchue", "pas-un-identifiant");
  verifier(r.erreur === "Choisissez une facture.", `Admin : identifiant invalide → refusé (« ${r.erreur} »)`);

  // ── Rendre FAC-2026-0001 échue (une seule fois) ──
  if (fac.date_echeance >= aujourdhui) {
    r = await action(A.cookie, "rendreFactureEchue", fac.id);
    verifier(r.succes?.includes("est maintenant échue"), `Admin : Rendre une facture échue → « ${r.succes ?? r.erreur} »`);
  } else console.log(`ℹ️  ${fac.numero} est déjà échue (échéance ${fac.date_echeance}) : pas de nouvelle modification`);
  const { data: facApres } = await admin.from("factures").select("statut, date_echeance").eq("id", fac.id).single();
  verifier(facApres.date_echeance < aujourdhui && ["emise", "envoyee"].includes(facApres.statut), `${fac.numero} : échéance ${facApres.date_echeance}, statut ${facApres.statut} → à relancer`);

  // ── 1. Mesure : même requête, trois clés ──
  console.log("\n── Mesure sur VOTRE base : factures échues à relancer, même requête ──");
  const requete = (client) => client.from("factures").select("numero").in("statut", ["emise", "envoyee"]).lt("date_echeance", aujourdhui);
  const sansSession = await requete(createClient(url, ANON, options));
  const sessionCollab = await requete(C.api);
  const service = await requete(admin);
  console.log(`   Clé PUBLIQUE, sans session (= le planificateur) : ${sansSession.error ? `ERREUR « ${sansSession.error.message} »` : `${sansSession.data.length} ligne(s)`}`);
  console.log(`   Clé PUBLIQUE, session d'un collaborateur         : ${sessionCollab.error ? `ERREUR « ${sessionCollab.error.message} »` : `${sessionCollab.data.length} ligne(s), sans aucune erreur`}`);
  console.log(`   Clé de SERVICE                                    : ${service.data?.length} ligne(s) (${service.data?.map((f) => f.numero).join(", ")})`);
  verifier(service.data?.length >= 1, "Clé de service : les factures échues sont visibles");
  verifier(sansSession.error || sansSession.data.length === 0, "Clé publique sans session : aucune facture visible");
  verifier(!sessionCollab.error && sessionCollab.data.length === 0, "Clé publique avec session non-admin : 0 ligne, SANS erreur (le « zéro silencieux »)");

  // ── 2. Adresse et jeton ──
  console.log("\n── Adresse /api/relances : jeton ──");
  for (const [cas, chemin, init] of [
    ["sans jeton", "/api/relances", {}],
    ["mauvais jeton en en-tête", "/api/relances", { headers: { Authorization: "Bearer " + "x".repeat(64) } }],
    ["mauvais ?secret=", "/api/relances?secret=" + "y".repeat(64), {}],
    ["jeton au mauvais format (Basic)", "/api/relances", { headers: { Authorization: "Basic " + SECRET } }],
    ["jeton tronqué", "/api/relances?secret=" + SECRET.slice(0, -1), {}],
  ]) {
    const x = await appel(chemin, init);
    verifier(x.statut === 401 && !x.vers && x.type.includes("json"), `${cas} → ${x.statut} JSON${x.vers ? ` (REDIRIGÉ vers ${x.vers})` : ", pas de redirection"} : « ${x.corps?.erreur} »`);
  }

  // ── 3. Anti-doublon : appels répétés ──
  console.log("\n── Anti-doublon : appels répétés (vrais emails vers l'adresse de test) ──");
  const n0 = (await idsRelances()).size;
  const a1 = await appel("/api/relances", { method: "POST", headers: { Authorization: `Bearer ${SECRET}` } });
  const l1 = ligneDe(a1.corps, fac.numero);
  verifier(a1.statut === 200 && l1, `Appel 1 (POST, jeton en en-tête) → ${a1.statut}, ${fac.numero} : ${l1?.resultat} — ${l1?.motif}`);
  const n1 = (await idsRelances()).size;
  verifier(l1?.resultat === "envoyee" ? n1 === n0 + 1 : l1?.resultat === "ignoree" && n1 === n0, `Journal : ${n1 - n0} ligne ajoutée (cohérent avec « ${l1?.resultat} »)`);
  const a2 = await appel(`/api/relances?secret=${SECRET}`);
  const l2 = ligneDe(a2.corps, fac.numero);
  verifier(a2.statut === 200 && l2?.resultat === "ignoree", `Appel 2 (GET, ?secret=) → ${a2.statut}, ${fac.numero} : ${l2?.resultat} — ${l2?.motif}`);
  const a3 = await appel(`/api/relances?secret=${SECRET}&forcer=true&force=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ forcer: true }) });
  const l3 = ligneDe(a3.corps, fac.numero);
  verifier(a3.statut === 200 && a3.corps.force === false && l3?.resultat === "ignoree", `Appel 3 avec forcer=true (paramètre ET corps) → force=${a3.corps?.force}, ${l3?.resultat} : l'adresse ne force JAMAIS`);
  const essais = await Promise.all([1, 2, 3].map(() => appel(`/api/relances?secret=${SECRET}`)));
  verifier(essais.every((e) => ligneDe(e.corps, fac.numero)?.resultat === "ignoree"), "3 appels supplémentaires simultanés → tous « ignorée »");
  verifier((await idsRelances()).size === n1, `Après 6 appels : toujours ${n1 - n0} relance(s) aujourd'hui pour ${fac.numero} — aucun harcèlement`);

  // ── 4. Bloc admin : tester / forcer ──
  console.log("\n── Bloc admin (compte admin jetable) ──");
  r = await action(A.cookie, "testerRelance");
  verifier(ligneDe(r.bilan, fac.numero)?.resultat === "ignoree" && r.bilan.force === false, `Tester la relance → ${ligneDe(r.bilan, fac.numero)?.resultat} (anti-doublon respecté)`);
  r = await action(A.cookie, "forcerRelance");
  const lf = ligneDe(r.bilan, fac.numero);
  verifier(r.bilan?.force === true && lf?.resultat === "envoyee", `Forcer l'envoi → ${lf?.resultat} — ${lf?.motif}`);
  const { data: forcee } = await admin.from("relances").select("canal, message").eq("facture_id", fac.id)
    .order("date_envoi", { ascending: false }).limit(1).single();
  verifier(forcee?.message.includes("FORCÉ") && forcee?.canal === "email (test)", `Journal de la relance forcée : [${forcee?.canal}] ${forcee?.message}`);
  verifier((await idsRelances()).size === n1 + 1, "Forcer a ajouté exactement 1 ligne au journal");
} finally {
  // ── Nettoyage ──
  const creees = [...(await idsRelances())].filter((id) => !relancesAvant.has(id));
  if (creees.length) await admin.from("relances").delete().in("id", creees);
  for (const id of comptes) { await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id); }
  if (fiches.length) await admin.from("collaborateurs").delete().in("id", fiches);
  console.log(`\nNettoyage : ${creees.length} relance(s) de test, ${comptes.length} compte(s), ${fiches.length} fiche(s) supprimés`);
  verifier(avant === (await instantane()), "Base identique avant / après (clients, collaborateurs, relances, profils, factures hors échéance)");
}
console.log(echecs ? `\n❌ ${echecs} contrôle(s) en échec` : "\n✅ Tous les contrôles sont passés");
process.exit(echecs ? 1 : 0);
