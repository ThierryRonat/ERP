// Test RÉEL des règles RLS de profiles et collaborateurs, avec 3 comptes JETABLES
// (sans fiche / collaborateur rattaché / manager), supprimés à la fin.
// Lancement : node --env-file=.env.local scripts/tester-rls.mjs

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const cleAnonyme = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);

let echecs = 0;
const verifier = (condition, message) => {
  console.log(`${condition ? "✅" : "❌"} ${message}`);
  if (!condition) echecs++;
};

const crees = [];
const comptesAvant = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.length;

async function compteJetable(role, collaborateurId) {
  const email = `jetable-${role}-${Date.now()}@exemple.test`;
  const motDePasse = randomBytes(18).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password: motDePasse, email_confirm: true });
  if (error) throw new Error(`Création impossible (${role}) : ${error.message}`);
  crees.push(data.user.id);
  const { error: e2 } = await admin
    .from("profiles")
    .update({ role, collaborateur_id: collaborateurId })
    .eq("id", data.user.id);
  if (e2) throw new Error(`Mise à jour du profil impossible : ${e2.message}`);
  const client = createClient(url, cleAnonyme, options);
  const { error: e3 } = await client.auth.signInWithPassword({ email, password: motDePasse });
  if (e3) throw new Error(`Connexion impossible (${role}) : ${e3.message}`);
  return { client, id: data.user.id };
}

try {
  const { data: tous, error } = await admin.from("collaborateurs").select("id, nom").order("nom");
  if (error) throw new Error(error.message);
  const total = tous.length;
  const fiche = tous[0];
  console.log(`ℹ️  ${total} collaborateurs en base ; fiche de test : ${fiche.nom}`);

  // 1. Compte SANS fiche
  {
    const { client, id } = await compteJetable("collaborateur", null);
    const { data: c } = await client.from("collaborateurs").select("id");
    verifier(c?.length === 0, `Sans fiche : voit 0 collaborateur (vu : ${c?.length})`);
    const { data: p } = await client.from("profiles").select("id");
    verifier(p?.length === 1 && p[0].id === id, `Sans fiche : ne voit que son propre profil (vu : ${p?.length})`);
  }

  // 2. Collaborateur RATTACHÉ
  {
    const { client, id } = await compteJetable("collaborateur", fiche.id);
    const { data: c } = await client.from("collaborateurs").select("id");
    verifier(c?.length === 1 && c[0].id === fiche.id, `Collaborateur : voit 1 seule fiche, la sienne (vu : ${c?.length})`);
    const { data: p } = await client.from("profiles").select("id");
    verifier(p?.length === 1, `Collaborateur : voit 1 seul profil (vu : ${p?.length})`);
    const { data: r } = await client.rpc("mon_role");
    verifier(r === "collaborateur", `mon_role() = « ${r} »`);
    const { data: cid } = await client.rpc("mon_collaborateur_id");
    verifier(cid === fiche.id, "mon_collaborateur_id() = sa fiche");
    const { data: adm } = await client.rpc("est_admin");
    verifier(adm === false, "est_admin() = faux");

    const { data: modifRole } = await client.from("profiles").update({ role: "admin" }).eq("id", id).select();
    const { data: verif } = await admin.from("profiles").select("role").eq("id", id).single();
    verifier((modifRole?.length ?? 0) === 0 && verif.role === "collaborateur", "Collaborateur : ne peut PAS se donner le rôle admin");

    const { data: modifFiche } = await client.from("collaborateurs").update({ poste: "piraté" }).eq("id", fiche.id).select();
    verifier((modifFiche?.length ?? 0) === 0, "Collaborateur : ne peut PAS modifier sa fiche");

    const { error: eIns } = await client.from("collaborateurs").insert({ nom: "Intrus", prenom: "Test", taux_horaire: 0 });
    verifier(Boolean(eIns), "Collaborateur : ne peut PAS créer de fiche");
  }

  // 3. MANAGER
  {
    const { client } = await compteJetable("manager", fiche.id);
    const { data: c } = await client.from("collaborateurs").select("id");
    verifier(c?.length === total, `Manager : voit les ${total} fiches (vu : ${c?.length})`);
    const { data: p } = await client.from("profiles").select("id");
    verifier(p?.length === 1, `Manager : ne voit que son propre profil (vu : ${p?.length})`);
    const { data: modifFiche } = await client.from("collaborateurs").update({ poste: "piraté" }).eq("id", fiche.id).select();
    verifier((modifFiche?.length ?? 0) === 0, "Manager : ne peut PAS modifier une fiche");
  }

  // 4. Anonyme (pas connecté)
  {
    const anonyme = createClient(url, cleAnonyme, options);
    const { data: c } = await anonyme.from("collaborateurs").select("id");
    verifier((c?.length ?? 0) === 0, "Visiteur non connecté : voit 0 collaborateur");
  }
} finally {
  for (const id of crees) {
    await admin.from("profiles").delete().eq("id", id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) verifier(false, `Suppression du compte jetable ${id} : ${error.message}`);
  }
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  verifier(data.users.length === comptesAvant, `Comptes jetables supprimés (${data.users.length} comptes, comme avant le test)`);
}

process.exit(echecs ? 1 : 0);
