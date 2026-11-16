-- sense-site reader site: independent publish layer (docs-site/spec/sense-site-SPEC.md).
-- Back-office content tables keep their organization RLS. Readers never join an
-- organization; they only see explicitly published, online snapshots.
--
-- Tables
--   site_settings          one reader site per organization (display fields public when online)
--   site_categories        configurable topic categories (not a DB enum)
--   site_entries           public pointer + safe card metadata of the current release
--   site_entry_releases    immutable release record: source document/revision, publisher (back office only)
--   site_entry_bodies      immutable body snapshot per release (RLS: current release + access level)
--   site_release_events    publish / replace / republish / unpublish audit (back office only)
--   site_topics / site_topic_items   ordered learning paths across entries
--   site_resources         downloadable resource metadata (public listing)
--   site_resource_files    storage object path; row visible only when the caller may download
--   site_readers           reader profile; grants no organization permission
--   site_bookmarks         reader bookmarks
--
-- Writes to entries / releases / bodies / events only happen through
-- public.publish_site_entry and public.unpublish_site_entry (next migration).

-- Verified reader: signed in, not an anonymous Auth user, email confirmed.
create function private.is_verified_reader() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
    and exists (
      select 1 from auth.users u
      where u.id = (select auth.uid())
        and u.email_confirmed_at is not null
        and coalesce(u.is_anonymous, false) = false
    );
$$;
revoke all on function private.is_verified_reader() from public, anon, authenticated;
grant execute on function private.is_verified_reader() to authenticated;

create table public.site_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 64),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  base_url text not null default '' check (base_url = '' or base_url ~ '^https?://[^[:space:]]+$'),
  status text not null default 'draft' check (status in ('draft', 'online', 'offline')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.site_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  site_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 64),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 500),
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, slug), unique (site_id, id),
  foreign key (organization_id, site_id) references public.site_settings(organization_id, id)
);

create table public.site_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  site_id uuid not null,
  source_document_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 96),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  summary text not null check (char_length(btrim(summary)) between 1 and 500),
  category_id uuid,
  format text not null check (format in ('article', 'tutorial', 'video', 'comic', 'resource')),
  column_key text check (column_key in ('news', 'analysis', 'how_to', 'case')),
  cover_url text not null default '' check (cover_url = '' or cover_url ~ '^https://[^[:space:]]+$'),
  cover_alt text not null default '' check (char_length(cover_alt) <= 200),
  -- First release supports public / registered only; member / purchase are deliberately rejected.
  access_level text not null check (access_level in ('public', 'registered')),
  status text not null default 'offline' check (status in ('online', 'offline')),
  current_release_id uuid,
  current_version integer not null default 0 check (current_version >= 0),
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  offline_at timestamptz,
  unique (site_id, slug), unique (site_id, id), unique (site_id, source_document_id), unique (organization_id, id),
  foreign key (organization_id, site_id) references public.site_settings(organization_id, id),
  foreign key (site_id, category_id) references public.site_categories(site_id, id),
  foreign key (organization_id, source_document_id) references public.content_documents(organization_id, id),
  check (status <> 'online' or current_release_id is not null)
);

create table public.site_entry_releases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  site_id uuid not null,
  entry_id uuid not null,
  version integer not null check (version >= 1),
  source_document_id uuid not null,
  source_revision integer not null,
  source_platform text not null,
  title text not null,
  display_meta jsonb not null check (jsonb_typeof(display_meta) = 'object'),
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  unique (entry_id, version), unique (site_id, id),
  constraint site_entry_releases_entry_fkey foreign key (site_id, entry_id) references public.site_entries(site_id, id),
  foreign key (organization_id, source_document_id, source_revision)
    references public.content_revisions(organization_id, document_id, revision)
);
alter table public.site_entries
  add constraint site_entries_current_release_fkey
  foreign key (site_id, current_release_id) references public.site_entry_releases(site_id, id);

create table public.site_entry_bodies (
  release_id uuid primary key,
  organization_id uuid not null,
  site_id uuid not null,
  entry_id uuid not null,
  markdown text not null check (char_length(markdown) <= 100000),
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array'),
  source_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs) = 'array'),
  created_at timestamptz not null default now(),
  foreign key (site_id, release_id) references public.site_entry_releases(site_id, id),
  foreign key (site_id, entry_id) references public.site_entries(site_id, id)
);

create table public.site_release_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  site_id uuid not null,
  entry_id uuid not null,
  release_id uuid,
  action text not null check (action in ('publish', 'replace', 'republish', 'unpublish')),
  note text not null default '' check (char_length(note) <= 1000),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (site_id, entry_id) references public.site_entries(site_id, id),
  foreign key (site_id, release_id) references public.site_entry_releases(site_id, id)
);

create table public.site_topics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  site_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 64),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  cover_url text not null default '' check (cover_url = '' or cover_url ~ '^https://[^[:space:]]+$'),
  cover_alt text not null default '' check (char_length(cover_alt) <= 200),
  status text not null default 'draft' check (status in ('draft', 'online', 'offline')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, slug), unique (site_id, id),
  foreign key (organization_id, site_id) references public.site_settings(organization_id, id)
);

create table public.site_topic_items (
  organization_id uuid not null,
  site_id uuid not null,
  topic_id uuid not null,
  entry_id uuid not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (topic_id, entry_id),
  foreign key (organization_id, site_id) references public.site_settings(organization_id, id),
  foreign key (site_id, topic_id) references public.site_topics(site_id, id) on delete cascade,
  foreign key (site_id, entry_id) references public.site_entries(site_id, id)
);

create table public.site_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  site_id uuid not null,
  entry_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 1000),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  mime_type text not null default 'application/octet-stream' check (char_length(mime_type) <= 120),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  access_level text not null check (access_level in ('public', 'registered')),
  status text not null default 'offline' check (status in ('online', 'offline')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, id),
  foreign key (organization_id, site_id) references public.site_settings(organization_id, id),
  foreign key (site_id, entry_id) references public.site_entries(site_id, id)
);

create table public.site_resource_files (
  resource_id uuid primary key,
  organization_id uuid not null,
  site_id uuid not null,
  bucket text not null default 'site-resources' check (bucket = 'site-resources'),
  object_path text not null unique check (object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^[:space:]]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, site_id) references public.site_settings(organization_id, id),
  foreign key (site_id, resource_id) references public.site_resources(site_id, id) on delete cascade
);

create table public.site_readers (
  site_id uuid not null references public.site_settings(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, user_id)
);

create table public.site_bookmarks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  site_id uuid not null,
  entry_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, entry_id),
  foreign key (site_id, entry_id) references public.site_entries(site_id, id) on delete cascade
);

create index on public.site_settings (organization_id);
create index on public.site_categories (organization_id, site_id);
create index on public.site_entries (site_id, status, published_at desc, id desc);
create index on public.site_entries (organization_id, source_document_id);
create index on public.site_entries (site_id, category_id);
create index on public.site_entries (site_id, current_release_id);
create index on public.site_entry_releases (organization_id, source_document_id, source_revision);
create index on public.site_entry_releases (site_id, entry_id);
create index on public.site_entry_releases (published_by);
create index on public.site_entry_bodies (site_id, entry_id);
create index on public.site_entry_bodies (organization_id);
create index on public.site_release_events (site_id, entry_id, created_at desc);
create index on public.site_release_events (site_id, release_id);
create index on public.site_release_events (organization_id);
create index on public.site_release_events (actor_id);
create index on public.site_topics (organization_id, site_id);
create index on public.site_topic_items (site_id, entry_id);
create index on public.site_topic_items (site_id, topic_id, sort_order);
create index on public.site_topic_items (organization_id, site_id);
create index on public.site_resources (organization_id, site_id);
create index on public.site_resources (site_id, entry_id);
create index on public.site_resource_files (organization_id, site_id);
create index on public.site_resource_files (site_id, resource_id);
create index on public.site_readers (user_id);
create index on public.site_bookmarks (site_id, entry_id);
create index on public.site_bookmarks (user_id, created_at desc);

-- Managed rows: organization / site never move; updated_at is server-owned.
create function private.guard_site_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if to_jsonb(new) ->> 'organization_id' is distinct from to_jsonb(old) ->> 'organization_id'
      or to_jsonb(new) ->> 'site_id' is distinct from to_jsonb(old) ->> 'site_id' then
      raise exception '不能修改所属组织或站点' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end; $$;
revoke all on function private.guard_site_row() from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['site_settings', 'site_categories', 'site_topics', 'site_topic_items', 'site_resources', 'site_resource_files', 'site_readers'] loop
    execute format('create trigger site_guard before insert or update on public.%I for each row execute function private.guard_site_row()', t);
  end loop;
end $$;

-- Release history is immutable, even for the publish function.
create function private.forbid_site_snapshot_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '站点发布快照与审计记录不可修改或删除' using errcode = '42501';
end; $$;
revoke all on function private.forbid_site_snapshot_mutation() from public, anon, authenticated;
create trigger site_snapshot_immutable before update or delete on public.site_entry_releases
  for each row execute function private.forbid_site_snapshot_mutation();
create trigger site_snapshot_immutable before update or delete on public.site_entry_bodies
  for each row execute function private.forbid_site_snapshot_mutation();
create trigger site_snapshot_immutable before update or delete on public.site_release_events
  for each row execute function private.forbid_site_snapshot_mutation();

-- RLS everywhere; table-level exposure is granted explicitly below.
do $$ declare t text; begin
  foreach t in array array['site_settings', 'site_categories', 'site_entries', 'site_entry_releases', 'site_entry_bodies', 'site_release_events', 'site_topics', 'site_topic_items', 'site_resources', 'site_resource_files', 'site_readers', 'site_bookmarks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Public column sets. site_entries hides organization_id and source_document_id.
grant select (id, slug, name, description, base_url, status) on public.site_settings to anon;
grant select on public.site_settings to authenticated;
grant select on public.site_categories to anon, authenticated;
grant select (id, site_id, slug, title, summary, category_id, format, column_key, cover_url, cover_alt, access_level, status, current_release_id, current_version, published_at, updated_at)
  on public.site_entries to anon, authenticated;
grant select on public.site_entry_bodies to anon, authenticated;
grant select on public.site_topics, public.site_topic_items, public.site_resources to anon, authenticated;
grant select on public.site_resource_files to anon, authenticated;
grant select on public.site_entry_releases, public.site_release_events to authenticated;
grant insert, update on public.site_settings, public.site_categories, public.site_topics, public.site_topic_items, public.site_resources, public.site_resource_files to authenticated;
grant delete on public.site_topic_items to authenticated;
grant select, insert on public.site_readers to authenticated;
grant update (display_name) on public.site_readers to authenticated;
grant select, insert, delete on public.site_bookmarks to authenticated;

-- site_settings
create policy site_settings_public on public.site_settings for select to anon using (status = 'online');
create policy site_settings_read on public.site_settings for select to authenticated
  using (status = 'online' or (select private.has_organization_permission(organization_id, 'content.view')));
create policy site_settings_insert on public.site_settings for insert to authenticated
  with check ((select private.has_organization_permission(organization_id, 'content.publish')));
create policy site_settings_update on public.site_settings for update to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.publish')))
  with check ((select private.has_organization_permission(organization_id, 'content.publish')));

-- Visibility of children composes the RLS of site_settings / site_entries via EXISTS.
create policy site_categories_public on public.site_categories for select to anon
  using (enabled and exists (select 1 from public.site_settings s where s.id = site_id and s.status = 'online'));
create policy site_categories_read on public.site_categories for select to authenticated
  using ((enabled and exists (select 1 from public.site_settings s where s.id = site_id and s.status = 'online'))
    or (select private.has_organization_permission(organization_id, 'content.view')));

create policy site_entries_public on public.site_entries for select to anon
  using (status = 'online' and exists (select 1 from public.site_settings s where s.id = site_id and s.status = 'online'));
create policy site_entries_read on public.site_entries for select to authenticated
  using ((status = 'online' and exists (select 1 from public.site_settings s where s.id = site_id and s.status = 'online'))
    or (select private.has_organization_permission(organization_id, 'content.view')));

-- Bodies: only the current release of an online entry, gated by access level.
create policy site_entry_bodies_public on public.site_entry_bodies for select to anon
  using (exists (
    select 1 from public.site_entries e
    where e.id = entry_id and e.current_release_id = release_id and e.status = 'online' and e.access_level = 'public'));
create policy site_entry_bodies_read on public.site_entry_bodies for select to authenticated
  using (exists (
      select 1 from public.site_entries e
      where e.id = entry_id and e.current_release_id = release_id and e.status = 'online'
        and (e.access_level = 'public' or (e.access_level = 'registered' and (select private.is_verified_reader()))))
    or (select private.has_organization_permission(organization_id, 'content.view')));

create policy site_entry_releases_read on public.site_entry_releases for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.view')));
create policy site_release_events_read on public.site_release_events for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.view')));

create policy site_topics_public on public.site_topics for select to anon
  using (status = 'online' and exists (select 1 from public.site_settings s where s.id = site_id and s.status = 'online'));
create policy site_topics_read on public.site_topics for select to authenticated
  using ((status = 'online' and exists (select 1 from public.site_settings s where s.id = site_id and s.status = 'online'))
    or (select private.has_organization_permission(organization_id, 'content.view')));

create policy site_topic_items_public on public.site_topic_items for select to anon
  using (exists (select 1 from public.site_topics t where t.id = topic_id and t.status = 'online')
    and exists (select 1 from public.site_entries e where e.id = entry_id and e.status = 'online'));
create policy site_topic_items_read on public.site_topic_items for select to authenticated
  using ((exists (select 1 from public.site_topics t where t.id = topic_id and t.status = 'online')
      and exists (select 1 from public.site_entries e where e.id = entry_id and e.status = 'online'))
    or (select private.has_organization_permission(organization_id, 'content.view')));

create policy site_resources_public on public.site_resources for select to anon
  using (status = 'online'
    and exists (select 1 from public.site_settings s where s.id = site_id and s.status = 'online')
    and (entry_id is null or exists (select 1 from public.site_entries e where e.id = entry_id and e.status = 'online')));
create policy site_resources_read on public.site_resources for select to authenticated
  using ((status = 'online'
      and exists (select 1 from public.site_settings s where s.id = site_id and s.status = 'online')
      and (entry_id is null or exists (select 1 from public.site_entries e where e.id = entry_id and e.status = 'online')))
    or (select private.has_organization_permission(organization_id, 'content.view')));

-- A file row is the download authorization: visible only when the caller may download.
create policy site_resource_files_public on public.site_resource_files for select to anon
  using (exists (select 1 from public.site_resources r where r.id = resource_id and r.status = 'online' and r.access_level = 'public'));
create policy site_resource_files_read on public.site_resource_files for select to authenticated
  using (exists (
      select 1 from public.site_resources r
      where r.id = resource_id and r.status = 'online'
        and (r.access_level = 'public' or (r.access_level = 'registered' and (select private.is_verified_reader()))))
    or (select private.has_organization_permission(organization_id, 'content.view')));

-- Back-office management of display structure (never of entries / bodies).
do $$ declare t text; begin
  foreach t in array array['site_categories', 'site_topics', 'site_topic_items', 'site_resources', 'site_resource_files'] loop
    execute format('create policy site_manage_insert on public.%I for insert to authenticated with check ((select private.has_organization_permission(organization_id, ''content.publish'')))', t);
    execute format('create policy site_manage_update on public.%I for update to authenticated using ((select private.has_organization_permission(organization_id, ''content.publish''))) with check ((select private.has_organization_permission(organization_id, ''content.publish'')))', t);
  end loop;
end $$;
create policy site_topic_items_delete on public.site_topic_items for delete to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.publish')));

-- Readers: own profile and bookmarks only. No organization membership is created.
create policy site_readers_self_read on public.site_readers for select to authenticated
  using (user_id = (select auth.uid()));
create policy site_readers_self_insert on public.site_readers for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_verified_reader())
    and exists (select 1 from public.site_settings s where s.id = site_id and s.status = 'online'));
create policy site_readers_self_update on public.site_readers for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy site_bookmarks_self_read on public.site_bookmarks for select to authenticated
  using (user_id = (select auth.uid())
    and exists (select 1 from public.site_entries e where e.id = entry_id and e.site_id = site_bookmarks.site_id and e.status = 'online'));
create policy site_bookmarks_self_insert on public.site_bookmarks for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_verified_reader())
    and exists (select 1 from public.site_entries e where e.id = entry_id and e.site_id = site_bookmarks.site_id and e.status = 'online'));
create policy site_bookmarks_self_delete on public.site_bookmarks for delete to authenticated
  using (user_id = (select auth.uid()));

-- Private bucket for downloadable resources. Object path: <organization_id>/<site_id>/<file>.
insert into storage.buckets (id, name, public, file_size_limit)
values ('site-resources', 'site-resources', false, 52428800)
on conflict (id) do nothing;

create policy site_resources_object_read_anon on storage.objects for select to anon
  using (bucket_id = 'site-resources'
    and exists (select 1 from public.site_resource_files f where f.bucket = 'site-resources' and f.object_path = objects.name));
create policy site_resources_object_read on storage.objects for select to authenticated
  using (bucket_id = 'site-resources'
    and exists (select 1 from public.site_resource_files f where f.bucket = 'site-resources' and f.object_path = objects.name));
-- CASE guarantees evaluation order, so the uuid cast never runs for other buckets or malformed paths.
create policy site_resources_object_insert on storage.objects for insert to authenticated
  with check (case when bucket_id = 'site-resources' and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.has_organization_permission(((storage.foldername(name))[1])::uuid, 'content.publish') else false end);
create policy site_resources_object_delete on storage.objects for delete to authenticated
  using (case when bucket_id = 'site-resources' and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.has_organization_permission(((storage.foldername(name))[1])::uuid, 'content.publish') else false end);

-- Default site for the existing organization, created as draft: nothing is public until a publisher sets it online.
insert into public.site_settings (organization_id, slug, name, description)
select id, 'signal-to-story', '星火工厂 · Signal to Story', '企业 AI 实战、AI 知识科普、工具与工作流、故事与创意。'
from public.organizations where slug = 'signal-to-story'
on conflict (slug) do nothing;
