-- Module 4 — Finance : facturer les temps validés
-- Pas de table de lignes de facture (voulu) : une facture = ses temps rattachés (temps.facture_id).
-- Convention : factures.tva = MONTANT de TVA (TVA 20 %), total_ttc = total_ht + tva.
-- 1. generer_facture(client, mois) : contrôles AVANT le numéro ; rattachement PUIS totaux ; une transaction.
-- 2. Déclencheurs (agissent aussi avec la clé secrète) : numéro immuable, aucune suppression,
--    montants figés hors brouillon ; temps facturé intouchable.
-- 3. RLS : factures et relances réservées à l'admin.
-- 4. Contrôles par assertion (simulations dans une transaction ANNULÉE : aucun numéro consommé).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Génération d'une facture
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.generer_facture(p_client_id uuid, p_mois date)
returns uuid
language plpgsql
security definer                       -- lit taux_horaire (illisible par l'API) sans jamais l'exposer
set search_path = public, pg_temp      -- prochain_numero cite « compteurs » sans préfixe
as $$
declare
  v_client text;
  v_debut date;
  v_fin date;
  v_nb int;
  v_sans_taux text;
  v_numero text;
  v_id uuid;
  v_rattaches int;
  v_ht numeric;
  v_tva numeric;
begin
  if not public.est_admin() then
    raise exception 'La facturation est réservée à l''administrateur' using errcode = '42501';
  end if;
  if p_client_id is null or p_mois is null then
    raise exception 'Choisissez un client et un mois' using errcode = '22023';
  end if;
  select c.nom into v_client from public.clients c where c.id = p_client_id;
  if not found then
    raise exception 'Client introuvable' using errcode = '22023';
  end if;

  v_debut := date_trunc('month', p_mois)::date;
  v_fin := (v_debut + interval '1 month' - interval '1 day')::date;

  -- Une seule facturation à la fois pour un même client
  perform pg_advisory_xact_lock(hashtextextended('facturation:' || p_client_id::text, 0));

  -- (a) Y a-t-il quelque chose à facturer ? (temps verrouillés pour la suite) — AVANT tout numéro
  select count(*) into v_nb from (
    select t.id
    from public.temps t
    join public.projets p on p.id = t.projet_id
    where p.client_id = p_client_id
      and t.statut = 'valide'
      and t.facture_id is null
      and t.date_saisie between v_debut and v_fin
    for update of t
  ) candidats;
  if v_nb = 0 then
    raise exception 'Rien à facturer : aucun temps validé et non facturé pour % en %', v_client, to_char(v_debut, 'MM/YYYY')
      using errcode = 'P0002';
  end if;

  -- (b) Un collaborateur concerné a-t-il un taux à 0 ? — AVANT tout numéro (on le nomme)
  select string_agg(distinct coalesce(c.prenom || ' ', '') || c.nom, ', ') into v_sans_taux
  from public.temps t
  join public.projets p on p.id = t.projet_id
  join public.collaborateurs c on c.id = t.collaborateur_id
  where p.client_id = p_client_id
    and t.statut = 'valide'
    and t.facture_id is null
    and t.date_saisie between v_debut and v_fin
    and c.taux_horaire <= 0;
  if v_sans_taux is not null then
    raise exception 'Génération refusée : taux horaire à 0 pour % — renseignez-le dans RH avant de facturer', v_sans_taux
      using errcode = '22023';
  end if;

  -- (c) Seulement maintenant : le numéro (rendu automatiquement si la suite échoue)
  v_numero := prochain_numero('facture', 'FAC');

  insert into public.factures
    (client_id, numero, date_emission, date_echeance, periode_debut, periode_fin, total_ht, tva, total_ttc, statut)
  values
    (p_client_id, v_numero, current_date, current_date + 30, v_debut, v_fin, 0, 0, 0, 'brouillon')
  returning id into v_id;

  -- (d) D'ABORD rattacher : uniquement les temps dont la facture est encore vide
  update public.temps t
  set facture_id = v_id
  from public.projets p
  where p.id = t.projet_id
    and p.client_id = p_client_id
    and t.statut = 'valide'
    and t.facture_id is null
    and t.date_saisie between v_debut and v_fin;
  get diagnostics v_rattaches = row_count;
  if v_rattaches = 0 then
    raise exception 'Plus aucun temps à facturer (facturés entre-temps) : facture annulée, numéro rendu';
  end if;

  -- (e) PUIS calculer les totaux sur les temps RÉELLEMENT rattachés : une ligne par projet et par taux
  select coalesce(sum(l.montant), 0) into v_ht
  from (
    select round(sum(t.heures) * c.taux_horaire, 2) as montant
    from public.temps t
    join public.collaborateurs c on c.id = t.collaborateur_id
    where t.facture_id = v_id
    group by t.projet_id, c.taux_horaire
  ) l;
  v_tva := round(v_ht * 0.20, 2);

  update public.factures set total_ht = v_ht, tva = v_tva, total_ttc = v_ht + v_tva where id = v_id;
  return v_id;
end
$$;

revoke execute on function public.generer_facture(uuid, date) from public, anon;
grant execute on function public.generer_facture(uuid, date) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Déclencheurs d'intégrité (ils s'appliquent AUSSI à la clé secrète, contrairement à la RLS)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.proteger_facture()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Suppression de facture interdite (la numérotation doit rester sans trou) : %', old.numero
      using errcode = '42501';
  end if;
  if new.numero is distinct from old.numero then
    raise exception 'Le numéro d''une facture ne peut jamais être modifié (%)', old.numero using errcode = '42501';
  end if;
  if old.statut <> 'brouillon' and new.statut = 'brouillon' then
    raise exception 'Une facture émise ne peut pas revenir en brouillon (%)', old.numero using errcode = '42501';
  end if;
  if old.statut <> 'brouillon' and (
       new.client_id is distinct from old.client_id
    or new.total_ht is distinct from old.total_ht
    or new.tva is distinct from old.tva
    or new.total_ttc is distinct from old.total_ttc
    or new.periode_debut is distinct from old.periode_debut
    or new.periode_fin is distinct from old.periode_fin
    or new.date_emission is distinct from old.date_emission
  ) then
    raise exception 'Montants, client et période sont figés depuis l''émission (%)', old.numero using errcode = '42501';
  end if;
  return new;
end
$$;

create or replace function public.interdire_vidage_factures()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Vidage de la table factures interdit' using errcode = '42501';
end
$$;

drop trigger if exists factures_proteger on public.factures;
create trigger factures_proteger
  before update or delete on public.factures
  for each row execute function public.proteger_facture();

drop trigger if exists factures_interdire_vidage on public.factures;
create trigger factures_interdire_vidage
  before truncate on public.factures
  for each statement execute function public.interdire_vidage_factures();

create or replace function public.proteger_temps_facture()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.facture_id is not null then
      raise exception 'Ce temps est facturé : il ne peut plus être supprimé' using errcode = '42501';
    end if;
    return old;
  end if;
  -- Déjà facturé : plus aucune modification (ni heures, ni statut, ni rattachement)
  if old.facture_id is not null then
    raise exception 'Ce temps est facturé : il ne peut plus être modifié ni refacturé' using errcode = '42501';
  end if;
  -- Rattachement à une facture : uniquement un temps validé
  if new.facture_id is not null and new.statut <> 'valide' then
    raise exception 'Seul un temps validé peut être facturé' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists temps_proteger_facture on public.temps;
create trigger temps_proteger_facture
  before update or delete on public.temps
  for each row execute function public.proteger_temps_facture();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS : factures et relances réservées à l'admin (lecture ET écriture)
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('factures', 'relances')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end
$$;

alter table public.factures enable row level security;
alter table public.relances enable row level security;

create policy factures_lecture_admin on public.factures
  for select to authenticated using (public.est_admin());
create policy factures_creation_admin on public.factures
  for insert to authenticated with check (public.est_admin());
create policy factures_modification_admin on public.factures
  for update to authenticated using (public.est_admin()) with check (public.est_admin());

create policy relances_lecture_admin on public.relances
  for select to authenticated using (public.est_admin());
create policy relances_creation_admin on public.relances
  for insert to authenticated with check (public.est_admin());
create policy relances_modification_admin on public.relances
  for update to authenticated using (public.est_admin()) with check (public.est_admin());

-- Une facture naît UNIQUEMENT par generer_facture ; seuls statut et date d'envoi changent ensuite.
revoke insert, update, delete, truncate on table public.factures from anon, authenticated;
grant update (statut, date_envoi) on table public.factures to authenticated;
revoke delete, truncate on table public.relances from anon, authenticated;
revoke all on table public.factures, public.relances from anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CONTRÔLES PAR ASSERTION
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_nb int;
  v_liste text;
  v_bool boolean;
  v_refuse boolean;
  v_message text;
  v_admin uuid;
  v_non_admin uuid;
  v_client uuid;
  v_autre_client uuid;
  v_projet uuid;
  v_projet_autre uuid;
  v_x uuid;
  v_y uuid;
  v_z uuid;
  v_facture uuid;
  v_numero text;
  v_temps_facture uuid;
  v_ht numeric;
  v_tva numeric;
  v_ttc numeric;
  v_compteurs_avant text;
  v_compteurs_apres text;
  v_mois date := date '2031-03-01';     -- mois fictif : aucune donnée réelle concernée
begin
  -- 4a. Structure
  select count(*) into v_nb from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'generer_facture' and p.prosecdef;
  if v_nb <> 1 then
    raise exception 'generer_facture absente ou pas en SECURITY DEFINER';
  end if;
  select count(*) into v_nb from pg_trigger
  where not tgisinternal and tgname in ('factures_proteger', 'factures_interdire_vidage', 'temps_proteger_facture');
  if v_nb <> 3 then
    raise exception 'Déclencheurs d''intégrité absents (% sur 3)', v_nb;
  end if;
  v_bool := has_table_privilege('authenticated', 'public.factures', 'insert')
         or has_table_privilege('authenticated', 'public.factures', 'delete')
         or has_column_privilege('authenticated', 'public.factures', 'numero', 'update')
         or has_column_privilege('authenticated', 'public.factures', 'total_ttc', 'update')
         or has_table_privilege('anon', 'public.factures', 'select');
  if v_bool then
    raise exception 'Une facture peut encore être créée, supprimée ou modifiée (numéro/total) directement par l''API';
  end if;
  select string_agg(t || '=' || coalesce(nb::text, '0'), ', ') into v_liste
  from (values ('factures', 3), ('relances', 3)) as attendu(t, n)
  left join (select tablename, count(*) as nb from pg_policies where schemaname = 'public' group by tablename) pp
    on pp.tablename = attendu.t
  where coalesce(pp.nb, 0) <> attendu.n;
  if v_liste is not null then
    raise exception 'Nombre de règles inattendu : %', v_liste;
  end if;

  select p.id into v_admin from public.profiles p
    where p.role = 'admin' and p.collaborateur_id is not null order by p.created_at limit 1;
  select p.id into v_non_admin from public.profiles p
    where p.role in ('manager', 'collaborateur') and p.collaborateur_id is not null order by p.created_at limit 1;

  -- 4b. Simulations (tout est ANNULÉ à la fin du bloc)
  begin
    select string_agg(cle || '=' || valeur, ',' order by cle) into v_compteurs_avant from public.compteurs;

    insert into public.clients (nom) values ('Client de contrôle') returning id into v_client;
    insert into public.clients (nom) values ('Autre client de contrôle') returning id into v_autre_client;
    insert into public.projets (nom, client_id, statut) values ('Projet de contrôle', v_client, 'en_cours') returning id into v_projet;
    insert into public.projets (nom, client_id, statut) values ('Projet autre client', v_autre_client, 'en_cours') returning id into v_projet_autre;
    insert into public.collaborateurs (nom, prenom, taux_horaire) values ('Contrôle', 'Xavier', 80) returning id into v_x;
    insert into public.collaborateurs (nom, prenom, taux_horaire) values ('Contrôle', 'Yvonne', 100) returning id into v_y;
    insert into public.collaborateurs (nom, prenom, taux_horaire) values ('Contrôle', 'Zoé', 0) returning id into v_z;

    insert into public.temps (collaborateur_id, projet_id, date_saisie, heures, statut) values
      (v_x, v_projet, v_mois + 2, 3, 'valide'),
      (v_x, v_projet, v_mois + 9, 2.5, 'valide'),
      (v_y, v_projet, v_mois + 15, 1.25, 'valide'),
      (v_x, v_projet, v_mois + 3, 4, 'soumis'),                       -- non validé : exclu
      (v_x, v_projet, (v_mois + interval '1 month')::date, 1, 'valide'),  -- autre mois : exclu
      (v_x, v_projet_autre, v_mois + 4, 9, 'valide');                 -- autre client : exclu

    if v_non_admin is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_non_admin::text, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_refuse := false;
      begin
        perform public.generer_facture(v_client, v_mois);
      exception when insufficient_privilege then v_refuse := true;
      end;
      if not v_refuse then
        raise exception 'Un non-admin a pu générer une facture';
      end if;
      select count(*) into v_nb from public.factures;
      if v_nb <> 0 then
        raise exception 'Un non-admin voit % facture(s)', v_nb;
      end if;
      execute 'reset role';
    end if;

    if v_admin is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';

      v_facture := public.generer_facture(v_client, v_mois);
      select f.numero, f.total_ht, f.tva, f.total_ttc into v_numero, v_ht, v_tva, v_ttc from public.factures f where f.id = v_facture;
      if v_numero !~ '^FAC-[0-9]{4}-[0-9]+$' then
        raise exception 'Numéro de facture au format inattendu : %', v_numero;
      end if;
      -- Lignes : (projet, 80 €) 5,5 h = 440,00 ; (projet, 100 €) 1,25 h = 125,00 → HT 565,00 ; TVA 113,00 ; TTC 678,00
      if v_ht <> 565.00 or v_tva <> 113.00 or v_ttc <> 678.00 then
        raise exception 'Totaux faux : HT % / TVA % / TTC % (attendu 565.00 / 113.00 / 678.00)', v_ht, v_tva, v_ttc;
      end if;
      execute 'reset role';
      select count(*) into v_nb from public.temps where facture_id = v_facture;
      if v_nb <> 3 then
        raise exception '% temps rattachés au lieu de 3 (non validés, autre mois ou autre client inclus ?)', v_nb;
      end if;

      -- Rien de plus à facturer → refus SANS consommer de numéro
      select string_agg(cle || '=' || valeur, ',' order by cle) into v_compteurs_avant from public.compteurs;
      execute 'set local role authenticated';
      v_message := null;
      begin
        perform public.generer_facture(v_client, v_mois);
      exception when sqlstate 'P0002' then v_message := sqlerrm;
      end;
      execute 'reset role';
      select string_agg(cle || '=' || valeur, ',' order by cle) into v_compteurs_apres from public.compteurs;
      if v_message is null or v_compteurs_apres is distinct from v_compteurs_avant then
        raise exception 'Refacturation : refus absent ou numéro consommé pour rien (% → %)', v_compteurs_avant, v_compteurs_apres;
      end if;

      -- Taux à 0 → refus en NOMMANT le collaborateur, sans consommer de numéro
      insert into public.temps (collaborateur_id, projet_id, date_saisie, heures, statut)
        values (v_z, v_projet, (v_mois + interval '2 month')::date, 2, 'valide');
      execute 'set local role authenticated';
      v_message := null;
      begin
        perform public.generer_facture(v_client, (v_mois + interval '2 month')::date);
      exception when invalid_parameter_value then v_message := sqlerrm;
      end;
      execute 'reset role';
      select string_agg(cle || '=' || valeur, ',' order by cle) into v_compteurs_apres from public.compteurs;
      if v_message is null or v_message not like '%Zoé Contrôle%' then
        raise exception 'Taux à 0 : refus absent ou collaborateur non nommé (message : %)', coalesce(v_message, 'aucun');
      end if;
      if v_compteurs_apres is distinct from v_compteurs_avant then
        raise exception 'Taux à 0 : un numéro a été consommé pour rien';
      end if;

      -- Intégrité, testée en propriétaire (comme la clé secrète : la RLS ne s'applique pas, les déclencheurs si)
      select t.id into v_temps_facture from public.temps t where t.facture_id = v_facture limit 1;
      v_refuse := false;
      begin update public.temps set heures = 1 where id = v_temps_facture;
      exception when insufficient_privilege then v_refuse := true; end;
      if not v_refuse then raise exception 'Un temps facturé a pu être modifié'; end if;
      v_refuse := false;
      begin update public.temps set facture_id = null where id = v_temps_facture;
      exception when insufficient_privilege then v_refuse := true; end;
      if not v_refuse then raise exception 'Un temps facturé a pu être détaché de sa facture'; end if;
      v_refuse := false;
      begin delete from public.temps where id = v_temps_facture;
      exception when insufficient_privilege then v_refuse := true; end;
      if not v_refuse then raise exception 'Un temps facturé a pu être supprimé'; end if;
      v_refuse := false;
      begin update public.factures set numero = 'FAC-PIRATE' where id = v_facture;
      exception when insufficient_privilege then v_refuse := true; end;
      if not v_refuse then raise exception 'Le numéro d''une facture a pu être modifié'; end if;
      v_refuse := false;
      begin delete from public.factures where id = v_facture;
      exception when insufficient_privilege then v_refuse := true; end;
      if not v_refuse then raise exception 'Une facture a pu être supprimée'; end if;
      v_refuse := false;
      begin truncate public.factures cascade;
      exception when insufficient_privilege then v_refuse := true; end;
      if not v_refuse then raise exception 'La table factures a pu être vidée'; end if;

      update public.factures set statut = 'emise' where id = v_facture;
      v_refuse := false;
      begin update public.factures set total_ht = 1, total_ttc = 1 where id = v_facture;
      exception when insufficient_privilege then v_refuse := true; end;
      if not v_refuse then raise exception 'Les montants d''une facture émise ont pu être modifiés'; end if;
      v_refuse := false;
      begin update public.factures set statut = 'brouillon' where id = v_facture;
      exception when insufficient_privilege then v_refuse := true; end;
      if not v_refuse then raise exception 'Une facture émise a pu revenir en brouillon'; end if;
      update public.factures set statut = 'payee' where id = v_facture;  -- avancer reste permis

      -- Un temps non validé ne peut pas être rattaché à une facture
      v_refuse := false;
      begin
        update public.temps set facture_id = v_facture
        where collaborateur_id = v_x and statut = 'soumis' and projet_id = v_projet;
      exception when insufficient_privilege then v_refuse := true;
      end;
      if not v_refuse then raise exception 'Un temps non validé a pu être rattaché à une facture'; end if;
    end if;

    raise exception 'annulation des simulations' using errcode = 'ZT001';
  exception when sqlstate 'ZT001' then
    null;
  end;

  select count(*) into v_nb from public.clients where nom like '%de contrôle%' or nom like 'Autre client de contrôle';
  if v_nb <> 0 then
    raise exception 'Les données de simulation n''ont pas été annulées';
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Finance : OK';
end
$$;
