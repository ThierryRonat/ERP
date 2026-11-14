// Vérifie la connexion à Supabase et l'état de l'inscription publique.
// Lancement : node --env-file=.env.local scripts/verifier-supabase.mjs
// Sort en erreur (code 1) si un contrôle échoue.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const cleAnonyme = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const cleSecrete = process.env.SUPABASE_SERVICE_ROLE_KEY;
const exigerFermeture = process.argv.includes("--inscription-fermee");

let echecs = 0;
const ok = (m) => console.log("✅ " + m);
const ko = (m) => { console.log("❌ " + m); echecs++; };
const info = (m) => console.log("ℹ️  " + m);

for (const [nom, v] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: cleAnonyme, SUPABASE_SERVICE_ROLE_KEY: cleSecrete })) {
  if (!v || v === "COLLER_ICI") { ko(`${nom} n'est pas renseignée dans .env.local`); }
}
if (echecs) process.exit(1);

if (cleSecrete.startsWith("sb_publishable_") || cleSecrete === cleAnonyme) {
  ko("SUPABASE_SERVICE_ROLE_KEY contient la clé PUBLIQUE : il faut la clé secrète");
  process.exit(1);
}

// 1. Réglages d'authentification (lecture publique avec la clé anonyme)
const reponse = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: cleAnonyme } });
if (!reponse.ok) { ko(`URL ou clé publique refusée (HTTP ${reponse.status})`); process.exit(1); }
const reglages = await reponse.json();
ok("URL et clé publique acceptées");

if (reglages.disable_signup) ok("Inscription publique : FERMÉE");
else if (exigerFermeture) ko("Inscription publique : OUVERTE (elle devrait être fermée)");
else info("Inscription publique : encore ouverte (on la fermera à l'étape 5)");

info(`Confirmation par email exigée : ${reglages.mailer_autoconfirm ? "non" : "oui"}`);

// Preuve par l'essai : un inconnu tente de s'inscrire avec la clé PUBLIQUE.
if (exigerFermeture) {
  const emailIntrus = `intrus-${Date.now()}@exemple.test`;
  const essai = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: cleAnonyme, "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailIntrus, password: "MotDePasseIntrus-2026!" }),
  });
  const corps = await essai.json().catch(() => ({}));
  if (essai.ok) {
    ko(`Tentative d'inscription ACCEPTÉE (HTTP ${essai.status}) : l'inscription est ouverte !`);
    if (corps.id || corps.user?.id) {
      const id = corps.id ?? corps.user.id;
      const h = cleSecrete.startsWith("eyJ") ? { apikey: cleSecrete, Authorization: `Bearer ${cleSecrete}` } : { apikey: cleSecrete };
      await fetch(`${url}/rest/v1/profiles?id=eq.${id}`, { method: "DELETE", headers: h });
      await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: h });
      info("Le compte intrus a été supprimé immédiatement.");
    }
  } else {
    ok(`Tentative d'inscription REFUSÉE par Supabase (HTTP ${essai.status} : ${corps.msg ?? corps.error_code ?? corps.message})`);
  }
}

// 2. Clé secrète : lecture de la liste des comptes et des profils
// Ancienne clé (JWT "eyJ...") : on la passe aussi en Authorization. Nouvelle clé "sb_secret_..." : apikey seul.
const entetesSecrets = cleSecrete.startsWith("eyJ")
  ? { apikey: cleSecrete, Authorization: `Bearer ${cleSecrete}` }
  : { apikey: cleSecrete };
const comptes = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers: entetesSecrets });
if (!comptes.ok) { ko(`Clé secrète refusée (HTTP ${comptes.status})`); process.exit(1); }
const { users } = await comptes.json();
ok(`Clé secrète acceptée — comptes existants : ${users.length}`);

const profils = await fetch(`${url}/rest/v1/profiles?select=email,role,collaborateur_id`, { headers: entetesSecrets });
if (!profils.ok) ko(`Lecture de profiles impossible (HTTP ${profils.status})`);
else {
  const lignes = await profils.json();
  info(`Lignes dans profiles : ${lignes.length}`);
  for (const p of lignes) info(`   ${p.email} — ${p.role} — ${p.collaborateur_id ? "rattaché" : "NON rattaché"}`);
}

const collab = await fetch(`${url}/rest/v1/collaborateurs?select=id`, { headers: { ...entetesSecrets, Prefer: "count=exact" } });
if (collab.ok) info(`Collaborateurs (données de démo) : ${collab.headers.get("content-range")?.split("/")[1]}`);

process.exit(echecs ? 1 : 0);
