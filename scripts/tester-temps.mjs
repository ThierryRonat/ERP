// Test RÉEL de la saisie des temps en CONTOURNANT l'interface (actions en direct + API Supabase).
// Ne travaille QUE sur des données jetables qu'il crée (fiches, projets, comptes) et vérifie que la base
// est identique avant et après.
// Prérequis : serveur de dev (port 3000), page /rh déjà compilée.
// Lancement : node --env-file=.env.local scripts/tester-temps.mjs

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node");

const URL_APP = "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);

let echecs = 0;
const verifier = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) echecs++; };

const manifeste = JSON.parse(readFileSync(".next/dev/server/server-reference-manifest.json", "utf8"));
const idAction = Object.fromEntries(Object.entries(manifeste.node).map(([id, v]) => [v.exportedName, id]));

const comptes = [], fiches = [], projets = [];

async function compte(role, collaborateurId) {
  const email = `jetable-temps-${role}-${Date.now()}-${randomBytes(3).toString("hex")}@exemple.test`;
  const password = randomBytes(18).toString("base64url");
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  comptes.push(data.user.id);
  await admin.from("profiles").update({ role, collaborateur_id: collaborateurId }).eq("id", data.user.id);
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
  return { cookie: [...jarre].map(([n, v]) => `${n}=${v}`).join("; "), api };
}
async function action(cookie, nom, ...args) {
  const corps = await encodeReply(args);
  const r = await fetch(`${URL_APP}/rh?onglet=temps`, {
    method: "POST",
    headers: { cookie, "Next-Action": idAction[nom], Accept: "text/x-component",
      ...(typeof corps === "string" ? { "Content-Type": "text/plain;charset=UTF-8" } : {}) },
    body: corps,
  });
  return await r.text();
}
const page = async (cookie) => (await fetch(`${URL_APP}/rh?onglet=temps`, { headers: { cookie } })).text();
const formulaire = (champs) => { const f = new FormData(); for (const [k, v] of Object.entries(champs)) f.set(k, v); return f; };
const tempsDe = async (ficheId) => (await admin.from("temps").select("id, projet_id, heures, statut").eq("collaborateur_id", ficheId)).data;
const instantane = async () => JSON.stringify(await Promise.all(["temps", "projets", "collaborateurs", "clients"].map(
  async (t) => (await admin.from(t).select("id").order("id")).data.map((x) => x.id))));

const avant = await instantane();
const AUJ = new Date().toISOString().slice(0, 10);

try {
  // ── Données jetables ──
  const creerFiche = async (nom) => { const { data } = await admin.from("collaborateurs").insert({ nom, prenom: "Jetable", taux_horaire: 0 }).select("id").single(); fiches.push(data.id); return data.id; };
  const fA = await creerFiche("Temps-A"), fB = await creerFiche("Temps-B"), fM = await creerFiche("Temps-Manager");
  const creerProjet = async (nom, statut) => { const { data } = await admin.from("projets").insert({ nom, statut }).select("id").single(); projets.push(data.id); return data.id; };
  const pOuvert = await creerProjet("Projet jetable ouvert", "en_cours");
  const pTermine = await creerProjet("Projet jetable terminé", "termine");

  const A = await compte("collaborateur", fA);
  const B = await compte("collaborateur", fB);
  const M = await compte("manager", fM);

  // ── Listes déroulantes = règle d'insertion ──
  const html = await page(A.cookie);
  const select = (nom) => (html.match(new RegExp(`<select name="${nom}"[\\s\\S]*?</select>`)) ?? [""])[0];
  const optionsCollab = [...select("collaborateur_id").matchAll(/value="([0-9a-f-]{36})"/g)].map((m) => m[1]);
  const optionsProjet = [...select("projet_id").matchAll(/value="([0-9a-f-]{36})"/g)].map((m) => m[1]);
  verifier(optionsCollab.length === 1 && optionsCollab[0] === fA, "Liste « collaborateur » = uniquement soi-même");
  verifier(optionsProjet.includes(pOuvert) && !optionsProjet.includes(pTermine), "Liste « projet » = projets en cours seulement (le terminé n'est pas proposé)");
  verifier(select("statut").includes('value="soumis"') && !select("statut").includes('value="valide"'), "Liste « statut » à la saisie = brouillon / soumis (pas validé)");

  // ── Saisies via l'action ──
  let r = await action(A.cookie, "saisirTemps", {}, formulaire({ collaborateur_id: fA, projet_id: pOuvert, date_saisie: AUJ, heures: "7,5", commentaire: "ok", statut: "brouillon" }));
  let mes = await tempsDe(fA);
  verifier(mes.length === 1 && mes[0].projet_id === pOuvert && Number(mes[0].heures) === 7.5, "Saisie valide → enregistrée sur le BON projet et le BON collaborateur (7,5 h)");
  const tA = mes[0].id;

  const refus = async (champs, attendu, libelle) => {
    const n = (await tempsDe(fA)).length + (await tempsDe(fB)).length;
    const rep = await action(A.cookie, "saisirTemps", {}, formulaire({ collaborateur_id: fA, projet_id: pOuvert, date_saisie: AUJ, heures: "1", statut: "brouillon", ...champs }));
    const n2 = (await tempsDe(fA)).length + (await tempsDe(fB)).length;
    verifier(rep.includes(attendu) && n === n2, libelle);
  };
  await refus({ collaborateur_id: fB }, "propres temps", "Action en direct : saisir au nom d'un autre → refusé, rien enregistré");
  await refus({ statut: "valide" }, "Brouillon", "Action en direct : saisir directement « validé » → refusé");
  await refus({ heures: "" }, "obligatoire", "Heures vides → message clair, rien enregistré");
  await refus({ heures: "0" }, "invalide", "0 heure → refusé");
  await refus({ heures: "25" }, "invalide", "25 heures → refusé");
  await refus({ heures: "abc" }, "invalide", "« abc » heures → refusé");
  await refus({ projet_id: pTermine }, "plus en cours", "Projet terminé (action en direct) → refusé PAR LA BASE");

  // ── Attaques directes de l'API ──
  let e = await A.api.from("temps").insert({ collaborateur_id: fB, projet_id: pOuvert, heures: 1 });
  verifier(Boolean(e.error), "API : saisir au nom d'un autre → refusé");
  e = await A.api.from("temps").insert({ collaborateur_id: fA, projet_id: pOuvert, heures: 1, statut: "valide" });
  verifier(Boolean(e.error), "API : saisir directement « validé » → refusé");
  e = await A.api.from("temps").insert({ collaborateur_id: fA, projet_id: pTermine, heures: 1 });
  verifier(Boolean(e.error), "API : saisir sur un projet terminé → refusé");
  e = await A.api.from("temps").update({ facture_id: null }).eq("id", tA);
  verifier(Boolean(e.error), "API : écrire temps.facture_id → refusé");
  e = await A.api.from("temps").update({ collaborateur_id: fB }).eq("id", tA);
  verifier(Boolean(e.error), "API : réattribuer un temps à un autre collaborateur → refusé");
  e = await A.api.from("temps").update({ statut: "valide" }).eq("id", tA).select("id");
  verifier(Boolean(e.error) || (e.data?.length ?? 0) === 0, "API : valider son propre temps → refusé");

  // ── Visibilité ──
  await B.api.from("temps").insert({ collaborateur_id: fB, projet_id: pOuvert, heures: 2 });
  const vusA = (await A.api.from("temps").select("collaborateur_id")).data ?? [];
  verifier(vusA.length === 1 && vusA.every((t) => t.collaborateur_id === fA), "Collaborateur A ne voit QUE ses temps (pas ceux de B)");
  const vusM = (await M.api.from("temps").select("collaborateur_id")).data ?? [];
  const total = (await admin.from("temps").select("id", { count: "exact", head: true })).count;
  verifier(vusM.length === total, `Manager : voit TOUS les temps (${vusM.length} sur ${total})`);

  // ── Statuts ──
  r = await action(A.cookie, "changerStatutTemps", tA, "soumis");
  verifier((await tempsDe(fA))[0].statut === "soumis", "Auteur : passe son temps en « soumis » → OK");
  r = await action(A.cookie, "changerStatutTemps", tA, "valide");
  verifier(r.includes("Seuls un manager") && (await tempsDe(fA))[0].statut === "soumis", "Auteur : se valider lui-même (action en direct) → refusé");
  r = await action(M.cookie, "saisirTemps", {}, formulaire({ collaborateur_id: fA, projet_id: pOuvert, date_saisie: AUJ, heures: "1", statut: "brouillon" }));
  verifier(r.includes("propres temps") && (await tempsDe(fA)).length === 1, "Manager : saisir AU NOM de A → refusé (chacun saisit les siens)");
  r = await action(M.cookie, "changerStatutTemps", tA, "valide");
  verifier((await tempsDe(fA))[0].statut === "valide", "Manager : valide le temps de A → OK");
  r = await action(A.cookie, "changerStatutTemps", tA, "brouillon");
  verifier(r.includes("déjà validé") && (await tempsDe(fA))[0].statut === "valide", "Auteur : modifier un temps validé → refusé");
  r = await action(A.cookie, "supprimerTemps", tA);
  verifier((await tempsDe(fA)).length === 1, "Auteur : supprimer un temps validé → refusé");
  e = await A.api.from("temps").update({ heures: 1 }).eq("id", tA).select("id");
  verifier((e.data?.length ?? 0) === 0 && Number((await tempsDe(fA))[0].heures) === 7.5, "API : modifier les heures d'un temps validé → aucun effet");

  const { data: tB } = await admin.from("temps").select("id").eq("collaborateur_id", fB).single();
  r = await action(B.cookie, "supprimerTemps", tB.id);
  verifier((await tempsDe(fB)).length === 0, "Auteur : supprimer son temps en brouillon → OK");
} finally {
  if (projets.length) await admin.from("temps").delete().in("projet_id", projets);
  if (fiches.length) await admin.from("temps").delete().in("collaborateur_id", fiches);
  for (const id of comptes) { await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id); }
  if (projets.length) await admin.from("projets").delete().in("id", projets);
  if (fiches.length) await admin.from("collaborateurs").delete().in("id", fiches);
  const apres = await instantane();
  verifier(avant === apres, "Base identique avant / après le test (temps, projets, collaborateurs, clients)");
  console.log(`ℹ️  Nettoyage : ${comptes.length} comptes, ${fiches.length} fiches, ${projets.length} projets supprimés`);
}

process.exit(echecs ? 1 : 0);
