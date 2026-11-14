// Test en conditions réelles avec un compte JETABLE (créé puis supprimé).
// Lancement (serveur de dev démarré sur le port 3000) :
//   node --env-file=.env.local scripts/tester-compte-jetable.mjs
// Le compte jetable reçoit le rôle par défaut donné par le déclencheur (pas admin).

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "node:crypto";

const URL_APP = process.env.URL_APP ?? "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let echecs = 0;
const verifier = (condition, message) => {
  console.log(`${condition ? "✅" : "❌"} ${message}`);
  if (!condition) echecs++;
};

const email = `jetable-${Date.now()}@exemple.test`;
const motDePasse = randomBytes(18).toString("base64url");
let idJetable;

try {
  const { data: cree, error } = await admin.auth.admin.createUser({ email, password: motDePasse, email_confirm: true });
  if (error) throw new Error(`Création du compte jetable impossible : ${error.message}`);
  idJetable = cree.user.id;
  const { data: profil } = await admin.from("profiles").select("role, collaborateur_id").eq("id", idJetable).single();
  console.log(`ℹ️  Compte jetable créé (rôle « ${profil.role} »)`);
  verifier(profil.role !== "admin", "Le 2e compte n'est PAS admin");

  // Connexion avec le même mécanisme de cookies que l'application.
  const jarre = new Map();
  const client = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...jarre].map(([name, value]) => ({ name, value })),
      setAll: (liste) => liste.forEach(({ name, value }) => (value ? jarre.set(name, value) : jarre.delete(name))),
    },
  });
  const { error: errConnexion } = await client.auth.signInWithPassword({ email, password: motDePasse });
  if (errConnexion) throw new Error(`Connexion impossible : ${errConnexion.message}`);
  const cookie = [...jarre].map(([n, v]) => `${n}=${v}`).join("; ");

  const page = async (chemin) => {
    const r = await fetch(URL_APP + chemin, { headers: { cookie }, redirect: "manual" });
    return { statut: r.status, vers: r.headers.get("location"), html: r.status === 200 ? await r.text() : "" };
  };

  const accueil = await page("/");
  verifier(accueil.statut === 200, "Accueil accessible une fois connecté");
  verifier(accueil.html.includes(email), "Email affiché dans la page");
  verifier(!accueil.html.includes('href="/finance"'), "Lien Finance absent du menu");
  verifier(!accueil.html.includes('href="/utilisateurs"'), "Lien Utilisateurs absent du menu");
  verifier(accueil.html.includes('href="/rh"') && accueil.html.includes('href="/absences"'), "Liens RH et Absences présents");
  if (!profil.collaborateur_id)
    verifier(accueil.html.includes("Compte non rattaché"), "Bandeau « compte non rattaché » visible");

  for (const chemin of ["/finance", "/utilisateurs"]) {
    const p = await page(chemin);
    verifier(p.statut !== 200 && (p.vers ?? "").includes("refus=admin"), `${chemin} tapé à la main → renvoyé à l'accueil`);
  }
  verifier((await page("/connexion")).statut === 307, "Déjà connecté : /connexion renvoie vers l'accueil");

  // Page RH : ce que la RLS laisse voir selon le rattachement et le rôle
  const nombreFiches = async () => (await page("/rh")).html.match(/data-testid="nombre-fiches">(\d+)</)?.[1];
  const { count: total } = await admin.from("collaborateurs").select("id", { count: "exact", head: true });
  verifier((await nombreFiches()) === "0", "Page RH, compte non rattaché : 0 fiche visible");
  const { data: fiche } = await admin.from("collaborateurs").select("id").order("nom").limit(1).single();
  await admin.from("profiles").update({ collaborateur_id: fiche.id }).eq("id", idJetable);
  verifier((await nombreFiches()) === "1", "Page RH, collaborateur rattaché : 1 seule fiche visible");
  await admin.from("profiles").update({ role: "manager" }).eq("id", idJetable);
  verifier((await nombreFiches()) === String(total), `Page RH, manager : les ${total} fiches visibles`);
} finally {
  if (idJetable) {
    await admin.from("profiles").delete().eq("id", idJetable);
    const { error } = await admin.auth.admin.deleteUser(idJetable);
    verifier(!error, "Compte jetable supprimé" + (error ? ` (${error.message})` : ""));
  }
}

process.exit(echecs ? 1 : 0);
