# Mini-ERP — règles du projet (à relire à CHAQUE demande)

L'utilisateur est en formation, **pas développeur**. Toujours :
- avancer étape par étape et s'arrêter à la fin de chaque étape ;
- donner les chemins de clic exacts et le texte exact à copier ;
- exécuter soi-même les commandes du terminal (Node est dans `~/.local/node/bin` : préfixer `PATH="$HOME/.local/node/bin:$PATH"`) ;
- vérifier soi-même en conditions réelles (comptes jetables créés puis supprimés) ;
- en cas d'échec, expliquer l'erreur en français simple AVANT de corriger.

## Pile technique
Next.js (App Router) + TypeScript + Tailwind + `@supabase/ssr` / `@supabase/supabase-js`.
Interface **entièrement en français**, y compris noms de fichiers, variables et fonctions.
Clés dans `.env.local` uniquement (jamais dans le code, jamais commitées).

## Base de données — 13 tables, À NE PAS MODIFIER
Ne créer aucune table, n'en renommer aucune, n'ajouter aucune colonne **sans demander**.

- **clients** (id, nom, email_contact, telephone, adresse, created_at)
- **prospects** (id, nom, societe, email, telephone, source, statut ∈ contacte/devis_envoye/gagne/perdu, client_id→clients, created_at)
- **devis** (id, prospect_id→prospects, numero, date_emission, statut ∈ brouillon/envoye/accepte/refuse, total_ht, tva, total_ttc, created_at)
- **devis_lignes** (id, devis_id→devis, designation, quantite, prix_unitaire, montant_ht, created_at)
- **collaborateurs** (id, nom, prenom, email, poste, date_entree, manager_id→collaborateurs, taux_horaire **NOT NULL**, solde_conges, created_at)
- **projets** (id, nom, client_id→clients, devis_id→devis, statut ∈ en_cours/termine/annule, created_at)
- **factures** (id, client_id→clients, numero, date_emission, date_echeance, periode_debut, periode_fin, total_ht, tva, total_ttc, statut ∈ brouillon/emise/envoyee/payee, date_envoi, created_at)
- **temps** (id, collaborateur_id→collaborateurs, projet_id→projets, date_saisie, heures, commentaire, statut ∈ brouillon/soumis/valide, facture_id→factures, created_at)
- **relances** (id, facture_id→factures, date_envoi, canal, message, created_at)
- **conges** (id, collaborateur_id→collaborateurs, type ∈ conges_payes/rtt/sans_solde, date_debut, date_fin, nb_jours, motif, statut ∈ demandee/validee/refusee, valide_par→collaborateurs, created_at)
- **notes_de_frais** (id, collaborateur_id→collaborateurs, date_depense, montant, categorie, justificatif_url, statut ∈ soumise/validee/remboursee, created_at)
- **compteurs** (cle, valeur)
- **profiles** (id→auth.users, email, nom, role ∈ admin/manager/collaborateur, collaborateur_id→collaborateurs, created_at)

## Déjà en place dans la base (ne pas réinventer)
- `prochain_numero(p_cle text, p_prefixe text)` → numéro sans trou type `FAC-2026-0001`. Paramètres **exactement** `p_cle`, `p_prefixe` (sinon PostgREST PGRST202).
- Bucket de stockage **privé** `justificatifs`.
- Déclencheur : chaque nouveau compte crée une ligne `profiles` ; le **tout premier** compte reçoit le rôle admin.
  → Le compte admin de l'utilisateur doit être créé AVANT tout compte de test.
- RLS provisoire « tout connecté lit/écrit tout » : à remplacer table par table, module par module.
- Jeu de données de démonstration.
- `collaborateurs.taux_horaire` est NOT NULL : un taux « absent » n'existe pas, le cas réel est un taux à 0.
- La confirmation par email est ACTIVE : créer les comptes côté serveur (clé secrète) avec `email_confirm: true`.
- Le script initial `schema_mini_erp.sql` a été exécuté à la main : il ne doit **jamais** être placé dans `supabase/migrations/`.

## Migrations — jamais de SQL collé à la main
- Fichiers : `supabase/migrations/AAAAMMJJHHMMSS_description.sql`, appliqués par l'intégration GitHub de Supabase à chaque `git push` sur `main` (Deploy to production ; pas de branches de prévisualisation).
- `supabase/config.toml` MINIMAL : `project_id` et RIEN d'autre (surtout pas de section `[auth]`).
- Une migration s'applique UNE SEULE FOIS : modifier un fichier déjà appliqué ne le rejoue pas → nouveau fichier.
- Un seul fichier par module.
- Rejouable quand même : `create or replace`, `drop policy if exists`, suppression des règles par balayage de `pg_policies` plutôt que par nom.
- AUTO-VÉRIFIANT PAR ASSERTION : terminer chaque migration par un bloc `do $$ ... raise exception ... $$` qui fait échouer le déploiement si un contrôle ne passe pas.
- En plpgsql, ne jamais passer une sous-requête en argument de `raise exception` : passer par une variable.
- Mécanisme VÉRIFIÉ le 14/11/2026 (migration `controle_socle` appliquée). Délai : 2 à 3 minutes après l'envoi.
- Envoi sur GitHub : l'utilisateur clique « Push origin » dans GitHub Desktop (pas de gh, pas de clé SSH).
- Après chaque envoi : `node scripts/verifier-deploiement.mjs --attendre` (verdict de l'app Supabase sur GitHub).
  Le journal « View Logs » de Supabase → Branches reste vide pour la production : ce n'est pas un signe de panne.

## Scripts de vérification (préfixer PATH avec Node)
- `node --env-file=.env.local scripts/verifier-supabase.mjs [--inscription-fermee]` : clés, comptes, profils, état de l'inscription.
- `node --env-file=.env.local scripts/tester-compte-jetable.mjs` : crée un compte non admin, teste les pages, le supprime.
- Le compte admin de l'utilisateur est le seul compte permanent : ne jamais le modifier ni le supprimer dans les tests.

## Sécurité
- Fonctions `mon_role()`, `mon_collaborateur_id()`, `est_admin()` en **security definer** (sinon boucle RLS sur profiles qui bloque toute l'application), avec `set search_path = public`.
- RLS profiles : chacun lit sa fiche, l'admin lit tout ; seul l'admin attribue les rôles.
- RLS collaborateurs : je vois ma fiche, admin et manager voient tout ; seul l'admin crée/modifie.
- Inscription publique FERMÉE : interrupteur Supabase + page supprimée + preuve par tentative refusée.
- Un compte sans `collaborateur_id` ne voit rien sans erreur : rendre cette panne VISIBLE à l'écran.
- La vérification « êtes-vous admin ? » est refaite dans chaque action serveur.
- Un admin ne peut ni se rétrograder ni se révoquer lui-même.

## Avancement des règles RLS
- `profiles`, `collaborateurs` : règles définitives (migration `securite_comptes`, 8 règles) + déclencheur
  `empecher_auto_retrogradation`. Test réel : `node --env-file=.env.local scripts/tester-rls.mjs`.
- Les 11 autres tables : encore sous la règle provisoire « tout connecté lit/écrit tout ».

## Pièges
- `SUPABASE_SERVICE_ROLE_KEY` est SECRÈTE : jamais de préfixe `NEXT_PUBLIC_`, jamais commitée, utilisée seulement côté serveur (`import "server-only"`).
- Un fichier `"use server"` n'exporte QUE des fonctions asynchrones. Les constantes partagées vont dans un fichier ordinaire.
- Ne jamais lancer `npm run build` pendant que `npm run dev` tourne.

## Next.js 16 — particularités de ce projet
- Lire `AGENTS.md` : la doc de la version installée est dans `node_modules/next/dist/docs/`.
- `src/proxy.ts` remplace l'ancien `middleware.ts` : il redirige tout visiteur non connecté vers `/connexion`.
- `cacheComponents` est DÉSACTIVÉ dans `next.config.ts` (tout est rendu à la demande).
- Serveur de dev : `.claude/launch.json` (nom `mini-erp`, port 3000), lancé via `preview_start`.
- Si Turbopack plante (« spawning node pooled process »), arrêter le serveur, `rm -rf .next`, relancer.
- Après création d'une page : `npx next typegen` pour générer `PageProps` / `LayoutProps` avant `tsc`.

## Organisation du code
- `src/lib/supabase/serveur.ts` : client au nom de l'utilisateur (RLS appliquée).
- `src/lib/supabase/admin.ts` : client clé secrète (`server-only`), uniquement après contrôle des droits.
- `src/lib/session.ts` : `obtenirUtilisateurCourant()` (rôle lu dans profiles) et `exigerAdmin()`.
- `src/lib/actions/*.ts` : actions serveur (`"use server"`, fonctions async uniquement).
- `src/lib/roles.ts`, `src/lib/navigation.ts`, `src/lib/formulaires.ts` : constantes partagées.
- Pages protégées dans `src/app/(app)/`, pages publiques dans `src/app/(public)/`.

## Interface
Menu latéral dans l'ordre : Accueil, Commercial, RH, Finance, Absences, Utilisateurs.
Finance et Utilisateurs visibles par un admin uniquement. Email et rôle affichés en permanence en bas du menu.
Toutes les pages sauf connexion sont protégées : visiteur non connecté REDIRIGÉ vers la connexion.
