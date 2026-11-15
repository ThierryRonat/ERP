-- Module 2 — Commercial : prospects, devis, devis_lignes, compteurs
-- Convention : devis.tva = MONTANT de TVA en euros (total_ttc = total_ht + tva).
-- 1. creer_devis() : numéro + devis + lignes dans UNE transaction (aucun trou possible),
--    totaux recalculés ICI, rôle vérifié ICI.
-- 2. prochain_numero() et compteurs : plus aucun accès direct depuis l'API.
-- 3. RLS : lecture pour tout compte rattaché ; écriture manager/admin ; devis modifiable
--    uniquement sur la colonne statut.
-- 4. Contrôles par assertion (simulations dans une transaction ANNULÉE : aucun numéro consommé).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Création d'un devis
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.creer_devis(
  p_prospect_id uuid,
  p_taux_tva numeric,
  p_lignes jsonb
)
returns uuid
language plpgsql
security definer
-- search_path = public : prochain_numero (déjà en base) cite « compteurs » sans préfixe
set search_path = public, pg_temp
as $$
declare
  v_role text := public.mon_role();
  v_ligne jsonb;
  v_designation text;
  v_quantite numeric;
  v_prix numeric;
  v_total_ht numeric := 0;
  v_tva numeric;
  v_numero text;
  v_id uuid;
begin
  if v_role is null or v_role not in ('admin', 'manager') or public.mon_collaborateur_id() is null then
    raise exception 'Création de devis réservée aux managers et administrateurs' using errcode = '42501';
  end if;
  if p_taux_tva is null or p_taux_tva < 0 or p_taux_tva > 100 then
    raise exception 'Taux de TVA invalide (entre 0 et 100)' using errcode = '22023';
  end if;
  if not exists (select 1 from public.prospects p where p.id = p_prospect_id) then
    raise exception 'Prospect introuvable' using errcode = '22023';
  end if;
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Un devis doit contenir au moins une ligne' using errcode = '22023';
  end if;

  -- Contrôle de chaque ligne + calcul du total HT (arrondi au centime par ligne)
  for v_ligne in select value from jsonb_array_elements(p_lignes) loop
    v_designation := btrim(v_ligne ->> 'designation');
    v_quantite := (v_ligne ->> 'quantite')::numeric;
    v_prix := (v_ligne ->> 'prix_unitaire')::numeric;
    if v_designation is null or v_designation = '' then
      raise exception 'Chaque ligne doit avoir une désignation' using errcode = '22023';
    end if;
    if v_quantite is null or v_quantite <= 0 then
      raise exception 'Quantité invalide pour « % »', v_designation using errcode = '22023';
    end if;
    if v_prix is null or v_prix < 0 then
      raise exception 'Prix unitaire invalide pour « % »', v_designation using errcode = '22023';
    end if;
    v_total_ht := v_total_ht + round(v_quantite * v_prix, 2);
  end loop;

  v_tva := round(v_total_ht * p_taux_tva / 100, 2);

  -- Le numéro est pris dans la MÊME transaction : si la suite échoue, il est rendu.
  v_numero := public.prochain_numero('devis', 'DEV');

  insert into public.devis (prospect_id, numero, date_emission, statut, total_ht, tva, total_ttc)
  values (p_prospect_id, v_numero, current_date, 'brouillon', v_total_ht, v_tva, v_total_ht + v_tva)
  returning id into v_id;

  -- created_at = clock_timestamp() : l'ordre de saisie des lignes est conservé.
  for v_ligne in select value from jsonb_array_elements(p_lignes) loop
    v_quantite := (v_ligne ->> 'quantite')::numeric;
    v_prix := (v_ligne ->> 'prix_unitaire')::numeric;
    insert into public.devis_lignes (devis_id, designation, quantite, prix_unitaire, montant_ht, created_at)
    values (v_id, btrim(v_ligne ->> 'designation'), v_quantite, v_prix, round(v_quantite * v_prix, 2), clock_timestamp());
  end loop;

  return v_id;
end
$$;

revoke execute on function public.creer_devis(uuid, numeric, jsonb) from public, anon;
grant execute on function public.creer_devis(uuid, numeric, jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Numérotation : plus aucun appel direct (sinon n'importe qui pourrait « brûler » des numéros)
-- ─────────────────────────────────────────────────────────────────────────────

revoke execute on function public.prochain_numero(text, text) from public, anon, authenticated;
grant execute on function public.prochain_numero(text, text) to service_role;

revoke all on table public.compteurs from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Règles RLS (balayage : on supprime toutes les règles existantes de ces 4 tables)
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('prospects', 'devis', 'devis_lignes', 'compteurs')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end
$$;

alter table public.prospects enable row level security;
alter table public.devis enable row level security;
alter table public.devis_lignes enable row level security;
alter table public.compteurs enable row level security;

-- prospects : lecture par tout compte rattaché ; création / modification par manager et admin
create policy prospects_lecture on public.prospects
  for select to authenticated
  using (public.mon_collaborateur_id() is not null);

create policy prospects_creation on public.prospects
  for insert to authenticated
  with check (public.mon_role() in ('admin', 'manager') and public.mon_collaborateur_id() is not null);

create policy prospects_modification on public.prospects
  for update to authenticated
  using (public.mon_role() in ('admin', 'manager') and public.mon_collaborateur_id() is not null)
  with check (public.mon_role() in ('admin', 'manager') and public.mon_collaborateur_id() is not null);

-- devis : lecture par tout compte rattaché ; seul le statut est modifiable (manager/admin).
-- Pas de règle d'insertion : un devis naît UNIQUEMENT par creer_devis().
create policy devis_lecture on public.devis
  for select to authenticated
  using (public.mon_collaborateur_id() is not null);

create policy devis_modification_statut on public.devis
  for update to authenticated
  using (public.mon_role() in ('admin', 'manager') and public.mon_collaborateur_id() is not null)
  with check (public.mon_role() in ('admin', 'manager') and public.mon_collaborateur_id() is not null);

revoke insert, update, delete on table public.devis from anon, authenticated;
grant update (statut) on table public.devis to authenticated;

-- devis_lignes : lecture seule (écriture uniquement par creer_devis())
create policy devis_lignes_lecture on public.devis_lignes
  for select to authenticated
  using (public.mon_collaborateur_id() is not null);

revoke insert, update, delete on table public.devis_lignes from anon, authenticated;

-- compteurs : aucune règle → aucun accès direct.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CONTRÔLES PAR ASSERTION
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_nb int;
  v_liste text;
  v_bool boolean;
  v_admin uuid;
  v_collab uuid;
  v_prospect uuid;
  v_total_prospects int;
  v_id1 uuid;
  v_id2 uuid;
  v_num1 text;
  v_num2 text;
  v_ht numeric;
  v_tva numeric;
  v_ttc numeric;
  v_premiere text;
  v_refuse boolean;
begin
  -- 4a. Structure
  select count(*) into v_nb from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'creer_devis' and p.prosecdef;
  if v_nb <> 1 then
    raise exception 'creer_devis absente ou pas en SECURITY DEFINER';
  end if;

  v_bool := has_function_privilege('authenticated', 'public.prochain_numero(text, text)', 'execute')
         or has_function_privilege('anon', 'public.prochain_numero(text, text)', 'execute');
  if v_bool then
    raise exception 'prochain_numero est encore appelable directement depuis l''API';
  end if;

  v_bool := has_table_privilege('authenticated', 'public.compteurs', 'select')
         or has_table_privilege('authenticated', 'public.compteurs', 'update');
  if v_bool then
    raise exception 'La table compteurs est encore accessible directement';
  end if;

  v_bool := has_table_privilege('authenticated', 'public.devis', 'insert')
         or has_column_privilege('authenticated', 'public.devis', 'total_ht', 'update')
         or has_column_privilege('authenticated', 'public.devis', 'numero', 'update')
         or has_table_privilege('authenticated', 'public.devis_lignes', 'insert');
  if v_bool then
    raise exception 'Les devis ou leurs lignes peuvent encore être écrits sans passer par creer_devis';
  end if;
  v_bool := has_column_privilege('authenticated', 'public.devis', 'statut', 'update');
  if not v_bool then
    raise exception 'Le statut d''un devis n''est pas modifiable';
  end if;

  select string_agg(t || '=' || coalesce(nb::text, '0'), ', ') into v_liste
  from (values ('prospects', 3), ('devis', 2), ('devis_lignes', 1), ('compteurs', 0)) as attendu(t, n)
  left join (select tablename, count(*) as nb from pg_policies where schemaname = 'public' group by tablename) pp
    on pp.tablename = attendu.t
  where coalesce(pp.nb, 0) <> attendu.n;
  if v_liste is not null then
    raise exception 'Nombre de règles inattendu : %', v_liste;
  end if;

  -- 4b. Simulations, dans un bloc ANNULÉ à la fin (aucun numéro consommé, rien d'enregistré)
  select count(*) into v_total_prospects from public.prospects;
  select p.id into v_admin from public.profiles p
    where p.role = 'admin' and p.collaborateur_id is not null order by p.created_at limit 1;
  select p.id into v_collab from public.profiles p
    where p.role = 'collaborateur' and p.collaborateur_id is not null order by p.created_at limit 1;

  begin
    -- Inconnu (connecté sans profil) : ne voit rien, ne crée rien
    perform set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_nb from public.prospects;
    if v_nb <> 0 then
      raise exception 'Un compte sans fiche voit % prospect(s)', v_nb;
    end if;
    v_refuse := false;
    begin
      perform public.creer_devis(gen_random_uuid(), 20, '[]'::jsonb);
    exception when insufficient_privilege then
      v_refuse := true;
    end;
    if not v_refuse then
      raise exception 'Un compte sans fiche a pu appeler creer_devis';
    end if;
    execute 'reset role';

    -- Collaborateur rattaché (s'il en existe un) : lit tout, n'écrit rien
    if v_collab is not null then
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_collab::text, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into v_nb from public.prospects;
      if v_nb <> v_total_prospects then
        raise exception 'Le collaborateur voit % prospect(s) sur %', v_nb, v_total_prospects;
      end if;
      v_refuse := false;
      begin
        insert into public.prospects (nom) values ('Intrus');
      exception when insufficient_privilege then
        v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Un collaborateur a pu créer un prospect';
      end if;
      v_refuse := false;
      begin
        perform public.creer_devis(gen_random_uuid(), 20, '[]'::jsonb);
      exception when insufficient_privilege then
        v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Un collaborateur a pu appeler creer_devis';
      end if;
      execute 'reset role';
    end if;

    -- Admin rattaché (s'il en existe un) : crée 2 devis, numéros consécutifs, totaux exacts
    if v_admin is not null then
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';

      insert into public.prospects (nom, societe) values ('Prospect de contrôle', 'Test') returning id into v_prospect;

      v_id1 := public.creer_devis(v_prospect, 20,
        '[{"designation":"Audit","quantite":2,"prix_unitaire":641.25},
          {"designation":"Formation","quantite":1.5,"prix_unitaire":0.333}]'::jsonb);
      v_id2 := public.creer_devis(v_prospect, 5.5, '[{"designation":"Conseil","quantite":1,"prix_unitaire":100}]'::jsonb);

      select d.numero, d.total_ht, d.tva, d.total_ttc into v_num1, v_ht, v_tva, v_ttc from public.devis d where d.id = v_id1;
      select d.numero into v_num2 from public.devis d where d.id = v_id2;

      if v_num1 !~ '^DEV-[0-9]{4}-[0-9]+$' then
        raise exception 'Numéro de devis au format inattendu : %', v_num1;
      end if;
      if (regexp_replace(v_num2, '^.*-', ''))::int <> (regexp_replace(v_num1, '^.*-', ''))::int + 1 then
        raise exception 'Numéros non consécutifs : % puis %', v_num1, v_num2;
      end if;
      -- 2 × 641,25 = 1282,50 ; 1,5 × 0,333 = 0,4995 → 0,50 ; HT 1283,00 ; TVA 256,60 ; TTC 1539,60
      if v_ht <> 1283.00 or v_tva <> 256.60 or v_ttc <> 1539.60 then
        raise exception 'Totaux faux : HT % / TVA % / TTC % (attendu 1283.00 / 256.60 / 1539.60)', v_ht, v_tva, v_ttc;
      end if;
      select l.designation into v_premiere from public.devis_lignes l
        where l.devis_id = v_id1 order by l.created_at limit 1;
      if v_premiere is distinct from 'Audit' then
        raise exception 'Ordre des lignes non conservé (première ligne : %)', v_premiere;
      end if;

      -- Statut modifiable, total non modifiable
      update public.devis set statut = 'envoye' where id = v_id1;
      get diagnostics v_nb = row_count;
      if v_nb <> 1 then
        raise exception 'L''admin ne peut pas changer le statut d''un devis';
      end if;
      v_refuse := false;
      begin
        update public.devis set total_ht = 0 where id = v_id1;
      exception when insufficient_privilege then
        v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Le total d''un devis a pu être modifié directement';
      end if;

      -- Ligne invalide : refus ET numéro non consommé
      v_refuse := false;
      begin
        perform public.creer_devis(v_prospect, 20, '[{"designation":"","quantite":1,"prix_unitaire":10}]'::jsonb);
      exception when invalid_parameter_value then
        v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Une ligne sans désignation a été acceptée';
      end if;
      v_id1 := public.creer_devis(v_prospect, 20, '[{"designation":"Suite","quantite":1,"prix_unitaire":1}]'::jsonb);
      select d.numero into v_num1 from public.devis d where d.id = v_id1;
      if (regexp_replace(v_num1, '^.*-', ''))::int <> (regexp_replace(v_num2, '^.*-', ''))::int + 1 then
        raise exception 'Un devis refusé a laissé un trou : % après %', v_num1, v_num2;
      end if;

      execute 'reset role';
    end if;

    -- On annule TOUT ce bloc (devis, lignes, prospect et compteur de test)
    raise exception 'annulation des simulations' using errcode = 'ZT001';
  exception when sqlstate 'ZT001' then
    null;
  end;

  -- Vérification : rien n'a été conservé
  select count(*) into v_nb from public.prospects where nom = 'Prospect de contrôle';
  if v_nb <> 0 then
    raise exception 'Les données de simulation n''ont pas été annulées';
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Commercial : OK';
end
$$;
