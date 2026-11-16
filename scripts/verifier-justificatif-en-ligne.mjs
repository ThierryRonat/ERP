// Vérifie, sur le site EN LIGNE, qu'un justificatif reste visible après rechargement : dépôt comme le navigateur,
// note enregistrée par l'API (règles de la base), page affichée deux fois → adresse différente, image qui s'ouvre.
// Un autre collaborateur ne peut pas la lire. Données jetables, tout est supprimé à la fin.
// Lancement : node --env-file=.env.local scripts/verifier-justificatif-en-ligne.mjs https://erp-ashen-six.vercel.app

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomBytes, randomUUID } from "node:crypto";

const B = (process.argv[2] ?? "https://erp-ashen-six.vercel.app").replace(/\/$/, "");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const o = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, o);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDdKGg2wAAAABJRU5ErkJggg==", "base64");
let echecs = 0;
const v = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) echecs++; };
const comptes = [], fiches = [], fichiers = [];

async function compte(nom) {
  const { data: f } = await admin.from("collaborateurs").insert({ nom, prenom: "Jetable", taux_horaire: 0 }).select("id").single();
  fiches.push(f.id);
  const email = `jetable-enligne-${Date.now()}-${randomBytes(3).toString("hex")}@exemple.test`, password = randomBytes(18).toString("base64url");
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  comptes.push(data.user.id);
  await admin.from("profiles").update({ role: "collaborateur", collaborateur_id: f.id }).eq("id", data.user.id);
  const jarre = new Map();
  const s = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [...jarre].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => (value ? jarre.set(name, value) : jarre.delete(name))) },
  });
  await s.auth.signInWithPassword({ email, password });
  const api = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, o);
  await api.auth.signInWithPassword({ email, password });
  return { fiche: f.id, cookie: [...jarre].map(([n, x]) => `${n}=${x}`).join("; "), api };
}
const lien = (html) => (html.match(/href="([^"]+)"[^>]*data-testid="lien-justificatif"|data-testid="lien-justificatif"[^>]*href="([^"]+)"/) ?? []).slice(1).find(Boolean)?.replace(/&amp;/g, "&");

try {
  const A = await compte("EnLigne-A"), Bb = await compte("EnLigne-B");
  const chemin = `${A.fiche}/${randomUUID()}.png`;
  let e = await A.api.storage.from("justificatifs").upload(chemin, PNG, { contentType: "image/png" });
  v(!e.error, "Dépôt de la photo dans le dossier de A"); if (!e.error) fichiers.push(chemin);
  e = await A.api.from("notes_de_frais").insert({ collaborateur_id: A.fiche, date_depense: "2031-07-02", montant: 12.3, categorie: "Repas", justificatif_url: chemin });
  v(!e.error, "Note enregistrée avec le CHEMIN du fichier");

  const h1 = await (await fetch(`${B}/absences?onglet=notes`, { headers: { cookie: A.cookie } })).text();
  await new Promise((ok) => setTimeout(ok, 1500));
  const h2 = await (await fetch(`${B}/absences?onglet=notes`, { headers: { cookie: A.cookie } })).text();
  const l1 = lien(h1), l2 = lien(h2);
  v(Boolean(l1 && l2) && l1 !== l2, `${B} : rechargement → adresse du justificatif DIFFÉRENTE`);
  for (const [n, l] of [["1er", l1], ["2e", l2]]) {
    const r = l ? await fetch(l) : null;
    v(Boolean(r) && r.status === 200 && Buffer.from(await r.arrayBuffer()).equals(PNG), `${n} affichage : l'image s'ouvre (c'est bien le fichier déposé)`);
  }
  const hB = await (await fetch(`${B}/absences?onglet=notes`, { headers: { cookie: Bb.cookie } })).text();
  v(!lien(hB), "En ligne, un autre collaborateur ne voit aucun justificatif de A");
  e = await Bb.api.storage.from("justificatifs").createSignedUrl(chemin, 60);
  v(Boolean(e.error), "Un autre collaborateur demande l'adresse du justificatif de A → refusé");
} finally {
  if (fiches.length) await admin.from("notes_de_frais").delete().in("collaborateur_id", fiches);
  if (fichiers.length) await admin.storage.from("justificatifs").remove(fichiers);
  for (const id of comptes) { await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id); }
  if (fiches.length) await admin.from("collaborateurs").delete().in("id", fiches);
  console.log("ℹ️  nettoyage : note, fichier, comptes et fiches supprimés");
}
process.exit(echecs ? 1 : 0);
