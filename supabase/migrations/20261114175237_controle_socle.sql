-- Module 0 — Contrôle du socle
-- Cette migration NE MODIFIE RIEN. Elle vérifie que la base est bien celle décrite
-- dans CLAUDE.md, et fait échouer le déploiement sinon.

do $$
declare
  v_tables_attendues text[] := array[
    'clients','prospects','devis','devis_lignes','collaborateurs','projets',
    'factures','temps','relances','conges','notes_de_frais','compteurs','profiles'
  ];
  v_manquantes text;
  v_sans_rls text;
  v_nb int;
  v_public boolean;
  v_notnull boolean;
begin
  -- 1. Les 13 tables existent
  select string_agg(t, ', ') into v_manquantes
  from unnest(v_tables_attendues) as t
  where to_regclass('public.' || t) is null;
  if v_manquantes is not null then
    raise exception 'Tables manquantes : %', v_manquantes;
  end if;

  -- 2. La RLS est activée sur les 13 tables
  select string_agg(c.relname, ', ') into v_sans_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any (v_tables_attendues)
    and not c.relrowsecurity;
  if v_sans_rls is not null then
    raise exception 'RLS non activée sur : %', v_sans_rls;
  end if;

  -- 3. prochain_numero(p_cle text, p_prefixe text) existe avec ces noms exacts
  select count(*) into v_nb
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'prochain_numero'
    and p.proargnames[1:2] = array['p_cle','p_prefixe']
    and p.proargtypes = '25 25'::oidvector;  -- text, text
  if v_nb <> 1 then
    raise exception 'Fonction prochain_numero(p_cle text, p_prefixe text) introuvable (trouvées : %)', v_nb;
  end if;

  -- 4. Le bucket "justificatifs" existe et il est PRIVÉ
  select b.public into v_public from storage.buckets b where b.id = 'justificatifs';
  if v_public is null then
    raise exception 'Bucket de stockage "justificatifs" introuvable';
  end if;
  if v_public then
    raise exception 'Le bucket "justificatifs" est PUBLIC : il doit être privé';
  end if;

  -- 5. Un déclencheur sur auth.users alimente profiles
  select count(*) into v_nb
  from pg_trigger tg
  join pg_proc p on p.oid = tg.tgfoid
  where tg.tgrelid = 'auth.users'::regclass
    and not tg.tgisinternal
    and p.prosrc ilike '%profiles%';
  if v_nb = 0 then
    raise exception 'Aucun déclencheur sur auth.users ne crée de ligne dans profiles';
  end if;

  -- 6. collaborateurs.taux_horaire est NOT NULL
  select a.attnotnull into v_notnull
  from pg_attribute a
  where a.attrelid = 'public.collaborateurs'::regclass
    and a.attname = 'taux_horaire'
    and not a.attisdropped;
  if v_notnull is distinct from true then
    raise exception 'collaborateurs.taux_horaire devrait être NOT NULL';
  end if;

  raise notice 'Contrôle du socle : OK';
end
$$;
