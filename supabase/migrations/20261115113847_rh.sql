-- Module 3 — RH : collaborateurs, projets, clients, temps + lien avec le Commercial
-- 1. Devis accepté → client (si besoin) + prospect « gagné » + projet. Règle DANS LA BASE (agit même
--    depuis l'éditeur de tables Supabase), rejouable, ne supprime jamais rien.
-- 2. Manager : jamais soi-même, jamais de boucle.
-- 3. taux_horaire : illisible par l'API (droit SELECT retiré, puis redonné colonne par colonne).
-- 4. RLS projets / clients / temps (+ droits par colonne sur temps).
-- 5. Contrôles par assertion (simulations dans une transaction ANNULÉE).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Devis accepté → projet
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.devis_accepte_creer_projet()
returns trigger
language plpgsql
security definer           -- agit quel que soit l'auteur du changement de statut
set search_path = public, pg_temp
as $$
declare
  v_prospect public.prospects%rowtype;
  v_client uuid;
  v_libelle text;
begin
  -- Un seul traitement à la fois pour un même devis (deux clics simultanés → un seul projet)
  perform pg_advisory_xact_lock(hashtextextended('devis_accepte:' || new.id::text, 0));

  select * into v_prospect from public.prospects where id = new.prospect_id for update;
  if not found then
    raise exception 'Devis % : prospect introuvable', new.numero;
  end if;

  v_libelle := coalesce(nullif(btrim(v_prospect.societe), ''), v_prospect.nom);

  -- Fiche client : créée seulement si le prospect n'en a pas encore
  v_client := v_prospect.client_id;
  if v_client is null then
    insert into public.clients (nom, email_contact, telephone)
    values (v_libelle, v_prospect.email, v_prospect.telephone)
    returning id into v_client;
    update public.prospects set client_id = v_client where id = v_prospect.id;
  end if;

  -- Prospect gagné
  update public.prospects set statut = 'gagne' where id = v_prospect.id and statut is distinct from 'gagne';

  -- Projet : jamais en double pour un même devis
  if not exists (select 1 from public.projets where devis_id = new.id) then
    insert into public.projets (nom, client_id, devis_id, statut)
    values (v_libelle || ' — ' || coalesce(new.numero, 'devis'), v_client, new.id, 'en_cours');
  end if;

  return null; -- déclencheur AFTER : la valeur de retour est ignorée
end
$$;

revoke execute on function public.devis_accepte_creer_projet() from public, anon, authenticated;

drop trigger if exists devis_accepte_creer_projet on public.devis;
create trigger devis_accepte_creer_projet
  after insert or update of statut on public.devis
  for each row
  when (new.statut = 'accepte')
  execute function public.devis_accepte_creer_projet();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Manager : pas soi-même, pas de boucle (A → B → A)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.verifier_manager()
returns trigger
language plpgsql
security definer           -- remonte toute la chaîne, même les fiches que l'auteur ne voit pas
set search_path = public, pg_temp
as $$
declare
  v_courant uuid := new.manager_id;
  v_etapes int := 0;
begin
  if new.manager_id is null then
    return new;
  end if;
  if new.manager_id = new.id then
    raise exception 'Un collaborateur ne peut pas être son propre manager' using errcode = '23514';
  end if;
  while v_courant is not null and v_etapes < 1000 loop
    if v_courant = new.id then
      raise exception 'Boucle de managers interdite : ce collaborateur serait le manager de son propre manager' using errcode = '23514';
    end if;
    select c.manager_id into v_courant from public.collaborateurs c where c.id = v_courant;
    v_etapes := v_etapes + 1;
  end loop;
  return new;
end
$$;

revoke execute on function public.verifier_manager() from public, anon, authenticated;

drop trigger if exists collaborateurs_verifier_manager on public.collaborateurs;
create trigger collaborateurs_verifier_manager
  before insert or update of manager_id on public.collaborateurs
  for each row execute function public.verifier_manager();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. taux_horaire illisible : la RLS filtre les LIGNES, pas les COLONNES.
--    On retire SELECT sur toute la table, puis on le redonne colonne par colonne, SANS taux_horaire.
--    L'écriture reste possible (fiche créée/modifiée par l'admin, sous contrôle de la RLS) ;
--    la lecture du taux se fait uniquement côté serveur avec la clé secrète.
-- ─────────────────────────────────────────────────────────────────────────────

revoke select, insert, update, delete on table public.collaborateurs from anon, authenticated;
grant select (id, nom, prenom, email, poste, date_entree, manager_id, solde_conges, created_at)
  on table public.collaborateurs to authenticated;
grant insert (nom, prenom, email, poste, date_entree, manager_id, taux_horaire, solde_conges)
  on table public.collaborateurs to authenticated;
grant update (nom, prenom, email, poste, date_entree, manager_id, taux_horaire, solde_conges)
  on table public.collaborateurs to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Règles RLS (balayage : toutes les règles existantes de ces 3 tables sont supprimées)
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('projets', 'clients', 'temps')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end
$$;

alter table public.projets enable row level security;
alter table public.clients enable row level security;
alter table public.temps enable row level security;

-- projets : tout compte rattaché les lit (sinon impossible d'y saisir des temps) ; seul l'admin écrit
create policy projets_lecture on public.projets
  for select to authenticated using (public.mon_collaborateur_id() is not null);
create policy projets_creation_admin on public.projets
  for insert to authenticated with check (public.est_admin());
create policy projets_modification_admin on public.projets
  for update to authenticated using (public.est_admin()) with check (public.est_admin());
create policy projets_suppression_admin on public.projets
  for delete to authenticated using (public.est_admin());

-- clients : réservés au manager et à l'admin
create policy clients_lecture on public.clients
  for select to authenticated
  using (public.mon_role() in ('admin', 'manager') and public.mon_collaborateur_id() is not null);
create policy clients_creation on public.clients
  for insert to authenticated
  with check (public.mon_role() in ('admin', 'manager') and public.mon_collaborateur_id() is not null);
create policy clients_modification on public.clients
  for update to authenticated
  using (public.mon_role() in ('admin', 'manager') and public.mon_collaborateur_id() is not null)
  with check (public.mon_role() in ('admin', 'manager') and public.mon_collaborateur_id() is not null);

revoke delete on table public.clients from anon, authenticated;

-- temps : je vois et je saisis LES MIENS ; manager et admin voient tout et valident
create policy temps_lecture on public.temps
  for select to authenticated
  using (
    collaborateur_id = public.mon_collaborateur_id()
    or (public.mon_role() in ('admin', 'manager') and public.mon_collaborateur_id() is not null)
  );

create policy temps_creation on public.temps
  for insert to authenticated
  with check (
    collaborateur_id = public.mon_collaborateur_id()
    and statut in ('brouillon', 'soumis')
    and heures > 0 and heures <= 24
    and exists (select 1 from public.projets p where p.id = projet_id and p.statut = 'en_cours')
  );

-- L'auteur modifie ses temps tant qu'ils ne sont pas validés, sans pouvoir les valider lui-même
create policy temps_modification_auteur on public.temps
  for update to authenticated
  using (collaborateur_id = public.mon_collaborateur_id() and statut <> 'valide')
  with check (
    collaborateur_id = public.mon_collaborateur_id()
    and statut in ('brouillon', 'soumis')
    and heures > 0 and heures <= 24
    and exists (select 1 from public.projets p where p.id = projet_id and p.statut = 'en_cours')
  );

-- Manager et admin : peuvent modifier et VALIDER n'importe quel temps
create policy temps_modification_encadrement on public.temps
  for update to authenticated
  using (public.mon_role() in ('admin', 'manager') and public.mon_collaborateur_id() is not null)
  with check (
    public.mon_role() in ('admin', 'manager') and public.mon_collaborateur_id() is not null
    and heures > 0 and heures <= 24
  );

create policy temps_suppression_auteur on public.temps
  for delete to authenticated
  using (collaborateur_id = public.mon_collaborateur_id() and statut <> 'valide');

create policy temps_suppression_admin on public.temps
  for delete to authenticated
  using (public.est_admin());

-- Droits par colonne : facture_id réservé au futur module Finance ; un temps ne change pas de collaborateur
revoke insert, update on table public.temps from anon, authenticated;
grant insert (collaborateur_id, projet_id, date_saisie, heures, commentaire, statut) on table public.temps to authenticated;
grant update (projet_id, date_saisie, heures, commentaire, statut) on table public.temps to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CONTRÔLES PAR ASSERTION
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_nb int;
  v_liste text;
  v_bool boolean;
  v_refuse boolean;
  v_collab uuid;        -- compte collaborateur rattaché
  v_collab_fiche uuid;
  v_manager uuid;       -- compte manager rattaché
  v_admin uuid;         -- compte admin rattaché
  v_autre_fiche uuid;
  v_total_collab int;
  v_total_clients int;
  v_total_projets int;
  v_projet uuid;
  v_projet_annule uuid;
  v_temps uuid;
  v_prospect uuid;
  v_prospect2 uuid;
  v_devis uuid;
  v_devis2 uuid;
  v_client uuid;
  v_statut text;
  v_un uuid;
  v_deux uuid;
begin
  -- 5a. Structure
  select count(*) into v_nb from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('devis_accepte_creer_projet', 'verifier_manager') and p.prosecdef;
  if v_nb <> 2 then
    raise exception 'Fonctions des déclencheurs absentes ou pas en SECURITY DEFINER (% sur 2)', v_nb;
  end if;

  select count(*) into v_nb from pg_trigger
  where not tgisinternal and tgname in ('devis_accepte_creer_projet', 'collaborateurs_verifier_manager');
  if v_nb <> 2 then
    raise exception 'Déclencheurs absents (% sur 2)', v_nb;
  end if;

  v_bool := has_column_privilege('authenticated', 'public.collaborateurs', 'taux_horaire', 'select')
         or has_column_privilege('anon', 'public.collaborateurs', 'taux_horaire', 'select')
         or has_table_privilege('authenticated', 'public.collaborateurs', 'select');
  if v_bool then
    raise exception 'taux_horaire est encore lisible depuis l''API';
  end if;
  v_bool := has_column_privilege('authenticated', 'public.collaborateurs', 'nom', 'select')
        and has_column_privilege('authenticated', 'public.collaborateurs', 'manager_id', 'select');
  if not v_bool then
    raise exception 'Les autres colonnes de collaborateurs ne sont plus lisibles';
  end if;

  v_bool := has_column_privilege('authenticated', 'public.temps', 'facture_id', 'insert')
         or has_column_privilege('authenticated', 'public.temps', 'facture_id', 'update')
         or has_column_privilege('authenticated', 'public.temps', 'collaborateur_id', 'update');
  if v_bool then
    raise exception 'temps.facture_id ou temps.collaborateur_id est encore modifiable depuis l''API';
  end if;

  select string_agg(t || '=' || coalesce(nb::text, '0'), ', ') into v_liste
  from (values ('projets', 4), ('clients', 3), ('temps', 6)) as attendu(t, n)
  left join (select tablename, count(*) as nb from pg_policies where schemaname = 'public' group by tablename) pp
    on pp.tablename = attendu.t
  where coalesce(pp.nb, 0) <> attendu.n;
  if v_liste is not null then
    raise exception 'Nombre de règles inattendu : %', v_liste;
  end if;

  -- 5b. Simulations (tout est ANNULÉ à la fin du bloc)
  select count(*) into v_total_collab from public.collaborateurs;
  select p.id, p.collaborateur_id into v_collab, v_collab_fiche from public.profiles p
    where p.role = 'collaborateur' and p.collaborateur_id is not null order by p.created_at limit 1;
  select p.id into v_manager from public.profiles p
    where p.role = 'manager' and p.collaborateur_id is not null order by p.created_at limit 1;
  select p.id into v_admin from public.profiles p
    where p.role = 'admin' and p.collaborateur_id is not null order by p.created_at limit 1;

  begin
    -- Données de simulation (en tant que propriétaire)
    insert into public.projets (nom, statut) values ('Projet de contrôle', 'en_cours') returning id into v_projet;
    insert into public.projets (nom, statut) values ('Projet annulé de contrôle', 'annule') returning id into v_projet_annule;
    select count(*) into v_total_clients from public.clients;
    select count(*) into v_total_projets from public.projets;

    -- ── Garde-fou manager ──
    select c.id into v_un from public.collaborateurs c order by c.created_at limit 1;
    v_refuse := false;
    begin
      update public.collaborateurs set manager_id = id where id = v_un;
    exception when check_violation then v_refuse := true;
    end;
    if not v_refuse then
      raise exception 'Un collaborateur a pu devenir son propre manager';
    end if;
    insert into public.collaborateurs (nom, prenom, taux_horaire) values ('Contrôle', 'Un', 0) returning id into v_un;
    insert into public.collaborateurs (nom, prenom, taux_horaire, manager_id) values ('Contrôle', 'Deux', 0, v_un) returning id into v_deux;
    v_refuse := false;
    begin
      update public.collaborateurs set manager_id = v_deux where id = v_un;
    exception when check_violation then v_refuse := true;
    end;
    if not v_refuse then
      raise exception 'Une boucle de managers (A → B → A) a été acceptée';
    end if;
    select count(*) into v_total_collab from public.collaborateurs;

    -- ── Déclencheur « devis accepté » ──
    insert into public.prospects (nom, societe, email, telephone)
      values ('Contact contrôle', 'Société contrôle', 'controle@exemple.test', '0100000000') returning id into v_prospect;
    insert into public.devis (prospect_id, numero, statut) values (v_prospect, 'CONTROLE-1', 'brouillon') returning id into v_devis;

    update public.devis set statut = 'accepte' where id = v_devis;
    select count(*) into v_nb from public.projets where devis_id = v_devis;
    if v_nb <> 1 then
      raise exception 'Devis accepté : % projet(s) créé(s) au lieu de 1', v_nb;
    end if;
    select pr.client_id, pr.statut into v_client, v_statut from public.prospects pr where pr.id = v_prospect;
    if v_client is null or v_statut <> 'gagne' then
      raise exception 'Devis accepté : prospect non converti (client %, statut %)', v_client, v_statut;
    end if;
    select count(*) into v_nb from public.projets where devis_id = v_devis and client_id = v_client and statut = 'en_cours';
    if v_nb <> 1 then
      raise exception 'Le projet n''est pas rattaché au client et au devis d''origine';
    end if;

    -- Rejouable : refusé puis de nouveau accepté → rien supprimé, rien en double
    update public.devis set statut = 'refuse' where id = v_devis;
    update public.devis set statut = 'accepte' where id = v_devis;
    update public.devis set statut = 'accepte' where id = v_devis;
    select count(*) into v_nb from public.projets where devis_id = v_devis;
    if v_nb <> 1 then
      raise exception 'Devis ré-accepté : % projet(s) au lieu de 1', v_nb;
    end if;
    select count(*) into v_nb from public.clients where id = v_client;
    if v_nb <> 1 then
      raise exception 'Le passage en refusé a supprimé le client';
    end if;
    select count(*) into v_nb from public.clients where nom = 'Société contrôle';
    if v_nb <> 1 then
      raise exception 'Devis ré-accepté : % fiche(s) client au lieu de 1', v_nb;
    end if;

    -- Prospect DÉJÀ client : pas de nouvelle fiche client
    insert into public.prospects (nom, client_id) values ('Contact déjà client', v_client) returning id into v_prospect2;
    insert into public.devis (prospect_id, numero, statut) values (v_prospect2, 'CONTROLE-2', 'accepte') returning id into v_devis2;
    select count(*) into v_nb from public.projets where devis_id = v_devis2 and client_id = v_client;
    if v_nb <> 1 then
      raise exception 'Devis créé directement « accepté » pour un client existant : projet absent ou mal rattaché';
    end if;
    select count(*) into v_nb from public.clients where nom = 'Société contrôle';
    if v_nb <> 1 then
      raise exception 'Une fiche client en double a été créée pour un prospect déjà client';
    end if;
    update public.devis set statut = 'brouillon' where id = v_devis2;  -- pour le test du manager ci-dessous
    delete from public.projets where devis_id = v_devis2;
    select count(*) into v_total_projets from public.projets;  -- recompté : le déclencheur en a créé un

    -- ── Collaborateur (s'il en existe un rattaché) ──
    if v_collab is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_collab::text, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';

      v_refuse := false;
      begin
        perform c.taux_horaire from public.collaborateurs c limit 1;
      exception when insufficient_privilege then v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Un collaborateur peut lire taux_horaire';
      end if;
      select count(*) into v_nb from public.collaborateurs;
      if v_nb <> 1 then
        raise exception 'Le collaborateur voit % fiche(s) au lieu de la sienne', v_nb;
      end if;
      select count(*) into v_nb from public.clients;
      if v_nb <> 0 then
        raise exception 'Le collaborateur voit % client(s)', v_nb;
      end if;
      select count(*) into v_nb from public.projets;
      if v_nb <> v_total_projets then
        raise exception 'Le collaborateur voit % projet(s) sur %', v_nb, v_total_projets;
      end if;

      insert into public.temps (collaborateur_id, projet_id, date_saisie, heures, statut)
        values (v_collab_fiche, v_projet, current_date, 7.5, 'brouillon') returning id into v_temps;

      select c.id into v_autre_fiche from public.collaborateurs c where c.id <> v_collab_fiche limit 1;
      -- (il ne voit pas les autres fiches : on prend celle créée plus haut)
      v_autre_fiche := v_un;
      v_refuse := false;
      begin
        insert into public.temps (collaborateur_id, projet_id, heures) values (v_autre_fiche, v_projet, 1);
      exception when insufficient_privilege then v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Un collaborateur a pu saisir un temps au nom d''un autre';
      end if;
      v_refuse := false;
      begin
        insert into public.temps (collaborateur_id, projet_id, heures, statut) values (v_collab_fiche, v_projet, 1, 'valide');
      exception when insufficient_privilege then v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Un collaborateur a pu saisir un temps directement « validé »';
      end if;
      v_refuse := false;
      begin
        insert into public.temps (collaborateur_id, projet_id, heures) values (v_collab_fiche, v_projet_annule, 1);
      exception when insufficient_privilege then v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Un temps a été accepté sur un projet annulé';
      end if;
      v_refuse := false;
      begin
        insert into public.temps (collaborateur_id, projet_id, heures) values (v_collab_fiche, v_projet, 25);
      exception when insufficient_privilege then v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Un temps de 25 heures a été accepté';
      end if;
      v_refuse := false;
      begin
        update public.temps set statut = 'valide' where id = v_temps;
      exception when insufficient_privilege then v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Un collaborateur a pu valider son propre temps';
      end if;
      v_refuse := false;
      begin
        update public.temps set facture_id = null where id = v_temps;
      exception when insufficient_privilege then v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Un collaborateur peut écrire temps.facture_id';
      end if;
      v_refuse := false;
      begin
        insert into public.projets (nom) values ('Projet pirate');
      exception when insufficient_privilege then v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Un collaborateur a pu créer un projet';
      end if;
      update public.temps set heures = 8, statut = 'soumis' where id = v_temps;
      get diagnostics v_nb = row_count;
      if v_nb <> 1 then
        raise exception 'Un collaborateur ne peut pas modifier son propre temps non validé';
      end if;
      execute 'reset role';
    end if;

    -- ── Manager (s'il en existe un rattaché) ──
    if v_manager is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_refuse := false;
      begin
        perform c.taux_horaire from public.collaborateurs c limit 1;
      exception when insufficient_privilege then v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Un manager peut lire taux_horaire';
      end if;
      select count(*) into v_nb from public.collaborateurs;
      if v_nb <> v_total_collab then
        raise exception 'Le manager voit % fiche(s) sur %', v_nb, v_total_collab;
      end if;
      select count(*) into v_nb from public.clients;
      if v_nb <> v_total_clients + 1 then
        raise exception 'Le manager voit % client(s) sur %', v_nb, v_total_clients + 1;
      end if;
      if v_temps is not null then
        update public.temps set statut = 'valide' where id = v_temps;
        get diagnostics v_nb = row_count;
        if v_nb <> 1 then
          raise exception 'Le manager ne peut pas valider un temps';
        end if;
      end if;
      -- Le déclencheur agit aussi quand c'est un manager qui accepte le devis
      update public.devis set statut = 'accepte' where id = v_devis2;
      execute 'reset role';
      select count(*) into v_nb from public.projets where devis_id = v_devis2;
      if v_nb <> 1 then
        raise exception 'Devis accepté par un manager : % projet(s) au lieu de 1', v_nb;
      end if;
    end if;

    -- ── Admin (s'il en existe un rattaché) ──
    if v_admin is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_refuse := false;
      begin
        perform c.taux_horaire from public.collaborateurs c limit 1;
      exception when insufficient_privilege then v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Un admin peut lire taux_horaire depuis l''API';
      end if;
      insert into public.projets (nom, statut) values ('Projet admin de contrôle', 'en_cours');
      execute 'reset role';
    end if;

    raise exception 'annulation des simulations' using errcode = 'ZT001';
  exception when sqlstate 'ZT001' then
    null;
  end;

  -- Rien ne doit subsister des simulations
  select count(*) into v_nb from public.projets where nom like '%contrôle%' or nom like '%CONTROLE%';
  if v_nb <> 0 then
    raise exception 'Les données de simulation n''ont pas été annulées';
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'RH : OK';
end
$$;
