// Test RÉEL de l'envoi de facture par email (Resend), en MODE TEST : UN email part vers
// EMAIL_DESTINATAIRE_TEST (jamais au client). Vérifie : refus du manager, statut NON modifié en mode test,
// email accepté par Resend avec le PDF en pièce jointe.
// Prérequis : serveur de dev (port 3000), RESEND_API_KEY et EMAIL_DESTINATAIRE_TEST dans .env.local.
// Lancement : node --env-file=.env.local scripts/tester-email.mjs

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { Resend } from "resend";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node");

const URL_APP = "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const resend = new Resend(process.env.RESEND_API_KEY);
const destinataireTest = process.env.EMAIL_DESTINATAIRE_TEST;

let echecs = 0;
const verifier = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) echecs++; };
const idActionDe = (nom) => {
  const m = JSON.parse(readFileSync(".next/dev/server/server-reference-manifest.json", "utf8"));
  const t = Object.entries(m.node).find(([, v]) => v.exportedName === nom);
  if (!t) throw new Error(`Action « ${nom} » inconnue (page pas encore compilée ?)`);
  return t[0];
};
const comptes = [], fiches = [];
async function compte(role, collaborateurId) {
  const email = `jetable-mail-${role}-${Date.now()}-${randomBytes(3).toString("hex")}@exemple.test`;
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
async function action(cookie, chemin, nom, ...args) {
  await fetch(URL_APP + chemin, { headers: { cookie }, redirect: "manual" }); // compile la page si besoin
  const corps = await encodeReply(args);
  const r = await fetch(URL_APP + chemin, {
    method: "POST",
    headers: { cookie, "Next-Action": idActionDe(nom), Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8" },
    body: corps,
  });
  return await r.text();
}
const etat = async (id) => (await admin.from("factures").select("statut, date_envoi").eq("id", id).single()).data;

try {
  if (!destinataireTest) throw new Error("EMAIL_DESTINATAIRE_TEST est vide : ce test refuse d'envoyer à un vrai client.");
  const { data: facture } = await admin.from("factures").select("id, numero, clients(email_contact)").order("created_at", { ascending: false }).limit(1).single();
  const avant = await etat(facture.id);
  console.log(`ℹ️  Facture : ${facture.numero} (statut ${avant.statut}) ; client ${facture.clients.email_contact} ; mode test → ${destinataireTest}`);

  const { data: f } = await admin.from("collaborateurs").insert({ nom: "Mail-Admin", prenom: "Jetable", taux_horaire: 0 }).select("id").single(); fiches.push(f.id);
  const cAdmin = await compte("admin", f.id);
  const { data: bruno } = await admin.from("collaborateurs").select("id").eq("nom", "Dubois").single();
  const cManager = await compte("manager", bruno.id);
  const chemin = `/finance/factures/${facture.id}`;

  // La page de la facture (seule à utiliser cette action) est d'abord ouverte par l'admin pour être compilée
  await fetch(URL_APP + chemin, { headers: { cookie: cAdmin } });

  // Manager : refusé, rien envoyé
  let r = await action(cManager, chemin, "envoyerFacture", facture.id);
  verifier(r.includes("réservée à l'administrateur"), "Manager : action envoyerFacture en direct → refusée");

  // Page : bandeau mode test
  const page = await (await fetch(URL_APP + chemin, { headers: { cookie: cAdmin } })).text();
  verifier(page.includes('data-testid="mode-test-email"') && page.includes(destinataireTest), `Page facture : bandeau « Mode test » vers ${destinataireTest}`);

  // Envoi réel en mode test
  const debut = new Date();
  r = await action(cAdmin, chemin, "envoyerFacture", facture.id);
  verifier(r.includes("Envoi de TEST réussi") && r.includes(destinataireTest), `Admin : envoi de test réussi vers ${destinataireTest}`);
  const apres = await etat(facture.id);
  verifier(apres.statut === avant.statut && apres.date_envoi === avant.date_envoi, `Mode test : statut et date d'envoi INCHANGÉS (${apres.statut}, ${apres.date_envoi ?? "aucune date"})`);

  // Côté Resend : l'email existe, au bon destinataire, avec la pièce jointe
  await new Promise((ok) => setTimeout(ok, 3000));
  const { data: liste } = await resend.emails.list({ limit: 5 });
  const email = (liste?.data ?? []).find((e) => new Date(e.created_at) >= new Date(debut.getTime() - 5000) && e.subject.includes(facture.numero));
  verifier(Boolean(email), `Resend : email « ${email?.subject ?? "introuvable"} » enregistré`);
  if (email) {
    verifier(email.to.includes(destinataireTest) && !email.to.includes(facture.clients.email_contact), `Resend : destinataire = ${email.to.join(", ")} (le client n'est PAS destinataire)`);
    const { data: pj } = await resend.emails.attachments.list({ emailId: email.id });
    const fichiers = (pj?.data ?? []).map((a) => `${a.filename} (${a.size ?? "?"} octets)`);
    verifier(fichiers.some((n) => n.startsWith(`${facture.numero}.pdf`)), `Resend : pièce jointe ${fichiers.join(", ") || "aucune"}`);
    const { data: detail } = await resend.emails.get(email.id);
    console.log(`ℹ️  État de livraison chez Resend : ${detail?.last_event ?? "inconnu"}`);
  }
} finally {
  for (const id of comptes) { await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id); }
  if (fiches.length) await admin.from("collaborateurs").delete().in("id", fiches);
  console.log(`ℹ️  Nettoyage : ${comptes.length} comptes et ${fiches.length} fiche supprimés`);
}

process.exit(echecs ? 1 : 0);
