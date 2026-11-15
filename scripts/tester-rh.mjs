// Test RÉEL du module RH (collaborateurs, projets) en CONTOURNANT l'interface :
// actions serveur appelées en direct (encodeReply) et API Supabase attaquée en direct,
// avec 3 comptes JETABLES (collaborateur, manager, admin). Vérifie ensuite ce que la base a vraiment fait.
// Prérequis : serveur de dev (port 3000), pages /rh et /rh/collaborateurs/nouveau déjà compilées.
// Lancement : node --env-file=.env.local scripts/tester-rh.mjs

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

const comptes = [];
const fichesCreees = [];
const projetsCrees = [];

async function compte(role, collaborateurId) {
  const email = `jetable-rh-${role}-${Date.now()}@exemple.test`;
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
    headers: { cookie, "Next-Action": idAction[nom], Accept: "text/x-component",
      ...(typeof corps === "string" ? { "Content-Type": "text/plain;charset=UTF-8" } : {}) },
    body: corps,
    redirect: "manual",
  });
  return await r.text();
}
const html = async (cookie, chemin) => {
  const r = await fetch(URL_APP + chemin, { headers: { cookie }, redirect: "manual" });
  return { statut: r.status, vers: r.headers.get("location") ?? "", texte: r.status === 200 ? await r.text() : "" };
};
const formulaire = (champs) => { const f = new FormData(); for (const [k, v] of Object.entries(champs)) f.set(k, v); return f; };
const fiche = async (id) => (await admin.from("collaborateurs").select("nom, poste, manager_id, taux_horaire").eq("id", id).single()).data;

try {
  const { data: tous } = await admin.from("collaborateurs").select("id, nom").order("nom");
  const id = (nom) => tous.find((f) => f.nom === nom).id;
  const bruno = id("Dubois"), lea = id("Moreau");
  const { data: axians } = await admin.from("clients").select("id").eq("nom", "Axians").single();

  // Fiche cible des tests, subordonnée de Bruno
  const { data: cible } = await admin.from("collaborateurs")
    .insert({ nom: "Cible", prenom: "Jetable", taux_horaire: 33.33, manager_id: bruno }).select("id").single();
  fichesCreees.push(cible.id);
  const { data: projetTest } = await admin.from("projets").insert({ nom: "Projet jetable RH", client_id: axians.id }).select("id").single();
  projetsCrees.push(projetTest.id);

  // ── COLLABORATEUR ──
  const collab = await compte("collaborateur", lea);
  const pageC = await html(collab.cookie, "/rh?onglet=collaborateurs");
  verifier(pageC.texte.includes('data-testid="nombre-fiches">1<'), "Collaborateur : ne voit que sa propre fiche (1)");
  verifier(!pageC.texte.includes("Nouvelle fiche") && !pageC.texte.includes(">Modifier<"), "Collaborateur : ni « Nouvelle fiche » ni « Modifier »");
  const pageCP = await html(collab.cookie, "/rh?onglet=projets");
  verifier(pageCP.texte.includes("Projet jetable RH") && pageCP.texte.includes("réservé manager / admin"), "Collaborateur : lit les projets, mais pas les clients");
  verifier(!pageCP.texte.includes("Créer le projet") && !pageCP.texte.includes("Statut du projet"), "Collaborateur : ni création ni changement de statut de projet");
  for (const chemin of [`/rh/collaborateurs/${cible.id}/modifier`, "/rh/collaborateurs/nouveau"]) {
    const p = await html(collab.cookie, chemin);
    verifier(p.statut !== 200 && p.vers.includes("refus=admin"), `Collaborateur : ${chemin.replace(cible.id, "<id>")} tapé à la main → renvoyé`);
  }
  let r = await action(collab.cookie, "/rh/collaborateurs/nouveau", "enregistrerCollaborateur", {},
    formulaire({ id: cible.id, nom: "Piraté", taux_horaire: "0" }));
  verifier(r.includes("réservée aux administrateurs") && (await fiche(cible.id)).nom === "Cible", "Collaborateur : action enregistrerCollaborateur en direct → refusée, fiche intacte");
  r = await action(collab.cookie, "/rh", "creerProjet", {}, formulaire({ nom: "Projet pirate", client_id: axians.id }));
  verifier(r.includes("réservée aux administrateurs"), "Collaborateur : action creerProjet en direct → refusée");
  r = await action(collab.cookie, "/rh", "changerStatutProjet", projetTest.id, "annule");
  verifier(r.includes("réservée aux administrateurs"), "Collaborateur : action changerStatutProjet en direct → refusée");
  let e = await collab.api.from("collaborateurs").select("taux_horaire");
  verifier(Boolean(e.error), "Collaborateur : lecture de taux_horaire via l'API → refusée");
  e = await collab.api.from("projets").insert({ nom: "Projet pirate API" });
  verifier(Boolean(e.error), "Collaborateur : création de projet via l'API → refusée");
  e = await collab.api.from("clients").select("id");
  verifier((e.data?.length ?? 0) === 0, "Collaborateur : lecture des clients via l'API → 0 ligne");
  e = await collab.api.from("clients").insert({ nom: "Client pirate" });
  verifier(Boolean(e.error), "Collaborateur : création de client via l'API → refusée");

  // ── MANAGER ──
  const manager = await compte("manager", bruno);
  r = await action(manager.cookie, "/rh/collaborateurs/nouveau", "enregistrerCollaborateur", {},
    formulaire({ id: cible.id, nom: "Piraté", taux_horaire: "999" }));
  verifier(r.includes("réservée aux administrateurs") && Number((await fiche(cible.id)).taux_horaire) === 33.33, "Manager : modification de fiche en direct → refusée, taux intact");
  e = await manager.api.from("collaborateurs").update({ poste: "piraté" }).eq("id", cible.id).select("id");
  verifier((e.data?.length ?? 0) === 0, "Manager : modification de fiche via l'API → aucun effet");
  e = await manager.api.from("collaborateurs").select("taux_horaire");
  verifier(Boolean(e.error), "Manager : lecture de taux_horaire via l'API → refusée");
  e = await manager.api.from("clients").select("id");
  verifier((e.data?.length ?? 0) >= 2, `Manager : lit les clients (${e.data?.length})`);
  e = await manager.api.from("projets").insert({ nom: "Projet manager API" });
  verifier(Boolean(e.error), "Manager : création de projet via l'API → refusée (admin seul)");

  // ── ADMIN ──
  const adminJ = await compte("admin", cible.id);
  e = await adminJ.api.from("collaborateurs").select("taux_horaire");
  verifier(Boolean(e.error), "Admin : lecture de taux_horaire via l'API → refusée (seul le serveur le lit)");
  const pageA = await html(adminJ.cookie, "/rh?onglet=collaborateurs");
  verifier(!pageA.texte.includes("33,33") && !pageA.texte.includes("120,00"), "Admin : la LISTE RH ne contient aucun taux horaire");
  const edition = await html(adminJ.cookie, `/rh/collaborateurs/${cible.id}/modifier`);
  verifier(edition.texte.includes("33,33"), "Admin : l'écran d'édition affiche le taux (lu par le serveur)");
  const options = [...edition.texte.matchAll(/<option value="([0-9a-f-]{36})"/g)].map((m) => m[1]);
  verifier(!options.includes(cible.id) && options.includes(bruno), "Admin : la liste des managers exclut la personne elle-même");
  const editionBruno = await html(adminJ.cookie, `/rh/collaborateurs/${bruno}/modifier`);
  const optionsB = [...editionBruno.texte.matchAll(/<option value="([0-9a-f-]{36})"/g)].map((m) => m[1]);
  verifier(!optionsB.includes(cible.id) && !optionsB.includes(lea) && !optionsB.includes(bruno), "Admin : la liste des managers de Bruno exclut ses subordonnés (boucle)");

  r = await action(adminJ.cookie, "/rh/collaborateurs/nouveau", "enregistrerCollaborateur", {},
    formulaire({ id: cible.id, nom: "Cible", taux_horaire: "" }));
  verifier(r.includes("taux horaire est obligatoire"), "Admin : taux vide → message clair (pas d'erreur de la base)");
  r = await action(adminJ.cookie, "/rh/collaborateurs/nouveau", "enregistrerCollaborateur", {},
    formulaire({ id: cible.id, nom: "Cible", taux_horaire: "10", manager_id: cible.id }));
  verifier(r.includes("propre manager"), "Admin : se choisir soi-même comme manager (action en direct) → refusé");
  e = await adminJ.api.from("collaborateurs").update({ manager_id: cible.id }).eq("id", cible.id).select("id");
  verifier(Boolean(e.error) && e.error.message.includes("propre manager"), "Admin : même chose via l'API (sans l'application) → refusé PAR LA BASE");
  e = await adminJ.api.from("collaborateurs").update({ manager_id: cible.id }).eq("id", bruno).select("id");
  verifier(Boolean(e.error) && e.error.message.includes("Boucle"), "Admin : boucle Bruno → Cible → Bruno via l'API → refusée PAR LA BASE");
  r = await action(adminJ.cookie, "/rh/collaborateurs/nouveau", "enregistrerCollaborateur", {},
    formulaire({ id: cible.id, nom: "Cible", prenom: "Jetable", poste: "Modifié", taux_horaire: "41,5", manager_id: bruno }));
  const apres = await fiche(cible.id);
  verifier(apres.poste === "Modifié" && Number(apres.taux_horaire) === 41.5, "Admin : modification valide → enregistrée (poste et taux)");
  verifier((await fiche(bruno)).manager_id === null, "Bruno n'a pas été modifié par les tentatives de boucle");
} finally {
  if (projetsCrees.length) await admin.from("projets").delete().in("id", projetsCrees);
  for (const id of comptes) {
    await admin.from("profiles").delete().eq("id", id);
    await admin.auth.admin.deleteUser(id);
  }
  if (fichesCreees.length) await admin.from("collaborateurs").delete().in("id", fichesCreees);
  console.log(`ℹ️  Nettoyage : ${comptes.length} comptes, ${fichesCreees.length} fiche(s), ${projetsCrees.length} projet(s) supprimés`);
}

process.exit(echecs ? 1 : 0);
