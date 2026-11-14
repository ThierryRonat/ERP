// Appelle les actions serveur de l'écran Utilisateurs DIRECTEMENT (sans l'écran),
// comme le ferait un utilisateur malveillant, puis vérifie en base que rien n'a changé.
// Prérequis : serveur de dev lancé (port 3000) et page /utilisateurs déjà compilée.
// Lancement : node --env-file=.env.local scripts/tester-actions-directes.mjs <id-compte-cible-jetable>

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const URL_APP = "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const cibleJetable = process.argv[2]; // compte jetable que l'attaquant essaie de modifier

let echecs = 0;
const verifier = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) echecs++; };

// Identifiants techniques des actions (build de développement)
const manifeste = JSON.parse(readFileSync(".next/dev/server/server-reference-manifest.json", "utf8"));
const idAction = Object.fromEntries(Object.entries(manifeste.node).map(([id, v]) => [v.exportedName, id]));

async function sessionJetable(role) {
  const email = `jetable-attaque-${role}-${Date.now()}@exemple.test`;
  const password = randomBytes(18).toString("base64url");
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  await admin.from("profiles").update({ role }).eq("id", data.user.id);
  const jarre = new Map();
  const client = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...jarre].map(([name, value]) => ({ name, value })),
      setAll: (l) => l.forEach(({ name, value }) => (value ? jarre.set(name, value) : jarre.delete(name))),
    },
  });
  await client.auth.signInWithPassword({ email, password });
  return { id: data.user.id, cookie: [...jarre].map(([n, v]) => `${n}=${v}`).join("; ") };
}

async function appeler(cookie, nomAction, ...args) {
  const r = await fetch(`${URL_APP}/utilisateurs`, {
    method: "POST",
    headers: { cookie, "Next-Action": idAction[nomAction], Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  return await r.text();
}

const profil = async (id) => (await admin.from("profiles").select("role, collaborateur_id").eq("id", id).maybeSingle()).data;
const crees = [];

try {
  const { data: bruno } = await admin.from("collaborateurs").select("id, email").eq("nom", "Dubois").single();

  // ── 1. Un COLLABORATEUR appelle les actions admin ──
  const pirate = await sessionJetable("collaborateur");
  crees.push(pirate.id);

  let rep = await appeler(pirate.cookie, "creerAcces", bruno.id, "admin");
  const { data: tous } = await admin.auth.admin.listUsers({ perPage: 1000 });
  verifier(!tous.users.some((u) => u.email === bruno.email), "creerAcces par un non-admin : aucun compte créé");
  verifier(rep.includes("réservée aux administrateurs"), "  → message « Action réservée aux administrateurs »");

  await appeler(pirate.cookie, "changerRole", pirate.id, "admin");
  verifier((await profil(pirate.id)).role === "collaborateur", "changerRole par un non-admin (vers admin) : refusé");

  await appeler(pirate.cookie, "rattacherCompte", pirate.id, bruno.id);
  verifier((await profil(pirate.id)).collaborateur_id === null, "rattacherCompte par un non-admin : refusé");

  if (cibleJetable) {
    await appeler(pirate.cookie, "revoquerAcces", cibleJetable);
    verifier(Boolean(await profil(cibleJetable)), "revoquerAcces par un non-admin : compte cible intact");
    rep = await appeler(pirate.cookie, "reinitialiserMotDePasse", cibleJetable);
    verifier(rep.includes("réservée aux administrateurs") && !rep.includes("motDePasse"), "reinitialiserMotDePasse par un non-admin : refusé");
  }

  // ── 2. Un ADMIN essaie de se rétrograder / se révoquer lui-même ──
  const adminJetable = await sessionJetable("admin");
  crees.push(adminJetable.id);
  rep = await appeler(adminJetable.cookie, "changerRole", adminJetable.id, "collaborateur");
  verifier((await profil(adminJetable.id)).role === "admin" && rep.includes("propre rôle"), "Admin : ne peut pas se rétrograder lui-même");
  rep = await appeler(adminJetable.cookie, "revoquerAcces", adminJetable.id);
  verifier(Boolean(await profil(adminJetable.id)) && rep.includes("propre accès"), "Admin : ne peut pas se révoquer lui-même");
} finally {
  for (const id of crees) {
    await admin.from("profiles").delete().eq("id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`ℹ️  ${crees.length} comptes jetables de ce test supprimés`);
}

process.exit(echecs ? 1 : 0);
