// Test RÉEL des congés en CONTOURNANT l'interface : actions serveur appelées en direct (deux fois de suite,
// puis deux fois EN MÊME TEMPS), API attaquée, clé secrète contre le déclencheur. Données jetables ;
// base identique avant/après.
// Lancement : node --env-file=.env.local scripts/tester-conges.mjs

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node");

const URL_APP = process.env.URL_APP ?? "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);

let echecs = 0;
const verifier = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) echecs++; };
const idActionDe = (nom) => {
  const m = JSON.parse(readFileSync(".next/dev/server/server-reference-manifest.json", "utf8"));
  const t = Object.entries(m.node).find(([, v]) => v.exportedName === nom);
  if (!t) throw new Error(`Action « ${nom} » inconnue (page pas encore compilée ?)`);
  return t[0];
};
const comptes = [], fiches = [];

async function compte(role, nomFiche, solde = 25) {
  const { data: f } = await admin.from("collaborateurs").insert({ nom: nomFiche, prenom: "Jetable", taux_horaire: 0, solde_conges: solde }).select("id").single();
  fiches.push(f.id);
  const email = `jetable-conge-${role}-${Date.now()}-${randomBytes(3).toString("hex")}@exemple.test`;
  const password = randomBytes(18).toString("base64url");
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  comptes.push(data.user.id);
  await admin.from("profiles").update({ role, collaborateur_id: f.id }).eq("id", data.user.id);
  const jarre = new Map();
  const ssr = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...jarre].map(([name, value]) => ({ name, value })),
      setAll: (l) => l.forEach(({ name, value }) => (value ? jarre.set(name, value) : jarre.delete(name))),
    },
  });
  await ssr.auth.signInWithPassword({ email, password });
  const api = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
  await api.auth.signInWithPassword({ email, password });
  return { fiche: f.id, cookie: [...jarre].map(([n, v]) => `${n}=${v}`).join("; "), api };
}
async function action(cookie, nom, ...args) {
  const corps = await encodeReply(args);
  const r = await fetch(`${URL_APP}/absences`, {
    method: "POST",
    headers: { cookie, "Next-Action": idActionDe(nom), Accept: "text/x-component",
      ...(typeof corps === "string" ? { "Content-Type": "text/plain;charset=UTF-8" } : {}) },
    body: corps,
  });
  return await r.text();
}
const formulaire = (champs) => { const f = new FormData(); for (const [k, v] of Object.entries(champs)) f.set(k, v); return f; };
const solde = async (fiche) => Number((await admin.from("collaborateurs").select("solde_conges").eq("id", fiche).single()).data.solde_conges);
const statut = async (id) => (await admin.from("conges").select("statut").eq("id", id).single()).data.statut;
const congeDe = async (fiche, debut) => (await admin.from("conges").select("id").eq("collaborateur_id", fiche).eq("date_debut", debut).single()).data.id;
const instantane = async () => JSON.stringify(await Promise.all([
  admin.from("conges").select("*").order("id").then((r) => r.data),
  admin.from("collaborateurs").select("id, solde_conges").order("id").then((r) => r.data),
]));

const avant = await instantane();
try {
  const A = await compte("collaborateur", "Conge-A", 10);
  const M = await compte("manager", "Conge-M", 25);
  const Ad = await compte("admin", "Conge-Admin", 25);
  await fetch(`${URL_APP}/absences`, { headers: { cookie: M.cookie } }); // compile la page et ses actions

  // ── Demandes de A ──
  const demande = (debut, fin, nb, type = "conges_payes") =>
    action(A.cookie, "demanderConge", {}, formulaire({ type, date_debut: debut, date_fin: fin, nb_jours: nb, motif: "test" }));
  let r = await demande("2031-07-01", "2031-07-03", "3");
  verifier(r.includes("Demande de congé envoyée"), "A : demande de 3 jours de congés payés envoyée");
  r = await demande("2031-07-01", "2031-07-03", "5");
  verifier(r.includes("impossible"), "A : 5 jours sur une période de 3 jours → refusé");
  r = await demande("2031-07-01", "2031-07-03", "0,3");
  verifier(r.includes("demi-journées"), "A : 0,3 jour → refusé (demi-journées seulement)");
  r = await demande("2031-07-05", "2031-07-01", "1");
  verifier(r.includes("postérieure"), "A : date de fin avant la date de début → refusé");
  await demande("2031-08-04", "2031-08-08", "2,5");
  await demande("2031-09-01", "2031-09-30", "20", "rtt");
  await demande("2031-10-01", "2031-10-02", "2", "sans_solde");
  const c1 = await congeDe(A.fiche, "2031-07-01"), c2 = await congeDe(A.fiche, "2031-08-04");
  const cRtt = await congeDe(A.fiche, "2031-09-01"), cSs = await congeDe(A.fiche, "2031-10-01");

  // ── A essaie de tricher ──
  r = await action(A.cookie, "validerConge", c1);
  verifier(r.includes("réservée aux managers") && (await statut(c1)) === "demandee", "A : action validerConge en direct → refusée");
  let e = await A.api.rpc("valider_conge", { p_conge_id: c1 });
  verifier(Boolean(e.error), "A : valider_conge via l'API → refusé par la base");
  e = await A.api.from("conges").update({ statut: "validee" }).eq("id", c1);
  verifier(Boolean(e.error), "A : passer son congé à « validée » directement via l'API → refusé");
  e = await A.api.from("conges").insert({ collaborateur_id: M.fiche, type: "rtt", date_debut: "2031-07-01", date_fin: "2031-07-01", nb_jours: 1 });
  verifier(Boolean(e.error), "A : créer un congé au nom d'un autre → refusé");

  // ── PREUVE 1 : l'action appelée DEUX FOIS DE SUITE ──
  const s0 = await solde(A.fiche);
  const r1 = await action(M.cookie, "validerConge", c1);
  const r2 = await action(M.cookie, "validerConge", c1);
  verifier(r1.includes("Congé validé") && r2.includes("déjà validé"), "Manager : 1er appel « Congé validé », 2e appel « déjà validé »");
  verifier((await solde(A.fiche)) === s0 - 3, `Deux appels de suite → solde ${s0} → ${await solde(A.fiche)} : décompté UNE seule fois (−3)`);

  // ── PREUVE 2 : deux appels EN MÊME TEMPS (vrai double-clic, sans l'interface) ──
  const s1 = await solde(A.fiche);
  const [p1, p2] = await Promise.all([action(M.cookie, "validerConge", c2), action(M.cookie, "validerConge", c2)]);
  const reussis = [p1, p2].filter((x) => x.includes("Congé validé")).length;
  verifier(reussis === 1, `Deux appels simultanés → ${reussis} seul a validé, l'autre a répondu « déjà validé »`);
  verifier((await solde(A.fiche)) === s1 - 2.5, `Deux appels simultanés → solde ${s1} → ${await solde(A.fiche)} : décompté UNE seule fois (−2,5)`);

  // ── Un congé validé ne peut plus être refusé ──
  const s2 = await solde(A.fiche);
  r = await action(M.cookie, "refuserConge", c1);
  verifier(r.includes("ne peut plus être refusé") && (await statut(c1)) === "validee", "Manager : refuser un congé validé → refusé, statut inchangé");
  e = await admin.from("conges").update({ statut: "refusee" }).eq("id", c1);
  verifier(Boolean(e.error), "Clé secrète : repasser un congé validé en « refusée » → refusé par le déclencheur");
  e = await admin.from("conges").update({ nb_jours: 1 }).eq("id", c1);
  verifier(Boolean(e.error), "Clé secrète : modifier le nombre de jours d'un congé validé → refusé");
  verifier((await solde(A.fiche)) === s2, "Solde inchangé après ces tentatives");

  // ── Solde insuffisant, sans solde ──
  r = await action(M.cookie, "validerConge", cRtt);
  verifier(r.includes("Solde insuffisant") && (await statut(cRtt)) === "demandee" && (await solde(A.fiche)) === s2, `RTT de 20 jours avec ${s2} jours de solde → refusé, rien n'a bougé`);
  r = await action(M.cookie, "validerConge", cSs);
  verifier(r.includes("Congé validé") && (await solde(A.fiche)) === s2, "Sans solde validé → solde inchangé");

  // ── Sa propre demande ──
  const demandeDe = (C, debut) => action(C.cookie, "demanderConge", {}, formulaire({ type: "rtt", date_debut: debut, date_fin: debut, nb_jours: "1" }));
  await demandeDe(M, "2031-11-03");
  const cM = await congeDe(M.fiche, "2031-11-03");
  r = await action(M.cookie, "validerConge", cM);
  verifier(r.includes("propre demande") && (await statut(cM)) === "demandee", "Manager : valider SA propre demande → refusé");
  await demandeDe(Ad, "2031-11-04");
  const cAd = await congeDe(Ad.fiche, "2031-11-04");
  r = await action(Ad.cookie, "validerConge", cAd);
  verifier(r.includes("Congé validé"), "Admin : peut valider sa propre demande (sinon personne ne le pourrait)");

  // ── PGRST201 : conges pointe deux fois vers collaborateurs ──
  e = await M.api.from("conges").select("id, collaborateurs(nom)").limit(1);
  verifier(e.error?.code === "PGRST201", `Sans préciser la colonne → erreur ${e.error?.code} (la base ne sait pas quel lien suivre)`);
  e = await M.api.from("conges").select("id, demandeur:collaborateurs!collaborateur_id(nom), validateur:collaborateurs!valide_par(nom)").eq("id", c1).single();
  verifier(!e.error && e.data.demandeur?.nom === "Conge-A" && e.data.validateur?.nom === "Conge-M", "En précisant collaborateur_id / valide_par → demandeur Conge-A, validé par Conge-M");

  // ── Visibilité et affichage ──
  const vusA = (await A.api.from("conges").select("collaborateur_id")).data ?? [];
  verifier(vusA.length > 0 && vusA.every((c) => c.collaborateur_id === A.fiche), "A ne voit que SES congés");
  const ficheA = await (await fetch(`${URL_APP}/rh/collaborateurs/${A.fiche}`, { headers: { cookie: A.cookie } })).text();
  const soldeAffiche = (ficheA.match(/data-testid="solde-conges"[^>]*>([^<]*)</) ?? [])[1];
  verifier(soldeAffiche === String(s2).replace(".", ","), `Fiche de A : solde affiché ${soldeAffiche} (stocké en base : ${s2})`);
  verifier((ficheA.match(/data-testid="conge-valide"/g) ?? []).length === 3, "Fiche de A : historique = ses 3 congés validés");
} finally {
  if (fiches.length) await admin.from("conges").delete().in("collaborateur_id", fiches);
  for (const id of comptes) { await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id); }
  if (fiches.length) await admin.from("collaborateurs").delete().in("id", fiches);
  verifier(avant === (await instantane()), "Base identique avant / après (congés et soldes)");
}
process.exit(echecs ? 1 : 0);
