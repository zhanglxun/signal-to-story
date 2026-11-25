-- DB0 schema snapshot (read-only). Returns ONE jsonb value describing the structure of the
-- public / private / storage schemas. No business rows are read except storage bucket ids.
-- Run in the Supabase SQL Editor and save the single cell to a file, then:
--   npx tsx testing/db/db0-diff.ts <saved-file.json>
-- The same query runs against PGlite to build the "repo" side (testing/db/schema-snapshot.ts).
with
schemas as (select unnest(array['public','private']) as s),
tbls as (
  select n.nspname as schema, c.relname as name, c.relkind::text as kind, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in (select s from schemas) and c.relkind in ('r','v','m','p')
),
cols as (
  select table_schema as schema, table_name as tbl, column_name as name, data_type as type,
         udt_name as udt, is_nullable = 'YES' as nullable, column_default as dflt
  from information_schema.columns where table_schema in (select s from schemas)
),
cons as (
  select n.nspname as schema, c.relname as tbl, k.conname as name, k.contype::text as type, pg_get_constraintdef(k.oid) as def
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in (select s from schemas)
),
idx as (
  select schemaname as schema, tablename as tbl, indexname as name, indexdef as def
  from pg_indexes where schemaname in (select s from schemas)
),
fns as (
  select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as result, p.prosecdef as security_definer,
         coalesce(array_to_string(p.proconfig, ','), '') as config, md5(p.prosrc) as body_md5,
         coalesce((select string_agg(r.rolname, ',' order by r.rolname) from aclexplode(p.proacl) a join pg_roles r on r.oid = a.grantee
                   where a.privilege_type = 'EXECUTE' and r.rolname in ('anon','authenticated','service_role','public')), '<default>') as execute_roles
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in (select s from schemas) and p.prokind in ('f','p')
),
trg as (
  select n.nspname as schema, c.relname as tbl, t.tgname as name, pg_get_triggerdef(t.oid) as def
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in ('public','private','storage')
),
pol as (
  select schemaname as schema, tablename as tbl, policyname as name, cmd, roles::text as roles,
         coalesce(qual, '') as using_expr, coalesce(with_check, '') as check_expr
  from pg_policies where schemaname in ('public','private','storage')
),
grt as (
  select table_schema as schema, table_name as tbl, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
  from information_schema.role_table_grants
  where table_schema in (select s from schemas) and grantee in ('anon','authenticated','service_role')
  group by 1, 2, 3
),
buckets as (select id, public from storage.buckets)
select jsonb_build_object(
  'tables',      (select coalesce(jsonb_agg(to_jsonb(t) order by schema, name), '[]') from tbls t),
  'columns',     (select coalesce(jsonb_agg(to_jsonb(c) order by schema, tbl, name), '[]') from cols c),
  'constraints', (select coalesce(jsonb_agg(to_jsonb(k) order by schema, tbl, name), '[]') from cons k),
  'indexes',     (select coalesce(jsonb_agg(to_jsonb(i) order by schema, tbl, name), '[]') from idx i),
  'functions',   (select coalesce(jsonb_agg(to_jsonb(f) order by schema, name, args), '[]') from fns f),
  'triggers',    (select coalesce(jsonb_agg(to_jsonb(g) order by schema, tbl, name), '[]') from trg g),
  'policies',    (select coalesce(jsonb_agg(to_jsonb(p) order by schema, tbl, name), '[]') from pol p),
  'grants',      (select coalesce(jsonb_agg(to_jsonb(g) order by schema, tbl, grantee), '[]') from grt g),
  'buckets',     (select coalesce(jsonb_agg(to_jsonb(b) order by id), '[]') from buckets b)
) as snapshot;

-- Second query (run separately; may not exist on databases never touched by the CLI):
-- select coalesce(jsonb_agg(jsonb_build_object('version', version, 'name', name) order by version), '[]') as migrations
-- from supabase_migrations.schema_migrations;
