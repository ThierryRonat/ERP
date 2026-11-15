// Test RÉEL du PDF de devis : crée un devis « piège » (milliers, millions, accents, espace fine,
// émoji, désignation très longue), le télécharge avec différents comptes JETABLES, puis LIT le texte
// réellement écrit dans le PDF. Tout est supprimé à la fin et le compteur remis à sa valeur de départ.
// Lancement : node --env-file=.env.local scripts/tester-pdf.mjs [dossier-où-garder-le-pdf]

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "node:crypto";
import { inflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const URL_APP = "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const dossierSortie = process.argv[2];

let echecs = 0;
const verifier = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) echecs++; };

// ── Lecture du texte d'un PDF produit par pdfkit (polices standard, encodage WinAnsi) ──
const WINANSI = { 0x80: "€", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—", 0x85: "…" };
function lireTextePdf(octets) {
  const brut = octets.toString("latin1");
  const blocs = [];
  for (const m of brut.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { blocs.push(inflateSync(Buffer.from(m[1], "latin1")).toString("latin1")); } catch { /* flux non texte */ }
  }
  const morceaux = [];
  for (const b of blocs) {
    for (const tj of b.matchAll(/\[(.*?)\]\s*TJ/g)) {
      const hex = [...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join("");
      const octetsTexte = Buffer.from(hex, "hex");
      morceaux.push([...octetsTexte].map((o) => WINANSI[o] ?? String.fromCharCode(o)).join(""));
    }
  }
  return morceaux;
}

const comptes = [];
async function compte(role, collaborateurId) {
  const email = `jetable-pdf-${role}-${Date.now()}@exemple.test`;
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
const telecharger = (cookie, id, suffixe = "") => fetch(`${URL_APP}/commercial/devis/${id}/pdf${suffixe}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });

const cleCompteur = `devis_${new Date().getFullYear()}`;
const compteurDepart = (await admin.from("compteurs").select("valeur").eq("cle", cleCompteur).maybeSingle()).data?.valeur ?? null;
let prospectId, devisId;

try {
  const { data: fiches } = await admin.from("collaborateurs").select("id").order("nom");
  const { data: p } = await admin.from("prospects")
    .insert({ nom: "Prospect PDF jetable", societe: "Société Éàç & Fils", email: "pdf@exemple.test", telephone: "01 23 45 67 89" })
    .select("id").single();
  prospectId = p.id;

  const manager = await compte("manager", fiches[0].id);
  const longue = "Accompagnement à la mise en conformité RGPD : cartographie des traitements, registre, analyses d'impact, " +
    "rédaction des mentions d'information et formation des équipes — forfait 1 000 heures 🚀";
  const { data: id, error } = await manager.api.rpc("creer_devis", {
    p_prospect_id: prospectId,
    p_taux_tva: "20",
    p_lignes: [
      { designation: "Audit de sécurité", quantite: "2", prix_unitaire: "641.25" },
      { designation: longue, quantite: "3", prix_unitaire: "99.99" },
      { designation: "Licence perpétuelle", quantite: "1", prix_unitaire: "1234567.89" },
      { designation: "Formation", quantite: "1.5", prix_unitaire: "0.33" },
    ],
  });
  if (error) throw new Error(`Création du devis de test impossible : ${error.message}`);
  devisId = id;
  const { data: devis } = await admin.from("devis").select("numero, total_ht, tva, total_ttc").eq("id", id).single();
  console.log(`ℹ️  Devis de test ${devis.numero} : HT ${devis.total_ht} / TVA ${devis.tva} / TTC ${devis.total_ttc}`);

  // ── Téléchargement par un manager ──
  const r = await telecharger(manager.cookie, id);
  const octets = Buffer.from(await r.arrayBuffer());
  verifier(r.status === 200 && r.headers.get("content-type") === "application/pdf", "Manager : PDF téléchargé (HTTP 200, application/pdf)");
  verifier((r.headers.get("content-disposition") ?? "").includes(`${devis.numero}.pdf`), `Nom du fichier : ${devis.numero}.pdf`);
  verifier(octets.subarray(0, 5).toString() === "%PDF-", "Le fichier commence bien par %PDF-");
  if (dossierSortie) writeFileSync(`${dossierSortie}/${devis.numero}.pdf`, octets);

  // ── Lecture du texte écrit dans le PDF ──
  const textes = lireTextePdf(octets);
  const tout = textes.join("\n");
  const contient = (t) => textes.some((x) => x.includes(t));
  verifier(contient("DEVIS") && contient(`N° ${devis.numero}`), `En-tête : « DEVIS » et « N° ${devis.numero} »`);
  verifier(contient("Prospect PDF jetable") && contient("Société Éàç & Fils"), "Destinataire avec accents : « Société Éàç & Fils »");
  verifier(contient("1 282,50 €"), "Montant de ligne lu : « 1 282,50 € »");
  verifier(contient("1 234 567,89 €"), "Million lu : « 1 234 567,89 € »");
  verifier(contient("1 236 150,86 €") && contient("247 230,17 €") && contient("1 483 381,03 €"), "Totaux lus : 1 236 150,86 € / 247 230,17 € / 1 483 381,03 €");
  verifier(contient("TVA (20 %)"), "Taux affiché : « TVA (20 %) »");
  // La date (jj/mm/aaaa) contient des « / » légitimes : on la retire avant de chercher le piège.
  const sansDate = tout.replace(/Date : \d{2}\/\d{2}\/\d{4}/, "");
  verifier(!sansDate.includes("/"), "AUCUN « / » parasite hors de la date (piège de l'espace fine U+202F)");
  verifier(tout.includes("forfait 1 000 heures"), "Espace fine dans une désignation remplacée : « forfait 1 000 heures »");
  verifier(tout.includes("heures ?"), "Émoji impossible à imprimer remplacé par « ? »");
  verifier(textes.findIndex((t) => t.includes("Audit")) < textes.findIndex((t) => t.includes("Licence")), "Lignes dans l'ordre de saisie");

  // ── Droits ──
  const collab = await compte("collaborateur", fiches[1].id);
  verifier((await telecharger(collab.cookie, id)).status === 200, "Collaborateur rattaché : peut télécharger (lecture seule)");
  const orphelin = await compte("collaborateur", null);
  verifier((await telecharger(orphelin.cookie, id)).status === 404, "Compte non rattaché : 404 (la RLS masque le devis)");
  const anonyme = await telecharger(null, id);
  verifier(anonyme.status === 307 && (anonyme.headers.get("location") ?? "").includes("/connexion"), "Visiteur non connecté : redirigé vers la connexion");
  verifier((await telecharger(manager.cookie, "00000000-0000-0000-0000-000000000000")).status === 404, "Devis inexistant : 404");

  // ── Visualisation (aperçu dans le navigateur) ──
  const apercu = await telecharger(manager.cookie, id, "?mode=apercu");
  const octetsApercu = Buffer.from(await apercu.arrayBuffer());
  verifier(apercu.status === 200 && apercu.headers.get("content-type") === "application/pdf", "Visualiser : PDF renvoyé (HTTP 200, application/pdf)");
  verifier((apercu.headers.get("content-disposition") ?? "").startsWith("inline"), `Visualiser : « inline » → le navigateur l'AFFICHE (${apercu.headers.get("content-disposition")})`);
  verifier((r.headers.get("content-disposition") ?? "").startsWith("attachment"), "Télécharger : « attachment » → le navigateur le TÉLÉCHARGE");
  verifier(lireTextePdf(octetsApercu).some((t) => t.includes("1 483 381,03 €")), "Visualiser : même contenu que le téléchargement (totaux relus)");
  verifier((await telecharger(collab.cookie, id, "?mode=apercu")).status === 200, "Visualiser : collaborateur rattaché → autorisé (lecture seule)");
  verifier((await telecharger(orphelin.cookie, id, "?mode=apercu")).status === 404, "Visualiser : compte non rattaché → 404");
  const anonymeApercu = await telecharger(null, id, "?mode=apercu");
  verifier(anonymeApercu.status === 307 && (anonymeApercu.headers.get("location") ?? "").includes("/connexion"), "Visualiser : visiteur non connecté → redirigé vers la connexion");
} finally {
  if (devisId) {
    await admin.from("devis_lignes").delete().eq("devis_id", devisId);
    await admin.from("devis").delete().eq("id", devisId);
  }
  if (prospectId) await admin.from("prospects").delete().eq("id", prospectId);
  for (const id of comptes) {
    await admin.from("profiles").delete().eq("id", id);
    await admin.auth.admin.deleteUser(id);
  }
  if (compteurDepart === null) await admin.from("compteurs").delete().eq("cle", cleCompteur);
  else await admin.from("compteurs").update({ valeur: compteurDepart }).eq("cle", cleCompteur);
  console.log(`ℹ️  Nettoyage : devis, prospect et ${comptes.length} comptes supprimés ; compteur remis à ${compteurDepart ?? "absent"}`);
}

process.exit(echecs ? 1 : 0);
