// Test RÉEL du PDF de facture : télécharge la facture la plus récente, LIT le texte écrit dans le PDF,
// et vérifie les réponses 401 / 403 / 404 / 409 (jamais de 500 pour un refus). Ne crée aucune facture.
// Lancement : node --env-file=.env.local scripts/tester-facture-pdf.mjs [dossier-où-garder-le-pdf]

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "node:crypto";
import { inflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const URL_APP = process.env.URL_APP ?? "http://localhost:3000"; // URL_APP=https://… pour tester le site en ligne
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const dossierSortie = process.argv[2];

let echecs = 0;
const verifier = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) echecs++; };

// Lecture du texte d'un PDF pdfkit (polices standard, encodage WinAnsi)
const WINANSI = { 0x80: "€", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—", 0x85: "…" };
function lireTextePdf(octets) {
  const brut = octets.toString("latin1");
  const morceaux = [];
  for (const m of brut.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let flux;
    try { flux = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { continue; }
    for (const tj of flux.matchAll(/\[(.*?)\]\s*TJ/g)) {
      const hex = [...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join("");
      morceaux.push([...Buffer.from(hex, "hex")].map((o) => WINANSI[o] ?? String.fromCharCode(o)).join(""));
    }
  }
  return morceaux;
}

const comptes = [], fiches = [];
async function compte(role, collaborateurId) {
  const email = `jetable-fpdf-${role}-${Date.now()}-${randomBytes(3).toString("hex")}@exemple.test`;
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
const pdf = (cookie, id, suffixe = "") => fetch(`${URL_APP}/finance/factures/${id}/pdf${suffixe}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });

let tauxOrigine = null, ficheTaux = null;
try {
  const { data: facture } = await admin.from("factures").select("id, numero, date_emission, date_echeance, periode_debut, periode_fin, total_ht, tva, total_ttc").order("created_at", { ascending: false }).limit(1).single();
  const fr = (iso) => iso.split("-").reverse().join("/");
  const euros = (n) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }).replace(/[  ]/g, " ");
  console.log(`ℹ️  Facture testée : ${facture.numero}`);

  const { data: f } = await admin.from("collaborateurs").insert({ nom: "PDF-Admin", prenom: "Jetable", taux_horaire: 0 }).select("id").single(); fiches.push(f.id);
  const cAdmin = await compte("admin", f.id);
  const { data: bruno } = await admin.from("collaborateurs").select("id").eq("nom", "Dubois").single();
  const cManager = await compte("manager", bruno.id);

  // ── Téléchargement par l'admin ──
  const r = await pdf(cAdmin, facture.id);
  const octets = Buffer.from(await r.arrayBuffer());
  verifier(r.status === 200 && r.headers.get("content-type") === "application/pdf", "Admin : PDF reçu (HTTP 200, application/pdf)");
  verifier((r.headers.get("content-disposition") ?? "").startsWith(`attachment; filename="${facture.numero}.pdf"`), `Téléchargement : fichier « ${facture.numero}.pdf »`);
  verifier(octets.subarray(0, 5).toString() === "%PDF-", "Le fichier commence bien par %PDF-");
  if (dossierSortie) writeFileSync(`${dossierSortie}/${facture.numero}.pdf`, octets);

  // ── Lecture du texte écrit dans le PDF ──
  const textes = lireTextePdf(octets);
  const tout = textes.join("\n");
  const contient = (t) => tout.includes(t);
  verifier(contient("FACTURE") && contient(`N° ${facture.numero}`), `En-tête : « FACTURE » et « N° ${facture.numero} »`);
  verifier(contient(`Date d'émission : ${fr(facture.date_emission)}`) && contient(`Échéance : ${fr(facture.date_echeance)}`), `Dates : émission ${fr(facture.date_emission)}, échéance ${fr(facture.date_echeance)}`);
  verifier(contient(`Période : du ${fr(facture.periode_debut)} au ${fr(facture.periode_fin)}`), `Période : du ${fr(facture.periode_debut)} au ${fr(facture.periode_fin)}`);
  verifier(contient("FACTURÉ À") && contient("Axians"), "Client : « FACTURÉ À … Axians »");
  verifier(contient("Refonte Axians") && contient("Lea Moreau") && contient("13,5") && contient("95,00 €"), "Ligne : Refonte Axians — Lea Moreau — 13,5 h — 95,00 €");
  verifier(contient(euros(facture.total_ht)) && contient(euros(facture.tva)) && contient(euros(facture.total_ttc)), `Totaux figés lus : ${euros(facture.total_ht)} / ${euros(facture.tva)} / ${euros(facture.total_ttc)}`);
  verifier(contient("TVA 20 %"), "Libellé « TVA 20 % »");
  verifier(contient("Pénalités de retard") && contient("Indemnité forfaitaire pour frais de recouvrement") && contient("Conditions de paiement"), "Mentions de paiement présentes");
  verifier(contient("SIRET") && contient("TVA intracommunautaire"), "Mentions légales de l'émetteur présentes (SIRET, TVA intracommunautaire…)");
  const sansDates = tout.replace(/\d{2}\/\d{2}\/\d{4}/g, "");
  verifier(!sansDates.includes("/"), "AUCUN « / » parasite hors des dates (piège de l'espace fine U+202F)");
  verifier(!/[  ]/.test(tout), "Aucune espace spéciale (U+00A0 / U+202F) écrite dans le PDF");
  console.log(`ℹ️  Mentions encore « À RENSEIGNER » dans ce PDF : ${(tout.match(/À RENSEIGNER/g) ?? []).length}`);

  // ── Aperçu ──
  const apercu = await pdf(cAdmin, facture.id, "?mode=apercu");
  verifier(apercu.status === 200 && (apercu.headers.get("content-disposition") ?? "").startsWith("inline"), "Visualiser : « inline » → affiché par le navigateur");

  // ── Refus : 401 / 403 / 404, avec une phrase en français ──
  let x = await pdf(null, facture.id);
  verifier(x.status === 401 && (await x.text()).includes("Connexion requise"), "Non connecté → 401 « Connexion requise… »");
  x = await pdf(cManager, facture.id);
  verifier(x.status === 403 && (await x.text()).includes("réservées à l'administrateur"), "Manager → 403 « Accès refusé : les factures sont réservées à l'administrateur. »");
  x = await pdf(cManager, facture.id, "?mode=apercu");
  verifier(x.status === 403, "Manager, aperçu → 403");
  x = await pdf(cAdmin, "00000000-0000-0000-0000-000000000000");
  verifier(x.status === 404 && (await x.text()).includes("introuvable"), "Facture inexistante → 404 « Facture introuvable. »");
  x = await pdf(cAdmin, "pas-un-identifiant");
  verifier(x.status === 404, "Identifiant farfelu → 404 (pas de 500)");

  // ── Écart de taux → 409, puis retour à la normale ──
  const { data: t } = await admin.from("temps").select("collaborateur_id").eq("facture_id", facture.id).limit(1).single();
  ficheTaux = t.collaborateur_id;
  tauxOrigine = (await admin.from("collaborateurs").select("taux_horaire").eq("id", ficheTaux).single()).data.taux_horaire;
  await admin.from("collaborateurs").update({ taux_horaire: Number(tauxOrigine) + 5 }).eq("id", ficheTaux);
  x = await pdf(cAdmin, facture.id);
  verifier(x.status === 409 && (await x.text()).includes("PDF bloqué"), "Taux modifié après émission → 409 « PDF bloqué… »");
  await admin.from("collaborateurs").update({ taux_horaire: tauxOrigine }).eq("id", ficheTaux);
  tauxOrigine = null;
  x = await pdf(cAdmin, facture.id);
  verifier(x.status === 200, "Taux remis → PDF de nouveau disponible");
} finally {
  if (tauxOrigine !== null) await admin.from("collaborateurs").update({ taux_horaire: tauxOrigine }).eq("id", ficheTaux);
  for (const id of comptes) { await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id); }
  if (fiches.length) await admin.from("collaborateurs").delete().in("id", fiches);
  console.log(`ℹ️  Nettoyage : ${comptes.length} comptes et ${fiches.length} fiche supprimés`);
}

process.exit(echecs ? 1 : 0);
