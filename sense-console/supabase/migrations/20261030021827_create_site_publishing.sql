-- sense-site publishing layer: public catalog snapshots independent of org content RLS.
-- Readers use anon/authenticated SELECT via RLS; publish/unpublish are controlled RPCs.

create or replace function private.is_verified_reader()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
      and coalesce((u.raw_app_meta_data ->> 'provider') = 'anonymous', false) = false
      and coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );
$$;
revoke all on function private.is_verified_reader() from public, anon, authenticated;
grant execute on function private.is_verified_reader() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- site_settings
-- ---------------------------------------------------------------------------
create table public.site_settings (
  site_id text primary key check (char_length(btrim(site_id)) between 1 and 64),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  base_url text not null default '' check (base_url = '' or base_url ~ '^https?://[^[:space:]]+$'),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, site_id)
);

comment on table public.site_settings is 'Reader-site configuration; one logical site per row.';

-- ---------------------------------------------------------------------------
-- site_categories
-- ---------------------------------------------------------------------------
create table public.site_categories (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.site_settings(site_id) on delete cascade,
  organization_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 1 and 64),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  sort_order integer not null default 0 check (sort_order between -100000 and 100000),
  enabled boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, slug),
  unique (site_id, id),
  foreign key (organization_id, site_id) references public.site_settings(organization_id, site_id)
);

-- ---------------------------------------------------------------------------
-- site_entries (safe metadata only)
-- ---------------------------------------------------------------------------
create table public.site_entries (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.site_settings(site_id) on delete cascade,
  organization_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 1 and 120),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  summary text not null check (char_length(btrim(summary)) between 1 and 1000),
  category_id uuid not null,
  form text not null check (form in ('article', 'tutorial', 'video', 'comic', 'resource')),
  content_column text not null check (content_column in ('news', 'analysis', 'how_to', 'case')),
  cover_url text not null default '' check (cover_url = '' or cover_url ~ '^https?://[^[:space:]]+$'),
  access_level text not null check (access_level in ('public', 'registered', 'member')),
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished')),
  featured boolean not null default false,
  published_at timestamptz,
  unpublished_at timestamptz,
  current_version integer,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, slug),
  unique (site_id, id),
  unique (id, current_version),
  foreign key (organization_id, site_id) references public.site_settings(organization_id, site_id),
  foreign key (site_id, category_id) references public.site_categories(site_id, id),
  check (
    (status = 'published' and published_at is not null and current_version is not null)
    or (status <> 'published')
  )
);

create index site_entries_published_idx
  on public.site_entries (site_id, status, published_at desc, id desc)
  where status = 'published';
create index site_entries_category_idx on public.site_entries (site_id, category_id, published_at desc);
create index site_entries_featured_idx on public.site_entries (site_id, featured, published_at desc)
  where status = 'published' and featured;

-- ---------------------------------------------------------------------------
-- site_entry_bodies (immutable snapshots; RLS independently protects bodies)
-- ---------------------------------------------------------------------------
create table public.site_entry_bodies (
  entry_id uuid not null references public.site_entries(id) on delete cascade,
  version integer not null check (version >= 1),
  site_id text not null,
  organization_id uuid not null,
  access_level text not null check (access_level in ('public', 'registered', 'member')),
  markdown text not null check (char_length(markdown) between 1 and 200000),
  sources jsonb not null default '[]'::jsonb
    check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 50),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (entry_id, version),
  foreign key (site_id, entry_id) references public.site_entries(site_id, id)
);

create index site_entry_bodies_site_idx on public.site_entry_bodies (site_id, entry_id);

-- ---------------------------------------------------------------------------
-- site_topics / site_topic_items
-- ---------------------------------------------------------------------------
create table public.site_topics (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.site_settings(site_id) on delete cascade,
  organization_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 1 and 120),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  cover_url text not null default '' check (cover_url = '' or cover_url ~ '^https?://[^[:space:]]+$'),
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished')),
  sort_order integer not null default 0,
  published_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, slug),
  unique (site_id, id),
  foreign key (organization_id, site_id) references public.site_settings(organization_id, site_id)
);

create table public.site_topic_items (
  topic_id uuid not null,
  entry_id uuid not null references public.site_entries(id) on delete cascade,
  site_id text not null,
  organization_id uuid not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (topic_id, entry_id),
  foreign key (site_id, topic_id) references public.site_topics(site_id, id) on delete cascade,
  foreign key (site_id, entry_id) references public.site_entries(site_id, id) on delete cascade
);

create index site_topic_items_entry_idx on public.site_topic_items (entry_id);

-- ---------------------------------------------------------------------------
-- release audit
-- ---------------------------------------------------------------------------
create table public.site_release_sources (
  entry_id uuid not null,
  version integer not null,
  organization_id uuid not null,
  document_id uuid not null,
  revision integer not null,
  created_at timestamptz not null default now(),
  primary key (entry_id, version),
  foreign key (entry_id, version) references public.site_entry_bodies(entry_id, version) on delete cascade,
  foreign key (organization_id, document_id, revision)
    references public.content_revisions(organization_id, document_id, revision)
);

create table public.site_release_events (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  organization_id uuid not null,
  entry_id uuid not null references public.site_entries(id) on delete cascade,
  event_type text not null check (event_type in ('publish', 'unpublish', 'replace')),
  version integer,
  actor_id uuid not null references auth.users(id) on delete restrict,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index site_release_events_entry_idx on public.site_release_events (entry_id, created_at desc);

-- ---------------------------------------------------------------------------
-- resources & bookmarks
-- ---------------------------------------------------------------------------
create table public.site_resources (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.site_settings(site_id) on delete cascade,
  organization_id uuid not null,
  entry_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  access_level text not null check (access_level in ('public', 'registered', 'member')),
  status text not null default 'available' check (status in ('available', 'revoked')),
  storage_path text not null default '' check (char_length(storage_path) <= 512),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, site_id) references public.site_settings(organization_id, site_id),
  foreign key (site_id, entry_id) references public.site_entries(site_id, id) on delete set null
);

create table public.site_bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null references public.site_entries(id) on delete cascade,
  site_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, entry_id),
  foreign key (site_id, entry_id) references public.site_entries(site_id, id) on delete cascade
);

create index site_bookmarks_user_idx on public.site_bookmarks (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: revoke all, grant minimal SELECT; writes via RPC or org-scoped policies
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'site_settings','site_categories','site_entries','site_entry_bodies',
    'site_topics','site_topic_items','site_release_sources','site_release_events',
    'site_resources','site_bookmarks'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Public-safe metadata: published entries (all access levels for teaser cards)
grant select (
  id, site_id, organization_id, slug, title, summary, category_id, form, content_column,
  cover_url, access_level, status, featured, published_at, unpublished_at, current_version,
  created_at, updated_at
) on public.site_entries to anon, authenticated;

create policy site_entries_public_read on public.site_entries
  for select to anon, authenticated
  using (status = 'published');

-- Categories: enabled only for readers
grant select (id, site_id, slug, name, description, sort_order, enabled, created_at, updated_at)
  on public.site_categories to anon, authenticated;

create policy site_categories_public_read on public.site_categories
  for select to anon, authenticated
  using (
    enabled
    and exists (
      select 1 from public.site_settings s
      where s.site_id = site_categories.site_id and s.status = 'active'
    )
  );

-- Topics: published only
grant select (id, site_id, slug, title, description, cover_url, status, sort_order, published_at, created_at, updated_at)
  on public.site_topics to anon, authenticated;

create policy site_topics_public_read on public.site_topics
  for select to anon, authenticated
  using (status = 'published');

grant select (topic_id, entry_id, site_id, sort_order)
  on public.site_topic_items to anon, authenticated;

create policy site_topic_items_public_read on public.site_topic_items
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.site_topics t
      where t.id = site_topic_items.topic_id and t.status = 'published'
    )
    and exists (
      select 1 from public.site_entries e
      where e.id = site_topic_items.entry_id and e.status = 'published'
    )
  );

-- Settings: display fields only when active
grant select (site_id, name, description, base_url, status)
  on public.site_settings to anon, authenticated;

create policy site_settings_public_read on public.site_settings
  for select to anon, authenticated
  using (status = 'active');

-- Bodies: independent RLS. Member bodies never readable (schema reserved).
grant select (entry_id, version, site_id, access_level, markdown, sources, created_at)
  on public.site_entry_bodies to anon, authenticated;

create policy site_entry_bodies_public_read on public.site_entry_bodies
  for select to anon, authenticated
  using (
    access_level = 'public'
    and exists (
      select 1 from public.site_entries e
      where e.id = site_entry_bodies.entry_id
        and e.status = 'published'
        and e.current_version = site_entry_bodies.version
    )
  );

create policy site_entry_bodies_registered_read on public.site_entry_bodies
  for select to authenticated
  using (
    access_level = 'registered'
    and (select private.is_verified_reader())
    and exists (
      select 1 from public.site_entries e
      where e.id = site_entry_bodies.entry_id
        and e.status = 'published'
        and e.current_version = site_entry_bodies.version
    )
  );
-- No policy for access_level = 'member' → bodies never returned.

-- Resources: metadata only; no storage_path to anon
grant select (id, site_id, entry_id, title, description, access_level, status, created_at, updated_at)
  on public.site_resources to anon, authenticated;

create policy site_resources_public_read on public.site_resources
  for select to anon, authenticated
  using (status = 'available');

-- Bookmarks: owner only
grant select, insert, delete on public.site_bookmarks to authenticated;

create policy site_bookmarks_owner_select on public.site_bookmarks
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy site_bookmarks_owner_insert on public.site_bookmarks
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.site_entries e
      where e.id = entry_id and e.status = 'published'
    )
  );

create policy site_bookmarks_owner_delete on public.site_bookmarks
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Org staff: manage catalog metadata (not bodies / published pointer — those go through RPC)
grant select, insert, update, delete on public.site_settings to authenticated;
grant select, insert, update, delete on public.site_categories to authenticated;
grant select, insert, update, delete on public.site_topics to authenticated;
grant select, insert, update, delete on public.site_topic_items to authenticated;
grant select, insert, update on public.site_entries to authenticated;
grant select on public.site_entry_bodies to authenticated;
grant select on public.site_release_sources to authenticated;
grant select on public.site_release_events to authenticated;
grant select, insert, update on public.site_resources to authenticated;

create policy site_settings_staff_select on public.site_settings
  for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.view')));

create policy site_settings_staff_insert on public.site_settings
  for insert to authenticated
  with check (
    (select private.has_organization_permission(organization_id, 'content.publish'))
    and created_by = (select auth.uid())
  );

create policy site_settings_staff_update on public.site_settings
  for update to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.publish')))
  with check ((select private.has_organization_permission(organization_id, 'content.publish')));

create policy site_categories_staff on public.site_categories
  for all to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.publish')))
  with check ((select private.has_organization_permission(organization_id, 'content.publish')));

create policy site_topics_staff on public.site_topics
  for all to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.publish')))
  with check ((select private.has_organization_permission(organization_id, 'content.publish')));

create policy site_topic_items_staff on public.site_topic_items
  for all to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.publish')))
  with check ((select private.has_organization_permission(organization_id, 'content.publish')));

create policy site_entries_staff_select on public.site_entries
  for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.view')));

create policy site_entries_staff_write on public.site_entries
  for insert to authenticated
  with check (
    (select private.has_organization_permission(organization_id, 'content.publish'))
    and status = 'draft'
    and published_at is null
    and current_version is null
  );

create policy site_entries_staff_update on public.site_entries
  for update to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.publish')))
  with check ((select private.has_organization_permission(organization_id, 'content.publish')));

create policy site_bodies_staff_select on public.site_entry_bodies
  for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.view')));

create policy site_release_sources_staff on public.site_release_sources
  for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.view')));

create policy site_release_events_staff on public.site_release_events
  for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.view')));

create policy site_resources_staff on public.site_resources
  for all to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.publish')))
  with check ((select private.has_organization_permission(organization_id, 'content.publish')));

-- ---------------------------------------------------------------------------
-- publish / unpublish RPCs (security definer; fixed search_path; permission checks)
-- ---------------------------------------------------------------------------
create or replace function public.publish_site_entry(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_site_id text;
  v_org uuid;
  v_entry_id uuid;
  v_slug text;
  v_summary text;
  v_category_id uuid;
  v_form text;
  v_column text;
  v_cover text;
  v_access text;
  v_featured boolean;
  v_document_id uuid;
  v_revision integer;
  v_doc public.content_documents;
  v_rev public.content_revisions;
  v_cat public.site_categories;
  v_version integer;
  v_event text;
  v_entry public.site_entries;
begin
  perform set_config('app.site_release_rpc', '1', true);

  if v_uid is null then
    raise exception '需要登录' using errcode = '42501';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'site_id'), '');
  v_entry_id := nullif(p_input ->> 'entry_id', '')::uuid;
  v_slug := nullif(btrim(p_input ->> 'slug'), '');
  v_summary := nullif(btrim(p_input ->> 'summary'), '');
  v_category_id := nullif(p_input ->> 'category_id', '')::uuid;
  v_form := nullif(p_input ->> 'form', '');
  v_column := nullif(p_input ->> 'content_column', '');
  v_cover := coalesce(nullif(btrim(p_input ->> 'cover_url'), ''), '');
  v_access := coalesce(nullif(p_input ->> 'access_level', ''), 'public');
  v_featured := coalesce((p_input ->> 'featured')::boolean, false);
  v_document_id := nullif(p_input ->> 'document_id', '')::uuid;
  v_revision := nullif(p_input ->> 'revision', '')::integer;

  if v_site_id is null or v_document_id is null or v_revision is null
     or v_summary is null or v_category_id is null
     or v_form is null or v_column is null then
    raise exception '发布参数不完整' using errcode = '22023';
  end if;

  if v_access not in ('public', 'registered') then
    raise exception '首版仅支持 public / registered；member 未开放' using errcode = '22023';
  end if;

  select * into v_cat from public.site_categories where id = v_category_id and site_id = v_site_id;
  if not found or not v_cat.enabled then
    raise exception '分类不存在或未启用' using errcode = '22023';
  end if;
  v_org := v_cat.organization_id;

  if not private.has_organization_permission(v_org, 'content.publish') then
    raise exception '没有站点发布权限' using errcode = '42501';
  end if;

  select * into v_doc from public.content_documents
  where id = v_document_id and organization_id = v_org;
  if not found then
    raise exception '稿件不存在或不属于本组织' using errcode = '42501';
  end if;
  if v_doc.status <> 'approved' or v_doc.revision <> v_revision then
    raise exception '仅可发布当前已批准版本' using errcode = 'P0001';
  end if;

  select * into v_rev from public.content_revisions
  where organization_id = v_org and document_id = v_document_id and revision = v_revision;
  if not found or btrim(v_rev.body) = '' then
    raise exception '批准版本正文不可用' using errcode = 'P0001';
  end if;

  if v_entry_id is not null then
    select * into v_entry from public.site_entries
    where id = v_entry_id and site_id = v_site_id and organization_id = v_org for update;
    if not found then
      raise exception '站点条目不存在' using errcode = 'P0001';
    end if;
    v_version := coalesce(v_entry.current_version, 0) + 1;
    v_event := case when v_entry.status = 'published' then 'replace' else 'publish' end;
    v_slug := coalesce(v_slug, v_entry.slug);
  else
    if v_slug is null then
      raise exception '新条目需要 slug' using errcode = '22023';
    end if;
    v_version := 1;
    v_event := 'publish';
    insert into public.site_entries (
      site_id, organization_id, slug, title, summary, category_id, form, content_column,
      cover_url, access_level, status, featured, created_by
    ) values (
      v_site_id, v_org, v_slug, v_rev.title, v_summary, v_category_id, v_form, v_column,
      v_cover, v_access, 'draft', v_featured, v_uid
    ) returning * into v_entry;
    v_entry_id := v_entry.id;
  end if;

  insert into public.site_entry_bodies (
    entry_id, version, site_id, organization_id, access_level, markdown, sources, created_by
  ) values (
    v_entry_id, v_version, v_site_id, v_org, v_access, v_rev.body,
    coalesce(p_input -> 'sources', '[]'::jsonb), v_uid
  );

  insert into public.site_release_sources (entry_id, version, organization_id, document_id, revision)
  values (v_entry_id, v_version, v_org, v_document_id, v_revision);

  update public.site_entries set
    title = v_rev.title,
    summary = v_summary,
    category_id = v_category_id,
    form = v_form,
    content_column = v_column,
    cover_url = v_cover,
    access_level = v_access,
    featured = v_featured,
    slug = v_slug,
    status = 'published',
    published_at = coalesce(published_at, now()),
    unpublished_at = null,
    current_version = v_version,
    updated_at = now()
  where id = v_entry_id
  returning * into v_entry;

  insert into public.site_release_events (
    site_id, organization_id, entry_id, event_type, version, actor_id, detail
  ) values (
    v_site_id, v_org, v_entry_id, v_event, v_version, v_uid,
    jsonb_build_object('document_id', v_document_id, 'revision', v_revision, 'access_level', v_access)
  );

  return jsonb_build_object(
    'entry_id', v_entry.id,
    'slug', v_entry.slug,
    'version', v_version,
    'status', v_entry.status,
    'published_at', v_entry.published_at
  );
end;
$$;

revoke all on function public.publish_site_entry(jsonb) from public, anon;
grant execute on function public.publish_site_entry(jsonb) to authenticated;

create or replace function public.unpublish_site_entry(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_entry public.site_entries;
begin
  perform set_config('app.site_release_rpc', '1', true);

  if v_uid is null then
    raise exception '需要登录' using errcode = '42501';
  end if;

  select * into v_entry from public.site_entries where id = p_entry_id for update;
  if not found then
    raise exception '站点条目不存在' using errcode = 'P0001';
  end if;
  if not private.has_organization_permission(v_entry.organization_id, 'content.publish') then
    raise exception '没有站点发布权限' using errcode = '42501';
  end if;
  if v_entry.status <> 'published' then
    raise exception '条目未处于已发布状态' using errcode = 'P0001';
  end if;

  update public.site_entries set
    status = 'unpublished',
    unpublished_at = now(),
    featured = false,
    updated_at = now()
  where id = p_entry_id
  returning * into v_entry;

  insert into public.site_release_events (
    site_id, organization_id, entry_id, event_type, version, actor_id, detail
  ) values (
    v_entry.site_id, v_entry.organization_id, v_entry.id, 'unpublish',
    v_entry.current_version, v_uid, '{}'::jsonb
  );

  return jsonb_build_object(
    'entry_id', v_entry.id,
    'slug', v_entry.slug,
    'status', v_entry.status,
    'unpublished_at', v_entry.unpublished_at
  );
end;
$$;

revoke all on function public.unpublish_site_entry(uuid) from public, anon;
grant execute on function public.unpublish_site_entry(uuid) to authenticated;

-- Prevent client UPDATEs from flipping publish pointers; RPCs set app.site_release_rpc.
create or replace function private.site_entries_guard_release_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.site_release_rpc', true) = '1' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status
       or new.published_at is distinct from old.published_at
       or new.unpublished_at is distinct from old.unpublished_at
       or new.current_version is distinct from old.current_version then
      raise exception '上下线请走 publish_site_entry / unpublish_site_entry'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists site_entries_guard_release_fields on public.site_entries;
create trigger site_entries_guard_release_fields
  before update on public.site_entries
  for each row
  execute function private.site_entries_guard_release_fields();


-- Ensure site_settings row helper for console bootstrap
create or replace function public.ensure_site_settings(
  p_organization_id uuid,
  p_site_id text default 'primary',
  p_name text default 'Signal to Story'
)
returns public.site_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.site_settings;
begin
  if v_uid is null then
    raise exception '需要登录' using errcode = '42501';
  end if;
  if not private.has_organization_permission(p_organization_id, 'content.publish') then
    raise exception '没有站点发布权限' using errcode = '42501';
  end if;
  select * into v_row from public.site_settings where site_id = p_site_id;
  if found then
    if v_row.organization_id <> p_organization_id then
      raise exception '站点已归属其他组织' using errcode = '42501';
    end if;
    return v_row;
  end if;
  insert into public.site_settings (site_id, organization_id, name, description, created_by)
  values (p_site_id, p_organization_id, p_name, '科技行业信息聚合与分享站', v_uid)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.ensure_site_settings(uuid, text, text) from public, anon;
grant execute on function public.ensure_site_settings(uuid, text, text) to authenticated;
