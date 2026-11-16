// Vérifie le site EN LIGNE sans rien envoyer : pages publiques, protection des fichiers, et réglages
// présents sur Vercel (clé secrète Supabase, mentions légales, variables d'email) via la page d'une facture.
// Lancement : node --env-file=.env.local scripts/verifier-vercel.mjs https://erp-ashen-six.vercel.app

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "node:crypto";

const B = (process.argv[2] ?? "https://erp-ashen-six.vercel.app").replace(/\/$/, "");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const o = { auth: { persistSession: false, autoRefreshToken: false } };
const a = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, o);
let echecs = 0;
const v = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) echecs++; };

const brut = async (chemin) => fetch(B + chemin, { redirect: "manual" });
let r = await brut("/connexion");
v(r.status === 200 && (await r.text()).includes("Connectez-vous"), `${B}/connexion : page de connexion publique`);
r = await brut("/finance");
v(r.status === 307 && (r.headers.get("location") ?? "").includes("/connexion"), "Visiteur non connecté → renvoyé vers la connexion");

const { data: fac } = await a.from("factures").select("id").order("created_at", { ascending: false }).limit(1).single();
r = await brut(`/finance/factures/${fac.id}/pdf`);
v(r.status === 401, "PDF de facture sans connexion → 401");

const { data: f } = await a.from("collaborateurs").insert({ nom: "Vercel", prenom: "Jetable", taux_horaire: 0 }).select("id").single();
const email = `jetable-vercel-${Date.now()}@exemple.test`, password = randomBytes(18).toString("base64url");
const { data: u } = await a.auth.admin.createUser({ email, password, email_confirm: true });
try {
  await a.from("profiles").update({ role: "admin", collaborateur_id: f.id }).eq("id", u.user.id);
  const jarre = new Map();
  const s = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...jarre].map(([name, value]) => ({ name, value })),
      setAll: (l) => l.forEach(({ name, value }) => (value ? jarre.set(name, value) : jarre.delete(name))),
    },
  });
  await s.auth.signInWithPassword({ email, password });
  const cookie = [...jarre].map(([n, x]) => `${n}=${x}`).join("; ");
  const html = await (await fetch(`${B}/finance/factures/${fac.id}`, { headers: { cookie } })).text();
  v(html.includes("controle-ok"), "Page facture : lignes recalculées = montants figés (clé secrète Supabase présente sur Vercel)");
  v(!html.includes("alerte-mentions"), "Mentions légales complètes et cohérentes");
  v(!html.includes("RESEND_API_KEY"), "RESEND_API_KEY présente sur Vercel");
  v(html.includes("mode-test-email") && html.includes(process.env.EMAIL_DESTINATAIRE_TEST ?? "?"), `Mode test actif vers ${process.env.EMAIL_DESTINATAIRE_TEST}`);
  v(!html.includes("Envoi impossible"), "Bouton « Envoyer » disponible");
  const m = html.match(/Envoi impossible[^<]*(?:<!-- -->[^<]*)*/);
  if (m) console.log("   message affiché :", m[0].replace(/<!-- -->/g, "").replace(/&#x27;/g, "'"));
  const pdf = await fetch(`${B}/finance/factures/${fac.id}/pdf`, { headers: { cookie } });
  v(pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf", "PDF de facture téléchargé en ligne (admin)");
} finally {
  await a.from("profiles").delete().eq("id", u.user.id);
  await a.auth.admin.deleteUser(u.user.id);
  await a.from("collaborateurs").delete().eq("id", f.id);
  console.log("ℹ️  compte jetable supprimé — aucun email envoyé");
}
process.exit(echecs ? 1 : 0);
