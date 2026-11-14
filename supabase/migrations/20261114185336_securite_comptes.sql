-- Module 1 — Sécurité des comptes
-- 1. Fonctions mon_role(), mon_collaborateur_id(), est_admin()  (SECURITY DEFINER)
-- 2. Garde-fou : un admin ne peut pas se rétrograder lui-même
-- 3. RLS de profiles et collaborateurs (remplace la règle provisoire sur ces 2 tables)
-- 4. Contrôles par assertion : le déploiement ÉCHOUE si un contrôle ne passe pas
-- Rejouable : create or replace, suppression des règles par balayage de pg_policies.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Fonctions
-- SECURITY DEFINER : elles lisent profiles avec les droits de leur propriétaire,
-- donc SANS repasser par la RLS de profiles (sinon : boucle infinie).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.mon_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role::text from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.mon_collaborateur_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.collaborateur_id from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.est_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.role = 'admin' from public.profiles p where p.id = auth.uid()), false)
$$;

revoke execute on function public.mon_role() from public, anon;
revoke execute on function public.mon_collaborateur_id() from public, anon;
revoke execute on function public.est_admin() from public, anon;
grant execute on function public.mon_role() to authenticated, service_role;
grant execute on function public.mon_collaborateur_id() to authenticated, service_role;
grant execute on function public.est_admin() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Garde-fou : un admin connecté ne peut pas retirer son propre rôle admin
-- (l'application le vérifie aussi ; ceci protège même un appel direct à l'API)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.empecher_auto_retrogradation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and old.id = auth.uid()
     and old.role = 'admin'
     and new.role is distinct from 'admin' then
    raise exception 'Un administrateur ne peut pas se rétrograder lui-même';
  end if;
  return new;
end
$$;

drop trigger if exists profiles_empecher_auto_retrogradation on public.profiles;
create trigger profiles_empecher_auto_retrogradation
  before update of role on public.profiles
  for each row execute function public.empecher_auto_retrogradation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Règles RLS — on supprime TOUTES les règles existantes de ces 2 tables
-- (dont la règle provisoire), quel que soit leur nom.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('profiles', 'collaborateurs')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end
$$;

alter table public.profiles enable row level security;
alter table public.collaborateurs enable row level security;

-- profiles : chacun lit sa fiche, l'admin les lit toutes ; seul l'admin écrit.
create policy profiles_lecture on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.est_admin());

create policy profiles_creation_admin on public.profiles
  for insert to authenticated
  with check (public.est_admin());

create policy profiles_modification_admin on public.profiles
  for update to authenticated
  using (public.est_admin())
  with check (public.est_admin());

create policy profiles_suppression_admin on public.profiles
  for delete to authenticated
  using (public.est_admin());

-- collaborateurs : je vois ma fiche, admin et manager voient tout ; seul l'admin écrit.
create policy collaborateurs_lecture on public.collaborateurs
  for select to authenticated
  using (id = public.mon_collaborateur_id() or public.mon_role() in ('admin', 'manager'));

create policy collaborateurs_creation_admin on public.collaborateurs
  for insert to authenticated
  with check (public.est_admin());

create policy collaborateurs_modification_admin on public.collaborateurs
  for update to authenticated
  using (public.est_admin())
  with check (public.est_admin());

create policy collaborateurs_suppression_admin on public.collaborateurs
  for delete to authenticated
  using (public.est_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CONTRÔLES PAR ASSERTION
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_nb int;
  v_liste text;
  v_admin uuid;
  v_total_collab int;
  v_total_profils int;
  v_role text;
  v_bool boolean;
  v_retrograde boolean := false;
begin
  -- 4a. Les 3 fonctions existent et sont SECURITY DEFINER
  select string_agg(f, ', ') into v_liste
  from unnest(array['mon_role', 'mon_collaborateur_id', 'est_admin']) as f
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f and p.prosecdef
  );
  if v_liste is not null then
    raise exception 'Fonctions absentes ou pas en SECURITY DEFINER : %', v_liste;
  end if;

  -- 4b. RLS active et non « forcée » (forcée = le propriétaire la subit aussi → boucle)
  select string_agg(c.relname, ', ') into v_liste
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('profiles', 'collaborateurs')
    and (not c.relrowsecurity or c.relforcerowsecurity);
  if v_liste is not null then
    raise exception 'RLS absente ou forcée sur : %', v_liste;
  end if;

  -- 4c. Exactement les 8 règles attendues, et plus aucune règle provisoire
  select count(*) into v_nb from pg_policies
  where schemaname = 'public' and tablename in ('profiles', 'collaborateurs');
  if v_nb <> 8 then
    raise exception 'On attend 8 règles sur profiles + collaborateurs, il y en a %', v_nb;
  end if;

  select string_agg(tablename || '.' || policyname, ', ') into v_liste from pg_policies
  where schemaname = 'public' and tablename in ('profiles', 'collaborateurs')
    and cmd <> 'SELECT'
    and coalesce(qual, '') || coalesce(with_check, '') not like '%est_admin%';
  if v_liste is not null then
    raise exception 'Règles d''écriture non réservées à l''admin : %', v_liste;
  end if;

  -- 4c bis. Le déclencheur de création de compte (auth.users → profiles) doit être
  -- SECURITY DEFINER, sinon les nouvelles règles l'empêcheraient d'écrire dans profiles.
  select count(*) into v_nb
  from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid
  where tg.tgrelid = 'auth.users'::regclass and not tg.tgisinternal
    and p.prosrc ilike '%profiles%' and not p.prosecdef;
  if v_nb > 0 then
    raise exception 'Le déclencheur de création de profil n''est pas SECURITY DEFINER : la création de comptes serait bloquée';
  end if;

  -- 4d. Test en situation : un utilisateur connecté SANS profil ne voit rien et ne modifie rien
  select count(*) into v_total_collab from public.collaborateurs;
  select count(*) into v_total_profils from public.profiles;

  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_nb from public.profiles;
  if v_nb <> 0 then
    raise exception 'Un compte sans profil voit % ligne(s) de profiles au lieu de 0', v_nb;
  end if;
  select count(*) into v_nb from public.collaborateurs;
  if v_nb <> 0 then
    raise exception 'Un compte sans fiche voit % collaborateur(s) au lieu de 0', v_nb;
  end if;
  update public.profiles set role = 'admin';
  get diagnostics v_nb = row_count;
  if v_nb <> 0 then
    raise exception 'Un non-admin a pu modifier % ligne(s) de profiles', v_nb;
  end if;
  update public.collaborateurs set nom = nom;
  get diagnostics v_nb = row_count;
  if v_nb <> 0 then
    raise exception 'Un non-admin a pu modifier % fiche(s) collaborateur', v_nb;
  end if;
  execute 'reset role';

  -- 4e. Test en situation : l'admin voit tout (si un admin existe déjà)
  select p.id into v_admin from public.profiles p where p.role = 'admin' order by p.created_at limit 1;
  if v_admin is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    v_role := public.mon_role();
    if v_role is distinct from 'admin' then
      raise exception 'mon_role() renvoie % pour l''admin', coalesce(v_role, 'NULL');
    end if;
    v_bool := public.est_admin();
    if not v_bool then
      raise exception 'est_admin() renvoie faux pour l''admin';
    end if;
    select count(*) into v_nb from public.collaborateurs;
    if v_nb <> v_total_collab then
      raise exception 'L''admin voit % collaborateur(s) sur %', v_nb, v_total_collab;
    end if;
    select count(*) into v_nb from public.profiles;
    if v_nb <> v_total_profils then
      raise exception 'L''admin voit % profil(s) sur %', v_nb, v_total_profils;
    end if;

    -- L'admin ne peut pas se rétrograder lui-même
    begin
      update public.profiles set role = 'manager' where id = v_admin;
      v_retrograde := true;
    exception when others then
      v_retrograde := false;
    end;
    execute 'reset role';
    if v_retrograde then
      raise exception 'Un administrateur a pu se rétrograder lui-même';
    end if;
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Sécurité des comptes : OK';
end
$$;
