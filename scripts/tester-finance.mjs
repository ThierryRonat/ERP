// Test RÉEL du module Finance en CONTOURNANT l'interface. Ne crée AUCUNE facture (une facture ne se
// supprime jamais) : il attaque la facture existante la plus récente sans jamais réussir à la modifier.
// Données jetables pour le reste ; base identique avant/après (hors comptes jetables supprimés).
// Prérequis : serveur de dev (port 3000), au moins une facture existante, pages /finance compilées.
// Lancement : node --env-file=.env.local scripts/tester-finance.mjs

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
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options); // = la clé SECRÈTE

let echecs = 0;
const verifier = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) echecs++; };
// Liste des actions du serveur RELUE À CHAQUE APPEL : après un redémarrage, elle se complète au fil des compilations.
const idActionDe = (nom) => {
  const manifeste = JSON.parse(readFileSync(".next/dev/server/server-reference-manifest.json", "utf8"));
  const trouve = Object.entries(manifeste.node).find(([, v]) => v.exportedName === nom);
  if (!trouve) throw new Error(`Action « ${nom} » inconnue du serveur (page pas encore compilée ?)`);
  return trouve[0];
};
/** Si la page n'est pas encore compilée, on la charge une fois (avec le même compte) puis on réessaie. */
async function idActionAvecCompilation(nom, cookie, chemin) {
  try {
    return idActionDe(nom);
  } catch {
    await fetch(URL_APP + chemin, { headers: { cookie }, redirect: "manual" });
    await new Promise((r) => setTimeout(r, 800));
    return idActionDe(nom);
  }
}
const comptes = [], fiches = [], projets = [], clients = [];

async function compte(role, collaborateurId) {
  const email = `jetable-fin-${role}-${Date.now()}-${randomBytes(3).toString("hex")}@exemple.test`;
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
async function action(cookie, page, nom, ...args) {
  const corps = await encodeReply(args);
  const r = await fetch(URL_APP + page, {
    method: "POST",
    headers: { cookie, "Next-Action": await idActionAvecCompilation(nom, cookie, page), Accept: "text/x-component",
      ...(typeof corps === "string" ? { "Content-Type": "text/plain;charset=UTF-8" } : {}) },
    body: corps,
    redirect: "manual",
  });
  return await r.text();
}
const page = async (cookie, chemin) => {
  const r = await fetch(URL_APP + chemin, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { statut: r.status, vers: r.headers.get("location") ?? "", texte: r.status === 200 ? await r.text() : "" };
};
const formulaire = (champs) => { const f = new FormData(); for (const [k, v] of Object.entries(champs)) f.set(k, v); return f; };
const cle = `facture_${new Date().getFullYear()}`;
const compteur = async () => (await admin.from("compteurs").select("valeur").eq("cle", cle).maybeSingle()).data?.valeur ?? 0;
const instantane = async () => JSON.stringify(await Promise.all(["factures", "temps", "clients", "projets", "collaborateurs"].map(
  async (t) => (await admin.from(t).select("*").order("id")).data)));

const avant = await instantane();
const compteurAvant = await compteur();
let tauxOrigine = null, ficheTaux = null;

try {
  const { data: facture } = await admin.from("factures").select("id, numero, client_id, periode_debut, total_ht, statut").order("created_at", { ascending: false }).limit(1).single();
  const { data: tempsFacture } = await admin.from("temps").select("id, collaborateur_id").eq("facture_id", facture.id).limit(1).single();
  console.log(`ℹ️  Facture attaquée : ${facture.numero} (${facture.statut}) ; compteur ${cle} = ${compteurAvant}`);

  const { data: f } = await admin.from("collaborateurs").insert({ nom: "Finance-Admin", prenom: "Jetable", taux_horaire: 0 }).select("id").single(); fiches.push(f.id);
  const A = await compte("admin", f.id);
  const { data: bruno } = await admin.from("collaborateurs").select("id").eq("nom", "Dubois").single();
  const M = await compte("manager", bruno.id);

  // ── Manager : tout est refusé ──
  for (const chemin of ["/finance", `/finance/factures/${facture.id}`]) {
    const p = await page(M.cookie, chemin);
    verifier(p.statut !== 200 && p.vers.includes("refus=admin"), `Manager : ${chemin.replace(facture.id, "<id>")} → renvoyé`);
  }
  let e = await M.api.from("factures").select("id, numero");
  verifier((e.data?.length ?? 0) === 0, "Manager : lecture des factures via l'API → 0 ligne");
  e = await M.api.from("relances").select("id");
  verifier((e.data?.length ?? 0) === 0 && !e.data?.length, "Manager : lecture des relances via l'API → 0 ligne");
  e = await M.api.rpc("generer_facture", { p_client_id: facture.client_id, p_mois: facture.periode_debut });
  verifier(Boolean(e.error), "Manager : generer_facture via l'API → refusé");
  let r = await action(M.cookie, "/finance", "genererFacture", {}, formulaire({ client_id: facture.client_id, mois: facture.periode_debut }));
  verifier(r.includes("réservée à l'administrateur"), "Manager : action genererFacture en direct → refusée");
  r = await action(M.cookie, "/finance", "changerStatutFacture", facture.id, "payee");
  verifier(r.includes("réservée à l'administrateur"), "Manager : action changerStatutFacture en direct → refusée");

  // ── Admin : refacturation et « rien à facturer » sans consommer de numéro ──
  r = await action(A.cookie, "/finance", "genererFacture", {}, formulaire({ client_id: facture.client_id, mois: facture.periode_debut.slice(0, 7) }));
  verifier(r.includes("Rien à facturer") && (await compteur()) === compteurAvant, "Admin : refacturer le même client/mois → « Rien à facturer », aucun numéro consommé");

  // ── Taux à 0 : refus qui NOMME le collaborateur, sans numéro consommé (données jetables) ──
  const { data: c } = await admin.from("clients").insert({ nom: "Client jetable finance" }).select("id").single(); clients.push(c.id);
  const { data: p } = await admin.from("projets").insert({ nom: "Projet jetable finance", client_id: c.id }).select("id").single(); projets.push(p.id);
  const { data: z } = await admin.from("collaborateurs").insert({ nom: "Taux-Zero", prenom: "Jetable", taux_horaire: 0 }).select("id").single(); fiches.push(z.id);
  await admin.from("temps").insert({ collaborateur_id: z.id, projet_id: p.id, date_saisie: "2031-05-12", heures: 3, statut: "valide" });
  const apercu = await page(A.cookie, `/finance?client=${c.id}&mois=2031-05`);
  verifier(apercu.texte.includes("taux horaire à 0") && apercu.texte.includes("Jetable Taux-Zero"), "Aperçu : alerte taux à 0 qui nomme « Jetable Taux-Zero »");
  r = await action(A.cookie, "/finance", "genererFacture", {}, formulaire({ client_id: c.id, mois: "2031-05" }));
  verifier(r.includes("Jetable Taux-Zero") && (await compteur()) === compteurAvant, "Génération forcée en direct → refus PAR LA BASE qui nomme le collaborateur, aucun numéro consommé");

  // ── Clé SECRÈTE (la RLS ne s'applique pas) contre les déclencheurs ──
  e = await admin.from("factures").update({ numero: "FAC-PIRATE" }).eq("id", facture.id);
  verifier(Boolean(e.error), `Clé secrète : changer le numéro → refusé (${e.error?.message})`);
  e = await admin.from("factures").delete().eq("id", facture.id);
  verifier(Boolean(e.error), `Clé secrète : supprimer la facture → refusé (${e.error?.message})`);
  e = await admin.from("temps").update({ heures: 1 }).eq("id", tempsFacture.id);
  verifier(Boolean(e.error), "Clé secrète : modifier un temps facturé → refusé");
  e = await admin.from("temps").update({ facture_id: null }).eq("id", tempsFacture.id);
  verifier(Boolean(e.error), "Clé secrète : détacher un temps facturé (pour le refacturer) → refusé");
  e = await admin.from("temps").delete().eq("id", tempsFacture.id);
  verifier(Boolean(e.error), "Clé secrète : supprimer un temps facturé → refusé");

  // ── API admin : seuls statut/date_envoi sont modifiables ──
  e = await A.api.from("factures").update({ total_ht: 1 }).eq("id", facture.id);
  verifier(Boolean(e.error), "Admin via l'API : modifier un montant → refusé (droit par colonne)");
  e = await A.api.from("factures").insert({ client_id: facture.client_id, numero: "FAC-MAIN" });
  verifier(Boolean(e.error), "Admin via l'API : créer une facture à la main (sans generer_facture) → refusé");

  // ── RH : un temps facturé n'est plus modifiable (contrôle serveur) ──
  await page(A.cookie, "/rh?onglet=temps"); // fait compiler la page RH (sinon ses actions sont inconnues du serveur)
  r = await action(A.cookie, "/rh?onglet=temps", "changerStatutTemps", tempsFacture.id, "soumis");
  verifier(r.includes("facturé"), "RH : action changerStatutTemps sur un temps facturé → refusée côté serveur");
  r = await action(A.cookie, "/rh?onglet=temps", "supprimerTemps", tempsFacture.id);
  verifier(r.includes("facturé"), "RH : action supprimerTemps sur un temps facturé → refusée côté serveur");
  const rh = await page(A.cookie, "/rh?onglet=temps");
  verifier(rh.texte.includes(">Facturé<"), "RH : l'étiquette « Facturé » s'affiche");

  // ── Écart de taux : on change TEMPORAIREMENT le taux, la page doit prévenir ──
  ficheTaux = tempsFacture.collaborateur_id;
  tauxOrigine = (await admin.from("collaborateurs").select("taux_horaire").eq("id", ficheTaux).single()).data.taux_horaire;
  let detail = await page(A.cookie, `/finance/factures/${facture.id}`);
  verifier(detail.texte.includes('data-testid="controle-ok"'), "Détail : contrôle OK tant que les taux n'ont pas changé");
  await admin.from("collaborateurs").update({ taux_horaire: Number(tauxOrigine) + 1 }).eq("id", ficheTaux);
  detail = await page(A.cookie, `/finance/factures/${facture.id}`);
  verifier(detail.texte.includes('data-testid="alerte-ecart"'), "Détail : taux modifié → alerte « Écart détecté » affichée");
  await admin.from("collaborateurs").update({ taux_horaire: tauxOrigine }).eq("id", ficheTaux);
  tauxOrigine = null;
  detail = await page(A.cookie, `/finance/factures/${facture.id}`);
  verifier(detail.texte.includes('data-testid="controle-ok"'), "Détail : taux remis → contrôle OK de nouveau");
} finally {
  if (tauxOrigine !== null) await admin.from("collaborateurs").update({ taux_horaire: tauxOrigine }).eq("id", ficheTaux);
  if (fiches.length) await admin.from("temps").delete().in("collaborateur_id", fiches);
  for (const id of comptes) { await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id); }
  if (projets.length) await admin.from("projets").delete().in("id", projets);
  if (clients.length) await admin.from("clients").delete().in("id", clients);
  if (fiches.length) await admin.from("collaborateurs").delete().in("id", fiches);
  verifier((await compteur()) === compteurAvant, `Compteur des factures inchangé (${compteurAvant})`);
  verifier(avant === (await instantane()), "Base identique avant / après (factures, temps, clients, projets, collaborateurs)");
}

process.exit(echecs ? 1 : 0);
