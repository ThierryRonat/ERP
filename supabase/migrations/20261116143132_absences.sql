-- Module 5 — Absences : congés, notes de frais, justificatifs (stockage)
-- 1. Congés : valider_conge / refuser_conge (manager ou admin ; personne ne valide sa propre demande sauf l'admin).
--    D'ABORD le statut (uniquement si « demandee »), le solde n'est décrémenté QUE si une ligne a réellement changé
--    (déclencheur sur la transition → « validee », valable aussi depuis l'éditeur Supabase). Congé validé = figé.
-- 2. Notes de frais : changer_statut_note (soumise → validee → remboursee), note figée hors « soumise ».
-- 3. RLS conges / notes_de_frais + droits par colonne.
-- 4. Stockage « justificatifs » : chemin = <id collaborateur>/<fichier> ; on dépose et lit dans SON dossier,
--    manager et admin lisent tout ; personne ne modifie ni ne supprime par l'API.
-- 5. Contrôles par assertion (simulations dans une transaction ANNULÉE).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Congés
-- ─────────────────────────────────────────────────────────────────────────────

-- Décompte du solde : UNIQUEMENT quand un congé DEVIENT « validee » (une ligne qui a réellement changé).
create or replace function public.decompter_solde_conge()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_solde numeric;
begin
  if new.type in ('conges_payes', 'rtt') then
    update public.collaborateurs
      set solde_conges = solde_conges - new.nb_jours
      where id = new.collaborateur_id
      returning solde_conges into v_solde;
    if v_solde < 0 then
      raise exception 'Solde insuffisant : il manque % jour(s) pour valider ce congé', -v_solde using errcode = '22023';
    end if;
  end if;
  return null;
end
$$;
revoke execute on function public.decompter_solde_conge() from public, anon, authenticated;

drop trigger if exists conges_decompter_solde_insert on public.conges;
create trigger conges_decompter_solde_insert
  after insert on public.conges
  for each row when (new.statut = 'validee')
  execute function public.decompter_solde_conge();

drop trigger if exists conges_decompter_solde_update on public.conges;
create trigger conges_decompter_solde_update
  after update of statut on public.conges
  for each row when (old.statut is distinct from 'validee' and new.statut = 'validee')
  execute function public.decompter_solde_conge();

-- Congé validé : plus aucune modification (le solde a déjà bougé). Vaut aussi pour la clé secrète.
create or replace function public.figer_conge_valide()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.statut = 'validee' and (
       new.statut is distinct from old.statut
    or new.nb_jours is distinct from old.nb_jours
    or new.type is distinct from old.type
    or new.collaborateur_id is distinct from old.collaborateur_id
    or new.date_debut is distinct from old.date_debut
    or new.date_fin is distinct from old.date_fin
  ) then
    raise exception 'Ce congé est validé : il ne peut plus être refusé ni modifié (le solde a déjà été décompté)'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists conges_figer_valide on public.conges;
create trigger conges_figer_valide
  before update on public.conges
  for each row execute function public.figer_conge_valide();

create or replace function public.valider_conge(p_conge_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.mon_role();
  v_moi uuid := public.mon_collaborateur_id();
  v_auteur uuid;
  v_statut text;
  v_lignes int;
begin
  if v_role is null or v_role not in ('admin', 'manager') or v_moi is null then
    raise exception 'La validation des congés est réservée aux managers et administrateurs' using errcode = '42501';
  end if;
  select c.collaborateur_id, c.statut into v_auteur, v_statut from public.conges c where c.id = p_conge_id;
  if not found then
    raise exception 'Congé introuvable' using errcode = 'P0002';
  end if;
  if v_auteur = v_moi and v_role <> 'admin' then
    raise exception 'Vous ne pouvez pas valider votre propre demande' using errcode = '42501';
  end if;
  if v_statut = 'refusee' then
    raise exception 'Ce congé a été refusé : il ne peut plus être validé' using errcode = '22023';
  end if;

  -- 1) D'ABORD le statut, en refusant les congés déjà validés (WHERE statut = 'demandee')
  update public.conges
    set statut = 'validee', valide_par = v_moi
    where id = p_conge_id and statut = 'demandee';
  get diagnostics v_lignes = row_count;

  -- 2) Le solde n'a été décrémenté (par le déclencheur) QUE si une ligne a réellement changé
  return case when v_lignes = 1 then 'validee' else 'deja_validee' end;
end
$$;

create or replace function public.refuser_conge(p_conge_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.mon_role();
  v_moi uuid := public.mon_collaborateur_id();
  v_auteur uuid;
  v_statut text;
  v_lignes int;
begin
  if v_role is null or v_role not in ('admin', 'manager') or v_moi is null then
    raise exception 'Le refus des congés est réservé aux managers et administrateurs' using errcode = '42501';
  end if;
  select c.collaborateur_id, c.statut into v_auteur, v_statut from public.conges c where c.id = p_conge_id;
  if not found then
    raise exception 'Congé introuvable' using errcode = 'P0002';
  end if;
  if v_auteur = v_moi and v_role <> 'admin' then
    raise exception 'Vous ne pouvez pas traiter votre propre demande' using errcode = '42501';
  end if;
  if v_statut = 'validee' then
    raise exception 'Ce congé est déjà validé : il ne peut plus être refusé (le solde a déjà été décompté)' using errcode = '22023';
  end if;
  update public.conges set statut = 'refusee', valide_par = v_moi where id = p_conge_id and statut = 'demandee';
  get diagnostics v_lignes = row_count;
  return case when v_lignes = 1 then 'refusee' else 'deja_traitee' end;
end
$$;

revoke execute on function public.valider_conge(uuid), public.refuser_conge(uuid) from public, anon;
grant execute on function public.valider_conge(uuid), public.refuser_conge(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Notes de frais
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.figer_note_de_frais()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.statut <> 'soumise' and (
       new.montant is distinct from old.montant
    or new.date_depense is distinct from old.date_depense
    or new.categorie is distinct from old.categorie
    or new.justificatif_url is distinct from old.justificatif_url
    or new.collaborateur_id is distinct from old.collaborateur_id
  ) then
    raise exception 'Cette note de frais est validée : elle ne peut plus être modifiée' using errcode = '42501';
  end if;
  if not (
       new.statut = old.statut
    or (old.statut = 'soumise' and new.statut = 'validee')
    or (old.statut = 'validee' and new.statut = 'remboursee')
  ) then
    raise exception 'Passage de statut interdit (% → %) : soumise → validée → remboursée uniquement', old.statut, new.statut
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists notes_de_frais_figer on public.notes_de_frais;
create trigger notes_de_frais_figer
  before update on public.notes_de_frais
  for each row execute function public.figer_note_de_frais();

create or replace function public.changer_statut_note(p_note_id uuid, p_statut text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.mon_role();
  v_moi uuid := public.mon_collaborateur_id();
  v_auteur uuid;
  v_lignes int;
begin
  if v_role is null or v_role not in ('admin', 'manager') or v_moi is null then
    raise exception 'Le traitement des notes de frais est réservé aux managers et administrateurs' using errcode = '42501';
  end if;
  if p_statut not in ('validee', 'remboursee') then
    raise exception 'Statut inconnu : %', p_statut using errcode = '22023';
  end if;
  select n.collaborateur_id into v_auteur from public.notes_de_frais n where n.id = p_note_id;
  if not found then
    raise exception 'Note de frais introuvable' using errcode = 'P0002';
  end if;
  if v_auteur = v_moi and v_role <> 'admin' then
    raise exception 'Vous ne pouvez pas traiter votre propre note de frais' using errcode = '42501';
  end if;
  update public.notes_de_frais
    set statut = p_statut
    where id = p_note_id
      and statut = case p_statut when 'validee' then 'soumise' else 'validee' end;
  get diagnostics v_lignes = row_count;
  return case when v_lignes = 1 then p_statut else 'deja_traitee' end;
end
$$;

revoke execute on function public.changer_statut_note(uuid, text) from public, anon;
grant execute on function public.changer_statut_note(uuid, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS conges / notes_de_frais (balayage de toutes les règles existantes)
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('conges', 'notes_de_frais')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end
$$;

alter table public.conges enable row level security;
alter table public.notes_de_frais enable row level security;

-- conges : je vois et je crée les miens ; manager et admin voient tout (et valident via les fonctions)
create policy conges_lecture on public.conges
  for select to authenticated
  using (
    collaborateur_id = public.mon_collaborateur_id()
    or (public.mon_role() in ('admin', 'manager') and public.mon_collaborateur_id() is not null)
  );
create policy conges_creation on public.conges
  for insert to authenticated
  with check (
    collaborateur_id = public.mon_collaborateur_id()
    and statut = 'demandee' and valide_par is null
    and date_fin >= date_debut
    and nb_jours > 0 and nb_jours <= (date_fin - date_debut + 1)
  );
create policy conges_modification_auteur on public.conges
  for update to authenticated
  using (collaborateur_id = public.mon_collaborateur_id() and statut = 'demandee')
  with check (
    collaborateur_id = public.mon_collaborateur_id()
    and statut = 'demandee' and valide_par is null
    and date_fin >= date_debut
    and nb_jours > 0 and nb_jours <= (date_fin - date_debut + 1)
  );
create policy conges_annulation_auteur on public.conges
  for delete to authenticated
  using (collaborateur_id = public.mon_collaborateur_id() and statut = 'demandee');

revoke insert, update, delete on table public.conges from anon, authenticated;
grant insert (collaborateur_id, type, date_debut, date_fin, nb_jours, motif) on table public.conges to authenticated;
grant update (type, date_debut, date_fin, nb_jours, motif) on table public.conges to authenticated;
grant delete on table public.conges to authenticated;

-- notes_de_frais : même principe ; le justificatif doit être dans le dossier de l'auteur
create policy notes_lecture on public.notes_de_frais
  for select to authenticated
  using (
    collaborateur_id = public.mon_collaborateur_id()
    or (public.mon_role() in ('admin', 'manager') and public.mon_collaborateur_id() is not null)
  );
create policy notes_creation on public.notes_de_frais
  for insert to authenticated
  with check (
    collaborateur_id = public.mon_collaborateur_id()
    and statut = 'soumise'
    and montant > 0
    and justificatif_url like public.mon_collaborateur_id()::text || '/%'
  );
create policy notes_modification_auteur on public.notes_de_frais
  for update to authenticated
  using (collaborateur_id = public.mon_collaborateur_id() and statut = 'soumise')
  with check (
    collaborateur_id = public.mon_collaborateur_id()
    and statut = 'soumise'
    and montant > 0
    and justificatif_url like public.mon_collaborateur_id()::text || '/%'
  );
create policy notes_suppression_auteur on public.notes_de_frais
  for delete to authenticated
  using (collaborateur_id = public.mon_collaborateur_id() and statut = 'soumise');

revoke insert, update, delete on table public.notes_de_frais from anon, authenticated;
grant insert (collaborateur_id, date_depense, montant, categorie, justificatif_url) on table public.notes_de_frais to authenticated;
grant update (date_depense, montant, categorie, justificatif_url) on table public.notes_de_frais to authenticated;
grant delete on table public.notes_de_frais to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Stockage : bucket « justificatifs » (seul bucket du projet)
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end
$$;

create policy justificatifs_depot_mon_dossier on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'justificatifs'
    and public.mon_collaborateur_id() is not null
    and (storage.foldername(name))[1] = public.mon_collaborateur_id()::text
  );

create policy justificatifs_lecture on storage.objects
  for select to authenticated
  using (
    bucket_id = 'justificatifs'
    and public.mon_collaborateur_id() is not null
    and (
      (storage.foldername(name))[1] = public.mon_collaborateur_id()::text
      or public.mon_role() in ('admin', 'manager')
    )
  );
-- Pas de règle de modification ni de suppression : seul le serveur (clé secrète) nettoie.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CONTRÔLES PAR ASSERTION
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_nb int;
  v_liste text;
  v_bool boolean;
  v_refuse boolean;
  v_message text;
  v_resultat text;
  v_collab uuid;   -- compte collaborateur rattaché
  v_fiche_collab uuid;
  v_manager uuid;  -- compte manager rattaché
  v_fiche_manager uuid;
  v_admin uuid;
  v_autre uuid;
  v_conge uuid;
  v_conge_rtt uuid;
  v_conge_ss uuid;
  v_note uuid;
  v_solde numeric;
  v_solde_depart numeric;
begin
  -- 5a. Structure
  select count(*) into v_nb from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname in ('valider_conge', 'refuser_conge', 'changer_statut_note', 'decompter_solde_conge');
  if v_nb <> 4 then
    raise exception 'Fonctions absentes ou pas en SECURITY DEFINER (% sur 4)', v_nb;
  end if;
  select count(*) into v_nb from pg_trigger where not tgisinternal
    and tgname in ('conges_decompter_solde_insert', 'conges_decompter_solde_update', 'conges_figer_valide', 'notes_de_frais_figer');
  if v_nb <> 4 then
    raise exception 'Déclencheurs absents (% sur 4)', v_nb;
  end if;
  v_bool := has_column_privilege('authenticated', 'public.conges', 'statut', 'update')
         or has_column_privilege('authenticated', 'public.conges', 'statut', 'insert')
         or has_column_privilege('authenticated', 'public.conges', 'valide_par', 'update')
         or has_column_privilege('authenticated', 'public.notes_de_frais', 'statut', 'update')
         or has_column_privilege('authenticated', 'public.notes_de_frais', 'statut', 'insert');
  if v_bool then
    raise exception 'Un statut de congé ou de note peut encore être écrit directement par l''API';
  end if;
  select string_agg(t || '=' || coalesce(nb::text, '0'), ', ') into v_liste
  from (values ('public', 'conges', 4), ('public', 'notes_de_frais', 4), ('storage', 'objects', 2)) as attendu(s, t, n)
  left join (select schemaname, tablename, count(*) as nb from pg_policies group by schemaname, tablename) pp
    on pp.schemaname = attendu.s and pp.tablename = attendu.t
  where coalesce(pp.nb, 0) <> attendu.n;
  if v_liste is not null then
    raise exception 'Nombre de règles inattendu : %', v_liste;
  end if;
  select count(*) into v_nb from storage.buckets where id = 'justificatifs' and not public;
  if v_nb <> 1 then
    raise exception 'Le bucket justificatifs doit exister et rester privé';
  end if;

  select p.id, p.collaborateur_id into v_collab, v_fiche_collab from public.profiles p
    where p.role = 'collaborateur' and p.collaborateur_id is not null order by p.created_at limit 1;
  select p.id, p.collaborateur_id into v_manager, v_fiche_manager from public.profiles p
    where p.role = 'manager' and p.collaborateur_id is not null order by p.created_at limit 1;
  select p.id into v_admin from public.profiles p
    where p.role = 'admin' and p.collaborateur_id is not null order by p.created_at limit 1;
  if v_collab is null or v_manager is null then
    raise notice 'Simulations des congés ignorées : il faut un collaborateur ET un manager rattachés';
    return;
  end if;

  -- 5b. Simulations (tout est ANNULÉ à la fin du bloc)
  begin
    update public.collaborateurs set solde_conges = 10 where id = v_fiche_collab;
    v_solde_depart := 10;

    -- Collaborateur : crée SES demandes, ne peut ni tricher ni se valider
    perform set_config('request.jwt.claims', json_build_object('sub', v_collab::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.conges (collaborateur_id, type, date_debut, date_fin, nb_jours)
      values (v_fiche_collab, 'conges_payes', date '2031-07-01', date '2031-07-03', 3) returning id into v_conge;
    insert into public.conges (collaborateur_id, type, date_debut, date_fin, nb_jours)
      values (v_fiche_collab, 'rtt', date '2031-08-01', date '2031-08-30', 30) returning id into v_conge_rtt;
    insert into public.conges (collaborateur_id, type, date_debut, date_fin, nb_jours)
      values (v_fiche_collab, 'sans_solde', date '2031-09-01', date '2031-09-02', 2) returning id into v_conge_ss;
    v_refuse := false;
    begin
      insert into public.conges (collaborateur_id, type, date_debut, date_fin, nb_jours) values (v_fiche_manager, 'rtt', date '2031-07-01', date '2031-07-01', 1);
    exception when insufficient_privilege then v_refuse := true; end;
    if not v_refuse then raise exception 'Un collaborateur a pu créer un congé au nom d''un autre'; end if;
    v_refuse := false;
    begin
      insert into public.conges (collaborateur_id, type, date_debut, date_fin, nb_jours, statut) values (v_fiche_collab, 'rtt', date '2031-07-01', date '2031-07-01', 1, 'validee');
    exception when insufficient_privilege then v_refuse := true; end;
    if not v_refuse then raise exception 'Un collaborateur a pu créer un congé directement validé'; end if;
    v_refuse := false;
    begin
      insert into public.conges (collaborateur_id, type, date_debut, date_fin, nb_jours) values (v_fiche_collab, 'rtt', date '2031-07-01', date '2031-07-03', 5);
    exception when insufficient_privilege then v_refuse := true; end;
    if not v_refuse then raise exception '5 jours acceptés sur une période de 3 jours'; end if;
    v_refuse := false;
    begin perform public.valider_conge(v_conge);
    exception when insufficient_privilege then v_refuse := true; end;
    if not v_refuse then raise exception 'Un collaborateur a pu valider un congé'; end if;
    select count(*) into v_nb from public.conges;
    if v_nb <> 3 then raise exception 'Le collaborateur voit % congé(s) au lieu de ses 3', v_nb; end if;
    execute 'reset role';

    -- Manager : valide DEUX FOIS DE SUITE → décompté UNE seule fois
    perform set_config('request.jwt.claims', json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_resultat := public.valider_conge(v_conge);
    if v_resultat <> 'validee' then raise exception '1re validation : % au lieu de validee', v_resultat; end if;
    v_resultat := public.valider_conge(v_conge);
    if v_resultat <> 'deja_validee' then raise exception '2e validation : % au lieu de deja_validee', v_resultat; end if;
    execute 'reset role';
    select solde_conges into v_solde from public.collaborateurs where id = v_fiche_collab;
    if v_solde <> v_solde_depart - 3 then
      raise exception 'Double validation : solde % au lieu de % (décompté deux fois ?)', v_solde, v_solde_depart - 3;
    end if;

    -- Un congé validé ne peut plus être refusé (ni par la fonction, ni en direct avec les droits du propriétaire)
    execute 'set local role authenticated';
    v_message := null;
    begin perform public.refuser_conge(v_conge);
    exception when invalid_parameter_value then v_message := sqlerrm; end;
    execute 'reset role';
    if v_message is null then raise exception 'Un congé validé a pu être refusé'; end if;
    v_refuse := false;
    begin update public.conges set statut = 'refusee' where id = v_conge;
    exception when insufficient_privilege then v_refuse := true; end;
    if not v_refuse then raise exception 'Un congé validé a pu être repassé en refusé (droits du propriétaire)'; end if;

    -- Solde insuffisant (RTT 30 jours, solde 7) → refus, solde intact
    execute 'set local role authenticated';
    v_message := null;
    begin perform public.valider_conge(v_conge_rtt);
    exception when invalid_parameter_value then v_message := sqlerrm; end;
    execute 'reset role';
    select solde_conges into v_solde from public.collaborateurs where id = v_fiche_collab;
    if v_message is null or v_solde <> v_solde_depart - 3 then
      raise exception 'Solde insuffisant : refus absent ou solde modifié (%)', v_solde;
    end if;

    -- Sans solde : validé, ne décompte rien
    execute 'set local role authenticated';
    perform public.valider_conge(v_conge_ss);
    execute 'reset role';
    select solde_conges into v_solde from public.collaborateurs where id = v_fiche_collab;
    if v_solde <> v_solde_depart - 3 then raise exception 'Un congé sans solde a décompté le solde (%)', v_solde; end if;

    -- Insertion directe d'un congé déjà validé (éditeur Supabase) → décompte aussi
    insert into public.conges (collaborateur_id, type, date_debut, date_fin, nb_jours, statut)
      values (v_fiche_collab, 'conges_payes', date '2031-10-01', date '2031-10-01', 1, 'validee');
    select solde_conges into v_solde from public.collaborateurs where id = v_fiche_collab;
    if v_solde <> v_solde_depart - 4 then raise exception 'Congé validé inséré directement : solde % au lieu de %', v_solde, v_solde_depart - 4; end if;

    -- Le manager ne valide pas SA propre demande
    insert into public.conges (collaborateur_id, type, date_debut, date_fin, nb_jours) values (v_fiche_manager, 'rtt', date '2031-11-03', date '2031-11-03', 1) returning id into v_autre;
    execute 'set local role authenticated';
    v_refuse := false;
    begin perform public.valider_conge(v_autre);
    exception when insufficient_privilege then v_refuse := true; end;
    execute 'reset role';
    if not v_refuse then raise exception 'Un manager a pu valider sa propre demande'; end if;

    -- Notes de frais : justificatif hors de son dossier refusé ; validée = figée ; pas de retour en arrière
    perform set_config('request.jwt.claims', json_build_object('sub', v_collab::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.notes_de_frais (collaborateur_id, date_depense, montant, categorie, justificatif_url)
      values (v_fiche_collab, date '2031-07-02', 42.50, 'Repas', v_fiche_collab::text || '/controle.jpg') returning id into v_note;
    v_refuse := false;
    begin
      insert into public.notes_de_frais (collaborateur_id, date_depense, montant, categorie, justificatif_url)
        values (v_fiche_collab, date '2031-07-02', 10, 'Repas', v_fiche_manager::text || '/vol.jpg');
    exception when insufficient_privilege then v_refuse := true; end;
    if not v_refuse then raise exception 'Une note a pu pointer vers le dossier d''un autre collaborateur'; end if;
    -- Stockage : dépôt dans SON dossier accepté, dans celui d'un autre refusé
    insert into storage.objects (bucket_id, name) values ('justificatifs', v_fiche_collab::text || '/controle.jpg');
    v_refuse := false;
    begin insert into storage.objects (bucket_id, name) values ('justificatifs', v_fiche_manager::text || '/intrus.jpg');
    exception when insufficient_privilege then v_refuse := true; end;
    if not v_refuse then raise exception 'Un collaborateur a pu déposer un fichier dans le dossier d''un autre'; end if;
    execute 'reset role';
    insert into storage.objects (bucket_id, name) values ('justificatifs', v_fiche_manager::text || '/sien.jpg');
    execute 'set local role authenticated';
    select count(*) into v_nb from storage.objects where bucket_id = 'justificatifs' and name like v_fiche_manager::text || '/%';
    if v_nb <> 0 then raise exception 'Un collaborateur peut lire % fichier(s) du dossier d''un autre', v_nb; end if;
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_nb from storage.objects where bucket_id = 'justificatifs' and name like v_fiche_collab::text || '/%';
    if v_nb < 1 then raise exception 'Le manager ne peut pas lire les justificatifs des collaborateurs'; end if;
    v_resultat := public.changer_statut_note(v_note, 'validee');
    if v_resultat <> 'validee' then raise exception 'Validation de note : %', v_resultat; end if;
    v_resultat := public.changer_statut_note(v_note, 'validee');
    if v_resultat <> 'deja_traitee' then raise exception 'Double validation de note : %', v_resultat; end if;
    execute 'reset role';
    v_refuse := false;
    begin update public.notes_de_frais set montant = 1000 where id = v_note;
    exception when insufficient_privilege then v_refuse := true; end;
    if not v_refuse then raise exception 'Le montant d''une note validée a pu être modifié'; end if;
    v_refuse := false;
    begin update public.notes_de_frais set statut = 'soumise' where id = v_note;
    exception when insufficient_privilege then v_refuse := true; end;
    if not v_refuse then raise exception 'Une note validée a pu revenir en « soumise »'; end if;

    raise exception 'annulation des simulations' using errcode = 'ZT001';
  exception when sqlstate 'ZT001' then
    null;
  end;

  select count(*) into v_nb from public.conges where date_debut >= date '2031-01-01';
  if v_nb <> 0 then raise exception 'Les données de simulation n''ont pas été annulées'; end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Absences : OK';
end
$$;
