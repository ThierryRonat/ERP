// Test RÉEL de la fiche collaborateur (consultation) : droits, totaux de la semaine et par projet,
// absence du taux horaire. Données JETABLES uniquement ; base identique avant/après.
// Prérequis : serveur de dev (port 3000).
// Lancement : node --env-file=.env.local scripts/tester-fiche-collaborateur.mjs

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "node:crypto";

const URL_APP = "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);

let echecs = 0;
const verifier = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) echecs++; };
const comptes = [], fiches = [], projets = [];

async function compte(role, collaborateurId) {
  const email = `jetable-fiche-${role}-${Date.now()}-${randomBytes(3).toString("hex")}@exemple.test`;
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
  return [...jarre].map(([n, v]) => `${n}=${v}`).join("; ");
}
const page = async (cookie, chemin) => {
  const r = await fetch(URL_APP + chemin, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { statut: r.status, vers: r.headers.get("location") ?? "", texte: r.status === 200 ? await r.text() : "" };
};
const lire = (html, testid) => (html.match(new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`)) ?? [])[1];
const instantane = async () => JSON.stringify(await Promise.all(["temps", "projets", "collaborateurs"].map(
  async (t) => (await admin.from(t).select("id").order("id")).data.map((x) => x.id))));

// Dates : semaine en cours (Paris) et semaine précédente
const iso = (d) => d.toISOString().slice(0, 10);
const aujourdhui = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const midi = new Date(`${aujourdhui}T12:00:00Z`);
const lundi = new Date(midi); lundi.setUTCDate(midi.getUTCDate() - ((midi.getUTCDay() + 6) % 7));
const jour = (decalage) => { const d = new Date(lundi); d.setUTCDate(lundi.getUTCDate() + decalage); return iso(d); };

const avant = await instantane();
try {
  const creerFiche = async (nom, taux) => { const { data } = await admin.from("collaborateurs").insert({ nom, prenom: "Jetable", poste: "Testeur", taux_horaire: taux }).select("id").single(); fiches.push(data.id); return data.id; };
  const fA = await creerFiche("Fiche-A", 77.77), fB = await creerFiche("Fiche-B", 0), fM = await creerFiche("Fiche-Manager", 0);
  const creerProjet = async (nom) => { const { data } = await admin.from("projets").insert({ nom }).select("id").single(); projets.push(data.id); return data.id; };
  const p1 = await creerProjet("Projet fiche Alpha"), p2 = await creerProjet("Projet fiche Beta");

  // Temps de A : 3 cette semaine (lundi 7,5 / lundi 0,25 sur un autre projet / mercredi 0,1+0,2), 1 la semaine dernière
  await admin.from("temps").insert([
    { collaborateur_id: fA, projet_id: p1, date_saisie: jour(0), heures: 7.5, statut: "valide" },
    { collaborateur_id: fA, projet_id: p2, date_saisie: jour(0), heures: 0.25, statut: "brouillon" },
    { collaborateur_id: fA, projet_id: p1, date_saisie: jour(2), heures: 0.1, statut: "soumis" },
    { collaborateur_id: fA, projet_id: p1, date_saisie: jour(2), heures: 0.2, statut: "soumis" },
    { collaborateur_id: fA, projet_id: p2, date_saisie: jour(-7), heures: 4, statut: "valide" },
    { collaborateur_id: fB, projet_id: p1, date_saisie: jour(1), heures: 3, statut: "brouillon" },
  ]);

  const cA = await compte("collaborateur", fA);
  const cB = await compte("collaborateur", fB);
  const cM = await compte("manager", fM);
  const cAdmin = await compte("admin", fM);

  // ── Collaborateur A sur SA fiche ──
  const maFiche = await page(cA, `/rh/collaborateurs/${fA}`);
  verifier(maFiche.statut === 200 && maFiche.texte.includes("Fiche-A"), "Collaborateur : voit SA fiche");
  verifier(lire(maFiche.texte, "total-semaine") === "8,05", `Semaine en cours : 7,5 + 0,25 + 0,1 + 0,2 = 8,05 h (lu : ${lire(maFiche.texte, "total-semaine")})`);
  verifier(lire(maFiche.texte, "total-general") === "12,05", `Total général depuis le début : 12,05 h (lu : ${lire(maFiche.texte, "total-general")})`);
  const totauxProjets = [...maFiche.texte.matchAll(/data-projet="([^"]+)"[\s\S]*?data-testid="total-projet"[^>]*>([^<]*)</g)].map((m) => `${m[1]}=${m[2]}`);
  verifier(totauxProjets.join(" | ") === "Projet fiche Alpha=7,8 | Projet fiche Beta=4,25", `Total par projet : ${totauxProjets.join(" | ")}`);
  verifier(!maFiche.texte.includes("77,77") && !maFiche.texte.includes("77.77"), "Le taux horaire (77,77) n'apparaît NULLE PART sur la fiche");
  verifier(!maFiche.texte.includes("Modifier la fiche"), "Collaborateur : pas de bouton « Modifier la fiche »");
  const precedente = await page(cA, `/rh/collaborateurs/${fA}?semaine=${jour(-7)}`);
  verifier(lire(precedente.texte, "total-semaine") === "4", `Semaine précédente : 4 h (lu : ${lire(precedente.texte, "total-semaine")})`);
  const pirate = await page(cA, `/rh/collaborateurs/${fA}?semaine=n'importe-quoi`);
  verifier(pirate.statut === 200 && lire(pirate.texte, "total-semaine") === "8,05", "Paramètre de semaine invalide → semaine en cours (pas d'erreur)");

  // ── A sur la fiche de B : la RLS la masque ──
  verifier((await page(cA, `/rh/collaborateurs/${fB}`)).statut === 404, "Collaborateur : fiche d'un AUTRE → 404 (masquée par la base)");
  const ficheB = await page(cB, `/rh/collaborateurs/${fB}`);
  verifier(lire(ficheB.texte, "total-semaine") === "3" && !ficheB.texte.includes("Projet fiche Beta"), "Collaborateur B : voit ses 3 h, jamais les temps de A");

  // ── Manager et admin ──
  const vueM = await page(cM, `/rh/collaborateurs/${fA}`);
  verifier(vueM.statut === 200 && lire(vueM.texte, "total-semaine") === "8,05" && lire(vueM.texte, "total-general") === "12,05", "Manager : voit la fiche et les temps de A (mêmes totaux)");
  verifier(!vueM.texte.includes("Modifier la fiche") && !vueM.texte.includes("77,77"), "Manager : ni bouton « Modifier », ni taux horaire");
  verifier((await page(cM, `/rh/collaborateurs/${fA}/modifier`)).vers.includes("refus=admin"), "Manager : /modifier tapé à la main → renvoyé");
  const vueAdmin = await page(cAdmin, `/rh/collaborateurs/${fA}`);
  verifier(vueAdmin.texte.includes("Modifier la fiche") && !vueAdmin.texte.includes("77,77"), "Admin : bouton « Modifier la fiche », mais AUCUN taux sur la consultation");
  verifier((await page(cAdmin, `/rh/collaborateurs/${fA}/modifier`)).texte.includes("77,77"), "Admin : le taux n'apparaît que sur /modifier (lu par le serveur)");

  // ── Non connecté ──
  const anonyme = await page(null, `/rh/collaborateurs/${fA}`);
  verifier(anonyme.statut === 307 && anonyme.vers.includes("/connexion"), "Visiteur non connecté → redirigé vers la connexion");
} finally {
  if (fiches.length) await admin.from("temps").delete().in("collaborateur_id", fiches);
  for (const id of comptes) { await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id); }
  if (projets.length) await admin.from("projets").delete().in("id", projets);
  if (fiches.length) await admin.from("collaborateurs").delete().in("id", fiches);
  verifier(avant === (await instantane()), "Base identique avant / après le test");
}

process.exit(echecs ? 1 : 0);
