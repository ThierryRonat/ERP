// Outil de test : contrôle l'état d'un compte et, si MDP_TEST est fourni, tente une connexion.
// Lancement : MDP_TEST=... node --env-file=.env.local scripts/controler-compte.mjs email@exemple.fr

import { createClient } from "@supabase/supabase-js";

const email = process.argv[2]?.toLowerCase();
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);

const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
const compte = data.users.find((u) => u.email === email);
if (!compte) {
  console.log(`ℹ️  Aucun compte de connexion pour ${email}`);
} else {
  const { data: profil } = await admin
    .from("profiles")
    .select("role, collaborateur_id, nom, collaborateurs(nom, prenom)")
    .eq("id", compte.id)
    .maybeSingle();
  const fiche = profil?.collaborateurs;
  console.log(`ℹ️  Compte ${email} : rôle « ${profil?.role} », email confirmé : ${compte.email_confirmed_at ? "oui" : "non"}`);
  console.log(`ℹ️  Rattaché à : ${fiche ? `${fiche.prenom} ${fiche.nom}` : "AUCUNE fiche"}`);
}

const { count } = await admin.from("collaborateurs").select("id", { count: "exact", head: true });
console.log(`ℹ️  Fiches collaborateurs en base : ${count}`);

if (process.env.MDP_TEST) {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
  const { error } = await client.auth.signInWithPassword({ email, password: process.env.MDP_TEST });
  console.log(error ? `❌ Connexion refusée : ${error.message}` : "✅ Connexion réussie avec ce mot de passe");
}
