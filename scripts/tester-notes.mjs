// Test RÉEL des notes de frais et des justificatifs (stockage) en CONTOURNANT l'interface.
// Dépose de vraies images comme le navigateur, vérifie qu'on stocke le CHEMIN (jamais l'adresse signée),
// que l'adresse signée CHANGE à chaque affichage, et qu'un collaborateur ne lit pas le fichier d'un autre.
// Données jetables ; base et stockage identiques avant/après.
// Lancement : node --env-file=.env.local scripts/tester-notes.mjs   (URL_APP=https://… pour le site en ligne)

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node");

const URL_APP = process.env.URL_APP ?? "http://localhost:3000";
const ENLIGNE = !URL_APP.includes("localhost");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const BUCKET = "justificatifs";
// Une vraie image PNG (2 × 2 pixels)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDdKGg2wAAAABJRU5ErkJggg==", "base64");

let echecs = 0;
const verifier = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) echecs++; };
const idActionDe = (nom) => {
  const m = JSON.parse(readFileSync(".next/dev/server/server-reference-manifest.json", "utf8"));
  const t = Object.entries(m.node).find(([, v]) => v.exportedName === nom);
  if (!t) throw new Error(`Action « ${nom} » inconnue (page pas encore compilée ?)`);
  return t[0];
};
const comptes = [], fiches = [];

async function compte(role, nomFiche) {
  const { data: f } = await admin.from("collaborateurs").insert({ nom: nomFiche, prenom: "Jetable", taux_horaire: 0 }).select("id").single();
  fiches.push(f.id);
  const email = `jetable-note-${role}-${Date.now()}-${randomBytes(3).toString("hex")}@exemple.test`;
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
  const api = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options); // = le client du navigateur
  await api.auth.signInWithPassword({ email, password });
  return { fiche: f.id, cookie: [...jarre].map(([n, v]) => `${n}=${v}`).join("; "), api };
}
async function action(cookie, nom, ...args) {
  const corps = await encodeReply(args);
  const r = await fetch(`${URL_APP}/absences?onglet=notes`, {
    method: "POST",
    headers: { cookie, "Next-Action": idActionDe(nom), Accept: "text/x-component",
      ...(typeof corps === "string" ? { "Content-Type": "text/plain;charset=UTF-8" } : {}) },
    body: corps,
  });
  return await r.text();
}
const page = async (cookie) => (await fetch(`${URL_APP}/absences?onglet=notes`, { headers: { cookie } })).text();
const liens = (html) => [...html.matchAll(/data-testid="lien-justificatif"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*data-testid="lien-justificatif"/g)].map((m) => (m[1] ?? m[2]).replace(/&amp;/g, "&"));
const formulaire = (champs) => { const f = new FormData(); for (const [k, v] of Object.entries(champs)) f.set(k, v); return f; };
const notesDe = async (fiche) => (await admin.from("notes_de_frais").select("id, justificatif_url, statut, montant").eq("collaborateur_id", fiche)).data;
const fichiersDe = async (fiche) => ((await admin.storage.from(BUCKET).list(fiche)).data ?? []).map((o) => o.name);
const instantane = async () => JSON.stringify([
  (await admin.from("notes_de_frais").select("id").order("id")).data,
  ((await admin.storage.from(BUCKET).list("", { limit: 1000 })).data ?? []).map((o) => o.name).sort(),
]);
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

const avant = await instantane();
try {
  const A = await compte("collaborateur", "Note-A"), B = await compte("collaborateur", "Note-B"), M = await compte("manager", "Note-M");
  if (!ENLIGNE) await page(M.cookie); // compile la page et ses actions (serveur de développement)

  const deposer = async (C, dossier, nom, contenu = PNG, type = "image/png") =>
    C.api.storage.from(BUCKET).upload(`${dossier}/${nom}`, contenu, { contentType: type, upsert: false });
  const creer = (C, chemin, montant = "42,50") =>
    action(C.cookie, "creerNoteDeFrais", {}, formulaire({ date_depense: "2031-07-02", montant, categorie: "Repas", justificatif: chemin }));

  // ── Dépôt + enregistrement : on stocke le CHEMIN ──
  const fichierA = `${randomUUID()}.png`;
  let e = await deposer(A, A.fiche, fichierA);
  verifier(!e.error, "A dépose sa photo dans SON dossier du stockage");
  let r = await creer(A, `${A.fiche}/${fichierA}`);
  verifier(r.includes("Note de frais enregistrée"), "A : note de frais enregistrée");
  const [noteA] = await notesDe(A.fiche);
  verifier(noteA?.justificatif_url === `${A.fiche}/${fichierA}`, `En base : le CHEMIN « ${noteA?.justificatif_url} »`);
  verifier(!/https?:|token=/.test(noteA?.justificatif_url ?? ""), "En base : AUCUNE adresse signée (ni http, ni token)");

  // ── L'adresse signée est REFABRIQUÉE à chaque affichage ──
  const h1 = await page(A.cookie);
  await pause(1500);
  const h2 = await page(A.cookie);
  const [l1] = liens(h1), [l2] = liens(h2);
  verifier(Boolean(l1 && l2) && l1 !== l2, "Rechargement de la page → l'adresse du justificatif a CHANGÉ");
  console.log(`   1er affichage : …${l1?.slice(-40)}\n   2e affichage  : …${l2?.slice(-40)}`);
  for (const [n, l] of [[1, l1], [2, l2]]) {
    const img = await fetch(l);
    const octets = Buffer.from(await img.arrayBuffer());
    verifier(img.status === 200 && octets.equals(PNG), `Adresse du ${n === 1 ? "1er" : "2e"} affichage : l'image s'ouvre et c'est bien le fichier déposé (${octets.length} octets)`);
  }

  // ── Fichier d'un autre ──
  const fichierB = `${randomUUID()}.png`;
  await deposer(B, B.fiche, fichierB);
  await creer(B, `${B.fiche}/${fichierB}`, "10");
  e = await deposer(A, B.fiche, `${randomUUID()}.png`);
  verifier(Boolean(e.error), "A dépose dans le dossier de B → refusé par le stockage");
  r = await creer(A, `${B.fiche}/${fichierB}`);
  verifier(r.includes("propre dossier"), "A enregistre une note pointant vers le fichier de B → refusé par le serveur");
  e = await A.api.storage.from(BUCKET).createSignedUrl(`${B.fiche}/${fichierB}`, 60);
  verifier(Boolean(e.error), "A demande une adresse signée pour le justificatif de B → refusé");
  e = await A.api.storage.from(BUCKET).download(`${B.fiche}/${fichierB}`);
  verifier(Boolean(e.error), "A télécharge le justificatif de B → refusé");
  e = await A.api.from("notes_de_frais").select("id").eq("collaborateur_id", B.fiche);
  verifier((e.data?.length ?? 0) === 0, "A ne voit pas les notes de B");
  verifier(liens(await page(A.cookie)).length === 1, "Page de A : un seul justificatif (le sien)");

  // ── Contrôles serveur du fichier ──
  r = await creer(A, `${A.fiche}/${randomUUID()}.png`);
  verifier(r.includes("introuvable"), "Note avec un justificatif jamais déposé → refusée");
  const faux = `${randomUUID()}.png`;
  await deposer(A, A.fiche, faux, Buffer.from("ceci n'est pas une image"), "text/plain");
  r = await creer(A, `${A.fiche}/${faux}`);
  verifier(r.includes("photo") && !(await fichiersDe(A.fiche)).includes(faux), "Fichier texte déguisé → refusé ET retiré du stockage");

  // ── Manager : voit, valide, rembourse ; la note est ensuite figée ──
  const pageM = await page(M.cookie);
  verifier(liens(pageM).length >= 2, "Manager : voit les justificatifs de A et de B");
  r = await action(A.cookie, "changerStatutNoteDeFrais", noteA.id, "validee");
  verifier(r.includes("réservé aux managers"), "A : valider sa propre note en direct → refusé");
  r = await action(M.cookie, "changerStatutNoteDeFrais", noteA.id, "validee");
  verifier(r.includes("validée"), "Manager : note validée");
  r = await action(M.cookie, "changerStatutNoteDeFrais", noteA.id, "validee");
  verifier(r.includes("déjà traitée"), "Manager : 2e validation → « déjà traitée », rien n'a changé");
  r = await action(A.cookie, "supprimerNoteDeFrais", noteA.id);
  verifier(r.includes("Seule une note") && (await notesDe(A.fiche)).length === 1, "A : supprimer une note validée → refusé");
  e = await A.api.from("notes_de_frais").update({ montant: 999 }).eq("id", noteA.id).select("id");
  verifier((e.data?.length ?? 0) === 0, "A : modifier le montant d'une note validée via l'API → aucun effet");
  r = await action(M.cookie, "changerStatutNoteDeFrais", noteA.id, "remboursee");
  verifier(r.includes("remboursée") && (await notesDe(A.fiche))[0].statut === "remboursee", "Manager : note marquée remboursée");

  // ── Suppression d'une note soumise : le justificatif part avec ──
  const [noteB] = await notesDe(B.fiche);
  r = await action(B.cookie, "supprimerNoteDeFrais", noteB.id);
  verifier(r.includes("supprimée") && !(await fichiersDe(B.fiche)).includes(fichierB), "B supprime sa note soumise → note ET justificatif supprimés");
} finally {
  if (fiches.length) {
    const { data: n } = await admin.from("notes_de_frais").select("justificatif_url").in("collaborateur_id", fiches);
    await admin.from("notes_de_frais").delete().in("collaborateur_id", fiches);
    const fichiers = [];
    for (const f of fiches) for (const nom of await fichiersDe(f)) fichiers.push(`${f}/${nom}`);
    for (const x of n ?? []) if (x.justificatif_url) fichiers.push(x.justificatif_url);
    if (fichiers.length) await admin.storage.from(BUCKET).remove([...new Set(fichiers)]);
  }
  for (const id of comptes) { await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id); }
  if (fiches.length) await admin.from("collaborateurs").delete().in("id", fiches);
  verifier(avant === (await instantane()), "Base et stockage identiques avant / après");
}
process.exit(echecs ? 1 : 0);
