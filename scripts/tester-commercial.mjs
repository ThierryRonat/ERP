// Test RÉEL des droits du module Commercial, avec 2 comptes JETABLES (collaborateur, manager).
// Les actions serveur sont appelées DIRECTEMENT (comme un pirate, sans l'écran),
// puis l'API Supabase est attaquée en direct. Tout ce qui est créé est supprimé à la fin,
// et le compteur des devis est remis à sa valeur de départ.
// Prérequis : serveur de dev sur le port 3000, pages /commercial et /commercial/devis/nouveau compilées.
// Lancement : node --env-file=.env.local scripts/tester-commercial.mjs

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

const comptes = [];
const prospectsCrees = [];

async function compte(role, collaborateurId) {
  const email = `jetable-${role}-${Date.now()}@exemple.test`;
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

/** Appelle une action serveur exactement comme le navigateur (encodage React). */
async function action(cookie, page, nom, ...args) {
  const corps = await encodeReply(args);
  const r = await fetch(URL_APP + page, {
    method: "POST",
    headers: { cookie, "Next-Action": await idActionAvecCompilation(nom, cookie, page), Accept: "text/x-component",
      ...(typeof corps === "string" ? { "Content-Type": "text/plain;charset=UTF-8" } : {}) },
    body: corps,
    redirect: "manual",
  });
  return { statut: r.status, texte: await r.text(), redirection: r.headers.get("x-action-redirect") };
}

function formulaireDevis(prospectId, taux, lignes) {
  const f = new FormData();
  f.set("prospect_id", prospectId);
  f.set("taux_tva", taux);
  f.set("lignes", JSON.stringify(lignes));
  return f;
}

const html = async (cookie, chemin) => {
  const r = await fetch(URL_APP + chemin, { headers: { cookie }, redirect: "manual" });
  return { statut: r.status, vers: r.headers.get("location"), texte: r.status === 200 ? await r.text() : "" };
};
const compteur = async () => (await admin.from("compteurs").select("valeur").eq("cle", `devis_${new Date().getFullYear()}`).maybeSingle()).data?.valeur ?? 0;
const nbDevis = async () => (await admin.from("devis").select("id", { count: "exact", head: true })).count;
const nbProspects = async () => (await admin.from("prospects").select("id", { count: "exact", head: true })).count;

const cleCompteur = `devis_${new Date().getFullYear()}`;
const ligneCompteur = (await admin.from("compteurs").select("valeur").eq("cle", cleCompteur).maybeSingle()).data;
const compteurDepart = ligneCompteur?.valeur ?? null; // null = aucune ligne au départ
const devisDepart = new Set(((await admin.from("devis").select("id")).data ?? []).map((d) => d.id));

try {
  const { data: fiches } = await admin.from("collaborateurs").select("id, nom").order("nom");
  // Prospect JETABLE : depuis le module RH, accepter un devis crée un client et un projet et passe le
  // prospect en « gagné ». Le test ne doit donc JAMAIS travailler sur un prospect réel.
  const { data: prospect } = await admin.from("prospects")
    .insert({ nom: "Prospect jetable commercial", societe: "Société jetable commercial" }).select("id").single();
  prospectsCrees.push(prospect.id);
  const { data: unDevis } = await admin.from("devis").select("id, statut").limit(1).maybeSingle();

  // ── COLLABORATEUR ──
  const collab = await compte("collaborateur", fiches[1].id);
  const page = await html(collab.cookie, "/commercial?onglet=devis");
  const pageP = await html(collab.cookie, "/commercial?onglet=prospects");
  verifier(page.texte.includes("Lecture seule") && pageP.texte.includes("Lecture seule"), "Collaborateur : bandeau « Lecture seule » affiché sur les 2 onglets");
  verifier(!page.texte.includes("Nouveau devis") && !pageP.texte.includes("Créer le prospect"), "Collaborateur : ni bouton « Nouveau devis » ni formulaire prospect");
  verifier(!page.texte.includes("Statut du devis"), "Collaborateur : pas de menu de statut (simple étiquette)");
  const nouveau = await html(collab.cookie, "/commercial/devis/nouveau");
  verifier(nouveau.statut === 307 && (nouveau.vers ?? "").includes("/commercial?onglet=devis"), "Collaborateur : /commercial/devis/nouveau tapé à la main → renvoyé");

  let avant = [await nbProspects(), await nbDevis(), await compteur()];
  const fP = new FormData(); fP.set("nom", "Intrus"); fP.set("statut", "contacte");
  let r = await action(collab.cookie, "/commercial", "creerProspect", {}, fP);
  verifier(r.texte.includes("réservée aux managers"), "Collaborateur : action creerProspect appelée en direct → refusée");
  r = await action(collab.cookie, "/commercial/devis/nouveau", "creerDevis", {},
    formulaireDevis(prospect.id, "20", [{ designation: "Intrus", quantite: "1", prixUnitaire: "10" }]));
  verifier(r.texte.includes("réservée aux managers"), "Collaborateur : action creerDevis appelée en direct → refusée");
  if (unDevis) {
    r = await action(collab.cookie, "/commercial", "changerStatutDevis", unDevis.id, "refuse");
    verifier(r.texte.includes("réservée aux managers"), "Collaborateur : action changerStatutDevis appelée en direct → refusée");
  }
  // Attaque directe de l'API Supabase (sans passer par l'application)
  const { error: e1 } = await collab.api.from("prospects").insert({ nom: "Intrus API" });
  verifier(Boolean(e1), "Collaborateur : insertion directe d'un prospect via l'API → refusée");
  const { error: e2 } = await collab.api.rpc("creer_devis", { p_prospect_id: prospect.id, p_taux_tva: 20, p_lignes: [{ designation: "x", quantite: 1, prix_unitaire: 1 }] });
  verifier(Boolean(e2), "Collaborateur : appel direct de creer_devis via l'API → refusé");
  if (unDevis) {
    const { data: m } = await collab.api.from("devis").update({ statut: "refuse" }).eq("id", unDevis.id).select();
    verifier((m?.length ?? 0) === 0, "Collaborateur : changement de statut direct via l'API → aucun effet");
  }
  const apres = [await nbProspects(), await nbDevis(), await compteur()];
  verifier(JSON.stringify(avant) === JSON.stringify(apres), "Collaborateur : rien n'a changé en base (prospects, devis, compteur)");
  if (unDevis) verifier((await admin.from("devis").select("statut").eq("id", unDevis.id).single()).data.statut === unDevis.statut, "Collaborateur : statut du devis inchangé");

  // ── MANAGER ──
  const manager = await compte("manager", fiches[0].id);
  const pageM = await html(manager.cookie, "/commercial?onglet=devis");
  const pageMP = await html(manager.cookie, "/commercial?onglet=prospects");
  verifier(pageM.texte.includes("Nouveau devis") && !pageM.texte.includes("Lecture seule"), "Manager : onglet Devis avec bouton « Nouveau devis », pas de lecture seule");
  verifier(pageMP.texte.includes("Créer le prospect") && !pageMP.texte.includes("Nouveau devis"), "Manager : onglet Prospects avec le formulaire, sans la liste des devis");

  const fP2 = new FormData(); fP2.set("nom", "Prospect manager jetable"); fP2.set("statut", "contacte");
  r = await action(manager.cookie, "/commercial", "creerProspect", {}, fP2);
  const { data: pm } = await admin.from("prospects").select("id").eq("nom", "Prospect manager jetable").maybeSingle();
  if (pm) prospectsCrees.push(pm.id);
  verifier(Boolean(pm), "Manager : création de prospect par l'action → OK");

  // Saisie invalide : refusée AVANT de prendre un numéro
  avant = await compteur();
  r = await action(manager.cookie, "/commercial/devis/nouveau", "creerDevis", {},
    formulaireDevis(prospect.id, "20", [{ designation: "Ligne", quantite: "1,234", prixUnitaire: "10" }]));
  verifier(r.texte.includes("quantité invalide") && (await compteur()) === avant, "Manager : quantité à 3 décimales refusée, aucun numéro consommé");
  r = await action(manager.cookie, "/commercial/devis/nouveau", "creerDevis", {},
    formulaireDevis(prospect.id, "150", [{ designation: "Ligne", quantite: "1", prixUnitaire: "10" }]));
  verifier(r.texte.includes("Taux de TVA invalide") && (await compteur()) === avant, "Manager : taux de TVA à 150 % refusé, aucun numéro consommé");
  const { error: e3 } = await manager.api.rpc("creer_devis", { p_prospect_id: prospect.id, p_taux_tva: 20, p_lignes: [{ designation: "", quantite: 1, prix_unitaire: 1 }] });
  verifier(Boolean(e3) && (await compteur()) === avant, "Manager : ligne sans désignation envoyée en direct à la base → refusée, aucun numéro consommé");

  // Devis valide via l'action : numéro suivant, totaux recalculés (gros montant pour les milliers)
  r = await action(manager.cookie, "/commercial/devis/nouveau", "creerDevis", {},
    formulaireDevis(prospect.id, "5,5", [{ designation: "Mission longue", quantite: "12", prixUnitaire: "1 234,56" }]));
  // UNIQUEMENT les devis du prospect JETABLE : jamais « le dernier devis de la base » (qui peut être un vrai devis)
  const { data: dm } = await admin.from("devis").select("numero, total_ht, tva, total_ttc").eq("prospect_id", prospect.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!dm) throw new Error(`Le devis du manager n'a pas été créé. Réponse du serveur : ${r.statut} ${r.texte.slice(0, 300)}`);
  verifier((await compteur()) === avant + 1, `Manager : devis créé → ${dm.numero} (numéro suivant, sans trou)`);
  verifier(dm.total_ht === 14814.72 && dm.tva === 814.81 && dm.total_ttc === 15629.53,
    `Manager : totaux recalculés 12 × 1 234,56 à 5,5 % → HT ${dm.total_ht} / TVA ${dm.tva} / TTC ${dm.total_ttc}`);

  // Tentative d'écrire un total directement
  const { data: idm } = await admin.from("devis").select("id").eq("numero", dm.numero).single();
  const { error: e4 } = await manager.api.from("devis").update({ total_ttc: 1 }).eq("id", idm.id);
  verifier(Boolean(e4), "Manager : modification directe d'un total via l'API → refusée");
  r = await action(manager.cookie, "/commercial", "changerStatutDevis", idm.id, "accepte");
  verifier((await admin.from("devis").select("statut").eq("id", idm.id).single()).data.statut === "accepte", "Manager : changement de statut → OK");
  const { data: pj } = await admin.from("projets").select("id").eq("devis_id", idm.id);
  const { data: pr } = await admin.from("prospects").select("statut, client_id").eq("id", prospect.id).single();
  verifier(pj?.length === 1 && pr.statut === "gagne" && pr.client_id, "Devis accepté via l'écran → projet créé, client créé, prospect gagné (règle de la base)");
} finally {
  // Nettoyage : devis créés pendant CE test, et ce que la règle « devis accepté » a créé
  // (projets, clients), prospects de test, comptes, compteur.
  const { data: tous } = await admin.from("devis").select("id");
  const nouveaux = (tous ?? []).filter((d) => !devisDepart.has(d.id)).map((d) => d.id);
  const { data: clientsTest } = prospectsCrees.length
    ? await admin.from("prospects").select("client_id").in("id", prospectsCrees)
    : { data: [] };
  const idsClients = (clientsTest ?? []).map((p) => p.client_id).filter(Boolean);
  if (nouveaux.length) await admin.from("projets").delete().in("devis_id", nouveaux);
  if (idsClients.length) await admin.from("projets").delete().in("client_id", idsClients);
  if (nouveaux.length) {
    await admin.from("devis_lignes").delete().in("devis_id", nouveaux);
    await admin.from("devis").delete().in("id", nouveaux);
  }
  if (prospectsCrees.length) await admin.from("prospects").delete().in("id", prospectsCrees);
  if (idsClients.length) await admin.from("clients").delete().in("id", idsClients);
  for (const id of comptes) {
    await admin.from("profiles").delete().eq("id", id);
    await admin.auth.admin.deleteUser(id);
  }
  if (compteurDepart === null) await admin.from("compteurs").delete().eq("cle", cleCompteur);
  else await admin.from("compteurs").update({ valeur: compteurDepart }).eq("cle", cleCompteur);
  console.log(`ℹ️  Nettoyage : ${nouveaux.length} devis, ${prospectsCrees.length} prospect(s), ${comptes.length} comptes supprimés ; compteur remis à ${compteurDepart ?? "absent"}`);
}

process.exit(echecs ? 1 : 0);
