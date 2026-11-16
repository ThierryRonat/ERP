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

- AVANT de faire envoyer une migration : la rejouer sur une base PostgreSQL locale jetable (PGlite) avec un
  socle simplifié (`essai-sql/socle.sql` + `essayer.mjs` dans le dossier scratchpad ; à recréer si effacé).
  Le vrai corps de `prochain_numero` n'y est qu'imité.

## Conventions métier (décidées avec l'utilisateur)
- `devis.tva` (et `factures.tva`) = MONTANT de TVA en euros. `total_ttc = total_ht + tva`. Le taux n'est pas stocké :
  pour l'afficher, le recalculer (tva / total_ht × 100). Arrondi au centime par ligne, puis TVA arrondie au centime.
- Un devis naît UNIQUEMENT par la fonction SQL `creer_devis(p_prospect_id, p_taux_tva, p_lignes jsonb)` :
  numéro + devis + lignes dans une seule transaction (aucun trou). Seul `devis.statut` est modifiable par l'API.
- `prochain_numero` n'est plus appelable par anon/authenticated ; `compteurs` n'est plus accessible par l'API.
- PIÈGE VÉCU : le vrai `prochain_numero` cite `compteurs` SANS préfixe `public.`. Toute fonction qui l'appelle doit
  avoir `set search_path = public, pg_temp` (avec `search_path = ''` → « relation compteurs does not exist »).
- Ordre des lignes de devis : `devis_lignes.created_at` (posé avec clock_timestamp() par creer_devis).
- Devis passé à « accepte » (INSERT ou UPDATE, même depuis l'éditeur Supabase) → déclencheur
  `devis_accepte_creer_projet` (security definer) : client créé si le prospect n'en a pas, prospect « gagne »,
  projet « <société ou nom> — <numéro> » en_cours rattaché au client ET au devis. Rejouable (verrou + pas de
  doublon), ne supprime jamais rien (repasser en refusé ne touche à rien).
- Manager : déclencheur `verifier_manager` → jamais soi-même, jamais de boucle.
- `collaborateurs.taux_horaire` : AUCUN droit SELECT pour anon/authenticated (droit retiré sur la table puis redonné
  colonne par colonne). Lecture uniquement côté serveur avec la clé secrète. Écriture permise (RLS admin).
  → Ne JAMAIS faire `select("*")` ni `.select()` sans colonnes sur collaborateurs avec le client de session.
- Temps : chacun saisit LES SIENS (même manager/admin), uniquement sur un projet en_cours, statut brouillon/soumis,
  0 < heures ≤ 24. L'auteur modifie/supprime tant que non validé ; seuls manager/admin passent en « valide ».
  `temps.facture_id` et `temps.collaborateur_id` ne sont pas modifiables par l'API.
- Projets : lus par tout compte rattaché ; créés/modifiés par l'admin seul. Clients : manager et admin seulement.
- Finance (migration `finance`) : PAS de table de lignes de facture (voulu) ; une facture = ses temps (temps.facture_id).
  Une facture naît UNIQUEMENT par `generer_facture(p_client_id, p_mois)` (admin, security definer) : contrôles « rien à
  facturer » et « taux à 0 » AVANT prochain_numero('facture','FAC') ; rattachement des temps libres PUIS totaux
  (ligne = projet × taux, round(heures × taux, 2)), TVA 20 % (montant), échéance +30 j, statut brouillon.
- Déclencheurs (valables AUSSI avec la clé secrète) : numéro immuable, aucune suppression ni TRUNCATE de factures,
  montants/client/période figés hors brouillon, pas de retour en brouillon ; temps facturé ni modifiable, ni supprimable,
  ni détachable ; seul un temps validé peut être rattaché.
  → Un test ne peut JAMAIS supprimer une facture : toute facture réelle créée en test reste définitivement.
- Factures et relances : admin seul (lecture et écriture) ; API : seuls `statut` et `date_envoi` modifiables.

## Scripts de vérification (préfixer PATH avec Node)
- `node --env-file=.env.local scripts/verifier-supabase.mjs [--inscription-fermee]` : clés, comptes, profils, état de l'inscription.
- `node --env-file=.env.local scripts/tester-compte-jetable.mjs` : crée un compte non admin, teste les pages, le supprime.
- `node --env-file=.env.local scripts/tester-actions-directes.mjs <id-compte-jetable>` : appelle les actions
  serveur de /utilisateurs sans passer par l'écran (non-admin, admin sur lui-même) et vérifie les refus.
- `MDP_TEST=... node --env-file=.env.local scripts/controler-compte.mjs <email>` : état d'un compte + test de connexion.
- `node --env-file=.env.local scripts/tester-commercial.mjs` : droits du module Commercial (collaborateur/manager
  jetables, actions appelées en direct via encodeReply, attaques API). Nettoie et REMET LE COMPTEUR à sa valeur de départ.
- Tests qui créent des devis : toujours supprimer les devis de test ET remettre `compteurs` (clé `devis_AAAA`)
  à sa valeur d'avant, sinon le premier vrai devis n'aura pas le bon numéro. Ne jamais le faire si un vrai devis
  a été créé entre-temps (trou).
- `node --env-file=.env.local scripts/tester-rh.mjs` : module RH en contournant l'interface (collaborateur, manager,
  admin jetables ; taux_horaire, garde-fou manager via l'API, actions en direct). Nettoie fiches/projets/comptes.
- `node --env-file=.env.local scripts/tester-temps.mjs` : saisie des temps en contournant l'interface (listes =
  règle d'insertion, actions et API attaquées, validation, base identique avant/après).
- `node --env-file=.env.local scripts/tester-fiche-collaborateur.mjs` : fiche en consultation (droits, totaux semaine
  et par projet, aucun taux), données jetables, base identique avant/après.
- Calculs monétaires : `src/lib/montants.ts` (BigInt au centième, arrondi identique à PostgreSQL). Jamais de float.
- `node --env-file=.env.local scripts/tester-pdf.mjs [dossier]` : devis piège → PDF téléchargé et son TEXTE relu
  (décodage WinAnsi des flux pdfkit). Nettoie et remet le compteur. Lire aussi le PDF avec l'outil Read (visuel).

## PDF (devis)
- `src/lib/pdf/devis-pdf.ts` : pdfkit en variante STANDALONE, importée par chemin
  (`require("../../../node_modules/pdfkit/js/pdfkit.standalone.js")`) car absente des « exports » du paquet.
- `pourPdf()` : remplace U+202F / U+00A0 (toLocaleString fr-FR) par une espace normale, et tout caractère
  hors WinAnsi par « ? ». TOUT texte imprimé passe par `pourPdf()`.
- Route : `GET /commercial/devis/[id]/pdf` (lecture par la session → RLS). Vérifié en build de production.
- Émetteur imprimé : `src/lib/entreprise.ts` (à personnaliser par l'utilisateur).
- Le compte admin de l'utilisateur est le seul compte permanent : ne jamais le modifier ni le supprimer dans les tests.
- Comptes jetables : emails en `@exemple.test`, toujours supprimés à la fin (fiches de test aussi).
- INCIDENT VÉCU (15/11/2026) : un test acceptait un devis sur un prospect RÉEL → la règle « devis accepté » a créé
  client + projet et passé le prospect en gagné. Règle : un test ne travaille QUE sur des données jetables qu'il crée,
  nettoie aussi les EFFETS DES DÉCLENCHEURS, et l'état de la base doit être identique avant/après (comparer).

## Écran Utilisateurs (`src/app/(app)/utilisateurs/`, actions dans `src/lib/actions/utilisateurs.ts`)
- Révoquer = supprimer le compte de connexion (profil puis auth.users) ; la fiche collaborateur est conservée.
- Mot de passe provisoire : généré côté serveur, affiché une fois, jamais stocké, masqué à l'action suivante.
- changerRole / rattacherCompte / creerFicheEtRattacher passent par le client de SESSION (RLS appliquée en plus).
- creerAcces / reinitialiserMotDePasse / revoquerAcces passent par le client admin, APRÈS `obtenirAdminOuNull()`.

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
- `prospects`, `devis`, `devis_lignes`, `compteurs` : migration `commercial`.
- `projets`, `clients`, `temps` (+ colonnes de `collaborateurs`) : migration `rh`.
- Encore sous la règle provisoire « tout connecté lit/écrit tout » : factures, relances, conges, notes_de_frais.

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

## Écran RH (`src/app/(app)/rh/`, actions dans `src/lib/actions/rh.ts`)
- Onglets (?onglet=collaborateurs|projets|temps) via le composant partagé `src/composants/Onglets.tsx`.
- Fiche collaborateur en CONSULTATION : `/rh/collaborateurs/[id]` (session/RLS : sa fiche pour un collaborateur,
  toutes pour manager/admin ; autre fiche → 404). Infos, semaine (?semaine=AAAA-MM-JJ, en cours par défaut),
  cumul par projet, historique. AUCUN taux horaire sur cette page.
- MODIFICATION : `/rh/collaborateurs/nouveau` et `/rh/collaborateurs/[id]/modifier` (admin). Le taux est lu UNIQUEMENT
  dans `[id]/modifier/page.tsx` avec `creerClientAdmin()` après `exigerAdmin()` ; écriture par la session (RLS).
- Dates/semaines/heures : `src/lib/dates.ts` (midi UTC, lundi→dimanche, n° ISO ; heures sommées en centièmes).
- Liste des managers : `managersPossibles()` (src/lib/rh.ts) = même règle que le déclencheur verifier_manager.

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
