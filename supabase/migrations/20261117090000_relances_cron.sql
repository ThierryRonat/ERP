-- Module Relances — planification par Supabase Cron (pg_cron + pg_net), toutes les 5 minutes.
--
-- ⚠️ Cette migration NE MODIFIE AUCUNE des 13 tables (photo des tables et colonnes avant/après, contrôlée à la fin).
-- ⚠️ Le JETON n'est écrit NI ici, NI dans la table des tâches (cron.job) : à chaque passage, la tâche lit le secret
--    « relances_secret » dans le Vault de Supabase.
-- Prérequis : secret « relances_secret » créé dans le Vault AVANT l'envoi (sinon la migration échoue, sans rien appliquer).
-- La tâche appelle l'adresse SANS jamais pouvoir forcer : l'anti-doublon (une relance par facture et par jour) s'applique.
--
-- Arrêter la tâche (éditeur SQL de Supabase) :   select cron.unschedule('relances-factures');

-- 0. Photo des tables de « public » (noms + colonnes + types), AVANT toute chose
drop table if exists pg_temp._photo_relances_cron;
create temporary table _photo_relances_cron as
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')) as nb_tables,
  (select md5(string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull,
                         ',' order by c.relname, a.attnum))
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'p')) as empreinte;

-- 1. Extensions fournies par Supabase (leurs données vont dans les schémas « cron » et « net », jamais dans « public »)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- 2. La tâche (rejouable : l'ancienne version éventuelle est retirée d'abord)
do $$
declare
  v_id bigint;
begin
  for v_id in select jobid from cron.job where jobname = 'relances-factures' loop
    perform cron.unschedule(v_id);
  end loop;
end $$;

select cron.schedule(
  'relances-factures',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://erp-ashen-six.vercel.app/api/relances',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'relances_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- 3. Lecture seule de l'état de la tâche (passages + réponses de l'adresse), pour la CLÉ DE SERVICE uniquement.
--    Ne renvoie jamais la commande de la tâche ni le jeton.
create or replace function public.etat_relances_cron()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'tache', (select jsonb_build_object('jobid', j.jobid, 'frequence', j.schedule, 'active', j.active)
                from cron.job j where j.jobname = 'relances-factures'),
    'passages', coalesce((
      select jsonb_agg(p order by p.debut desc) from (
        select d.status as statut, d.return_message as message, d.start_time as debut, d.end_time as fin
          from cron.job_run_details d
          join cron.job j on j.jobid = d.jobid
         where j.jobname = 'relances-factures'
         order by d.start_time desc
         limit 10) p), '[]'::jsonb),
    'reponses', coalesce((
      select jsonb_agg(r order by r.recue desc) from (
        select h.id, h.status_code as code_http, h.timed_out as delai_depasse, h.error_msg as erreur,
               left(h.content, 2000) as debut_reponse, h.created as recue
          from net._http_response h
         order by h.created desc
         limit 10) r), '[]'::jsonb)
  );
$$;
revoke all on function public.etat_relances_cron() from public, anon, authenticated;
grant execute on function public.etat_relances_cron() to service_role;

-- 4. AUTO-VÉRIFICATION : le déploiement échoue si un seul contrôle ne passe pas
do $$
declare
  v_attendues text[] := array[
    'clients','prospects','devis','devis_lignes','collaborateurs','projets',
    'factures','temps','relances','conges','notes_de_frais','compteurs','profiles'
  ];
  v_nb int;
  v_secret text;
  v_lg int;
  v_commande text;
  v_manquantes text;
  v_nb_avant int;
  v_nb_apres int;
  v_photo_avant text;
  v_photo_apres text;
begin
  -- a. Extensions actives
  select count(*) into v_nb from pg_extension where extname in ('pg_cron', 'pg_net');
  if v_nb <> 2 then
    raise exception 'Extensions pg_cron / pg_net non activées (% sur 2)', v_nb;
  end if;

  -- b. Secret présent dans le Vault
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'relances_secret' limit 1;
  if v_secret is null then
    raise exception 'Secret « relances_secret » absent du Vault : le créer dans Supabase AVANT l''envoi';
  end if;
  v_lg := length(v_secret);
  if v_lg < 32 then
    raise exception 'Secret « relances_secret » trop court (% caractères, 32 minimum)', v_lg;
  end if;

  -- c. UNE seule tâche, toutes les 5 minutes, active
  select count(*) into v_nb from cron.job where jobname = 'relances-factures';
  if v_nb <> 1 then
    raise exception 'Tâche relances-factures présente % fois (1 attendue)', v_nb;
  end if;
  select command into v_commande from cron.job
   where jobname = 'relances-factures' and schedule = '*/5 * * * *' and active;
  if v_commande is null then
    raise exception 'Tâche relances-factures : fréquence ou état inattendu';
  end if;

  -- d. Le jeton n'apparaît PAS dans la tâche ; elle le lit dans le Vault et appelle la bonne adresse
  if position(v_secret in v_commande) > 0 then
    raise exception 'Le JETON apparaît en clair dans la table des tâches';
  end if;
  if position('vault.decrypted_secrets' in v_commande) = 0
     or position('https://erp-ashen-six.vercel.app/api/relances' in v_commande) = 0 then
    raise exception 'La tâche ne lit pas le jeton dans le Vault ou n''appelle pas la bonne adresse';
  end if;

  -- e. La fonction de lecture n'est pas ouverte au public
  if has_function_privilege('anon', 'public.etat_relances_cron()', 'execute')
     or has_function_privilege('authenticated', 'public.etat_relances_cron()', 'execute') then
    raise exception 'etat_relances_cron() est appelable par anon ou authenticated';
  end if;

  -- f. Les 13 tables : toutes présentes, et AUCUNE table ni colonne modifiée par cette migration
  select string_agg(t, ', ') into v_manquantes
    from unnest(v_attendues) as t where to_regclass('public.' || t) is null;
  if v_manquantes is not null then
    raise exception 'Tables manquantes : %', v_manquantes;
  end if;
  select nb_tables, empreinte into v_nb_avant, v_photo_avant from pg_temp._photo_relances_cron;
  select count(*) into v_nb_apres from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p');
  select md5(string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull,
                        ',' order by c.relname, a.attnum))
    into v_photo_apres
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   where n.nspname = 'public' and c.relkind in ('r', 'p');
  if v_nb_apres <> v_nb_avant then
    raise exception 'Nombre de tables de public modifié : % avant, % après', v_nb_avant, v_nb_apres;
  end if;
  if v_photo_apres is distinct from v_photo_avant then
    raise exception 'Les colonnes des tables de public ont changé pendant la migration';
  end if;
end $$;

drop table if exists pg_temp._photo_relances_cron;
