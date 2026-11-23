-- DB4 (0.5): publishing lives on content_documents (docs/database.md §4.3, R7).
--   * publish_document copies the approved revision into the published_* columns. Later edits bump `revision`
--     but never touch published_*, so the reader site keeps showing what was approved.
--   * Mandate: a human-approved publish_site request bound to (document, revision) is required (MD001 / MD002).
--   * published_* columns can only be written by publish_document / unpublish_document / set_document_published_url.
--   * anon reads only the published columns of published rows (column grants + RLS). sense-site reads nothing else.
-- Retires: the local site_* tables (12) and their functions, and the external publishing tables
-- (publishing_channels, content_publications, publication_metrics) — all empty live; manual publishing just
-- records the external link in published_url.

-- ── 1. Drop the reader-site and external-publishing objects ──
drop trigger if exists document_invalidate_publications on public.content_documents;
drop function if exists private.invalidate_stale_publications();
drop function if exists public.publish_site_entry(uuid, uuid, integer, jsonb);
drop function if exists public.unpublish_site_entry(uuid, text);
drop table if exists
  public.site_bookmarks, public.site_topic_items, public.site_topics, public.site_resource_files, public.site_resources,
  public.site_release_events, public.site_entry_bodies, public.site_entry_releases, public.site_entries,
  public.site_categories, public.site_readers, public.site_settings
  cascade;
drop function if exists private.guard_site_row();
drop function if exists private.forbid_site_snapshot_mutation();
drop function if exists private.is_verified_reader();
drop function if exists private.site_validate_url(text, boolean);
drop table if exists public.publication_metrics, public.content_publications, public.publishing_channels cascade;

-- Approval targets: content_publication is gone; only documents (and video plans, 20261120100100) carry revisions.
create or replace function private.current_target_revision(p_target_type text, p_target_id text) returns integer
language plpgsql stable security definer set search_path='' as $$
declare r integer;
begin
 if p_target_type = 'content_document' then
  select d.revision into r from public.content_documents d where d.id::text = p_target_id;
  return r;
 elsif p_target_type = 'video_plan' then
  select v.revision into r from public.video_plans v where v.id::text = p_target_id;
  return r;
 end if;
 return null;
end; $$;

create or replace function private.expire_stale_document_approvals() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.revision <> old.revision then
  update public.approval_requests set status = 'expired'
  where organization_id = new.organization_id and kind = 'approval' and status in ('pending','approved')
   and target_type = 'content_document' and target_id = new.id::text
   and coalesce(target_revision, 0) < new.revision;
 end if;
 return new;
end; $$;

-- ── 2. Published columns ──
alter table public.content_documents
  add column published_revision integer check (published_revision is null or published_revision >= 1),
  add column published_title text check (published_title is null or char_length(published_title) <= 200),
  add column published_body text check (published_body is null or char_length(published_body) <= 100000),
  add column published_meta jsonb not null default '{}'::jsonb
    check (jsonb_typeof(published_meta) = 'object' and pg_column_size(published_meta) <= 65536),
  add column published_at timestamptz,
  add column published_url text not null default ''
    check (published_url = '' or (published_url ~ '^https?://[^[:space:]<>"]+$' and char_length(published_url) <= 2000)),
  add column slug text check (slug is null or (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 96)),
  add constraint content_documents_published_shape check (
    published_at is null or (published_revision is not null and published_title is not null and published_body is not null and slug is not null));
create unique index content_documents_org_slug_key on public.content_documents (organization_id, slug) where slug is not null;
create index content_documents_published_idx on public.content_documents (published_at desc) where published_at is not null;
comment on column public.content_documents.published_at is '读者站上线时间；为空表示未发布或已下线。published_* 只能由发布 RPC 写入。';
comment on column public.content_documents.published_url is '人工发布到外部平台后回填的链接（不做数据复盘）。';

-- Only the publishing RPCs (which set app.publishing for their own statement) may write published_*.
create function private.guard_document_publish_columns() returns trigger language plpgsql set search_path='' as $$
begin
 if coalesce(current_setting('app.publishing', true), '') = 'on' then return new; end if;
 if tg_op = 'INSERT' then
  if new.published_revision is not null or new.published_title is not null or new.published_body is not null
     or new.published_meta <> '{}'::jsonb or new.published_at is not null or new.published_url <> '' or new.slug is not null then
   raise exception '发布信息只能通过发布操作写入' using errcode = '42501';
  end if;
 elsif new.published_revision is distinct from old.published_revision or new.published_title is distinct from old.published_title
    or new.published_body is distinct from old.published_body or new.published_meta is distinct from old.published_meta
    or new.published_at is distinct from old.published_at or new.published_url is distinct from old.published_url
    or new.slug is distinct from old.slug then
  raise exception '发布信息只能通过发布操作写入' using errcode = '42501';
 end if;
 return new;
end; $$;
revoke all on function private.guard_document_publish_columns() from public, anon, authenticated;
create trigger document_publish_columns_guard before insert or update on public.content_documents
  for each row execute function private.guard_document_publish_columns();

-- Reader site: anon sees only the published columns of published rows.
revoke all on public.content_documents from anon;
grant select (id, organization_id, platform, slug, published_revision, published_title, published_body, published_meta, published_at, published_url)
  on public.content_documents to anon;
create policy content_documents_public_read on public.content_documents for select to anon using (published_at is not null);

-- ── 3. Publishing RPCs ──
create function private.https_url_ok(value text, allow_empty boolean default true) returns boolean
language sql immutable set search_path='' as $$
  select case when value is null or value = '' then allow_empty
    else value ~ '^https://[^[:space:]<>"]+$' and char_length(value) <= 2000 end;
$$;
revoke all on function private.https_url_ok(text, boolean) from public, anon, authenticated;

create function public.publish_document(p_document_id uuid, p_revision integer, p_meta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid := (select auth.uid());
  d public.content_documents;
  v_item jsonb;
  v_slug text := lower(btrim(coalesce(p_meta ->> 'slug', '')));
  v_summary text := btrim(coalesce(p_meta ->> 'summary', ''));
  v_format text := coalesce(nullif(p_meta ->> 'format', ''), 'article');
  v_cover text := btrim(coalesce(p_meta ->> 'cover_url', ''));
  v_cover_alt text := btrim(coalesce(p_meta ->> 'cover_alt', ''));
  v_media jsonb := coalesce(p_meta -> 'media', '[]'::jsonb);
  v_refs jsonb := coalesce(p_meta -> 'source_refs', '[]'::jsonb);
  v_meta jsonb;
  v_action text;
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception '需要登录后台账号' using errcode = '42501';
  end if;
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    raise exception '发布参数格式无效' using errcode = '22023';
  end if;
  select * into d from public.content_documents where id = p_document_id for update;
  if not found then raise exception '稿件不存在' using errcode = 'P0002'; end if;
  if not private.has_organization_permission(d.organization_id, 'content.publish') then
    raise exception '需要该组织的发布权限' using errcode = '42501';
  end if;
  if d.status <> 'approved' or d.revision <> p_revision then
    raise exception '仅可发布当前已人工审核通过的版本' using errcode = 'P0001';
  end if;
  if btrim(d.body) = '' then raise exception '已审核版本没有可发布的正文' using errcode = 'P0001'; end if;

  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or char_length(v_slug) > 96 then
    raise exception '链接标识仅允许小写字母、数字和连字符（最多 96 字）' using errcode = '22023';
  end if;
  if char_length(v_summary) not between 1 and 500 then
    raise exception '请填写 1–500 字的人工摘要' using errcode = '22023';
  end if;
  if v_format not in ('article', 'tutorial', 'video', 'comic', 'resource') then
    raise exception '无效的内容形式' using errcode = '22023';
  end if;
  if not private.https_url_ok(v_cover) or char_length(v_cover_alt) > 200 or (v_cover <> '' and v_cover_alt = '') then
    raise exception '封面需为 https 地址并填写替代文本' using errcode = '22023';
  end if;
  if jsonb_typeof(v_media) <> 'array' or jsonb_array_length(v_media) > 20 then
    raise exception '媒体引用格式无效' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(v_media) loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(v_item ->> 'kind', '') not in ('image', 'video')
      or not private.https_url_ok(v_item ->> 'url', false) or not private.https_url_ok(coalesce(v_item ->> 'poster', ''))
      or char_length(coalesce(v_item ->> 'alt', '')) > 200
      or (v_item ->> 'kind' = 'image' and btrim(coalesce(v_item ->> 'alt', '')) = '') then
      raise exception '媒体需为 https 地址，图片需填写替代文本' using errcode = '22023';
    end if;
  end loop;
  if v_format = 'video' and not exists (select 1 from jsonb_array_elements(v_media) m where m.value ->> 'kind' = 'video') then
    raise exception '视频内容需要提供视频地址' using errcode = '22023';
  end if;
  if jsonb_typeof(v_refs) <> 'array' or jsonb_array_length(v_refs) > 50 then
    raise exception '来源引用格式无效' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(v_refs) loop
    if jsonb_typeof(v_item) <> 'object' or char_length(btrim(coalesce(v_item ->> 'title', ''))) not between 1 and 200
      or not private.https_url_ok(v_item ->> 'url', false) then
      raise exception '来源引用需包含标题和 https 地址' using errcode = '22023';
    end if;
  end loop;
  if exists (select 1 from public.content_documents o where o.organization_id = d.organization_id and o.slug = v_slug and o.id <> d.id) then
    raise exception '链接标识已被其他稿件使用' using errcode = '23505';
  end if;
  v_meta := jsonb_build_object('summary', v_summary, 'format', v_format, 'cover_url', v_cover, 'cover_alt', v_cover_alt,
    'media', v_media, 'source_refs', v_refs);

  -- Idempotent retry: already live with the same revision and metadata needs no fresh approval.
  if d.published_at is not null and d.published_revision = p_revision and d.slug = v_slug and d.published_meta = v_meta then
    return jsonb_build_object('document_id', d.id, 'revision', p_revision, 'slug', v_slug, 'action', 'unchanged', 'unchanged', true);
  end if;

  -- Database-level Mandate: a human-approved publish_site request bound to this document and revision.
  if not exists (
    select 1 from public.approval_requests a
    where a.organization_id = d.organization_id and a.kind = 'approval' and a.action = 'publish_site'
      and a.target_type = 'content_document' and a.target_id = d.id::text and a.target_revision = p_revision
      and a.status = 'approved' and a.expires_at > now()
  ) then
    if exists (
      select 1 from public.approval_requests a
      where a.organization_id = d.organization_id and a.kind = 'approval' and a.action = 'publish_site'
        and a.target_type = 'content_document' and a.target_id = d.id::text and a.target_revision = p_revision
        and (a.status = 'expired' or (a.status = 'approved' and a.expires_at <= now()))
    ) then
      raise exception '发布批准已过期，请重新请求批准' using errcode = 'MD002';
    end if;
    raise exception '缺少该版本的有效发布批准，请先请求并获得批准' using errcode = 'MD001';
  end if;

  v_action := case when d.published_at is not null then 'replace' when d.published_revision is not null then 'republish' else 'publish' end;
  perform set_config('app.publishing', 'on', true);
  update public.content_documents set
    published_revision = p_revision, published_title = d.title, published_body = d.body, published_meta = v_meta,
    published_at = now(), slug = v_slug
  where id = d.id;
  perform set_config('app.publishing', 'off', true);

  insert into public.audit_events (organization_id, actor_user_id, action, target_type, target_id, metadata)
  values (d.organization_id, v_uid, 'content.published', 'content_document', d.id::text,
    jsonb_build_object('revision', p_revision, 'slug', v_slug, 'action', v_action));
  return jsonb_build_object('document_id', d.id, 'revision', p_revision, 'slug', v_slug, 'action', v_action, 'unchanged', false);
end; $$;
revoke all on function public.publish_document(uuid, integer, jsonb) from public, anon, service_role;
grant execute on function public.publish_document(uuid, integer, jsonb) to authenticated;

-- Take a document off the reader site. The published snapshot and audit history stay; anon can no longer read it.
create function public.unpublish_document(p_document_id uuid, p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid := (select auth.uid()); d public.content_documents;
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception '需要登录后台账号' using errcode = '42501';
  end if;
  if char_length(coalesce(p_note, '')) > 1000 then raise exception '下线说明不超过 1000 字' using errcode = '22023'; end if;
  select * into d from public.content_documents where id = p_document_id for update;
  if not found then raise exception '稿件不存在' using errcode = 'P0002'; end if;
  if not private.has_organization_permission(d.organization_id, 'content.publish') then
    raise exception '需要该组织的发布权限' using errcode = '42501';
  end if;
  if d.published_at is null then
    return jsonb_build_object('document_id', d.id, 'unchanged', true);
  end if;
  perform set_config('app.publishing', 'on', true);
  update public.content_documents set published_at = null where id = d.id;
  perform set_config('app.publishing', 'off', true);
  insert into public.audit_events (organization_id, actor_user_id, action, target_type, target_id, metadata)
  values (d.organization_id, v_uid, 'content.unpublished', 'content_document', d.id::text,
    jsonb_build_object('revision', d.published_revision, 'note', coalesce(p_note, '')));
  return jsonb_build_object('document_id', d.id, 'unchanged', false);
end; $$;
revoke all on function public.unpublish_document(uuid, text) from public, anon, service_role;
grant execute on function public.unpublish_document(uuid, text) to authenticated;

-- Manual publishing elsewhere: record the external link (empty string clears it).
create function public.set_document_published_url(p_document_id uuid, p_url text)
returns void language plpgsql security definer set search_path='' as $$
declare v_uid uuid := (select auth.uid()); d public.content_documents; v_url text := btrim(coalesce(p_url, ''));
begin
  if v_uid is null then raise exception '需要登录后台账号' using errcode = '42501'; end if;
  select * into d from public.content_documents where id = p_document_id for update;
  if not found then raise exception '稿件不存在' using errcode = 'P0002'; end if;
  if not private.has_organization_permission(d.organization_id, 'content.publish') then
    raise exception '需要该组织的发布权限' using errcode = '42501';
  end if;
  if v_url <> '' and (v_url !~ '^https?://[^[:space:]<>"]+$' or char_length(v_url) > 2000) then
    raise exception '请填写 http(s) 链接' using errcode = '22023';
  end if;
  if v_url <> '' and d.status <> 'approved' then
    raise exception '仅可为已审核通过的稿件登记发布链接' using errcode = 'P0001';
  end if;
  perform set_config('app.publishing', 'on', true);
  update public.content_documents set published_url = v_url where id = d.id;
  perform set_config('app.publishing', 'off', true);
  insert into public.audit_events (organization_id, actor_user_id, action, target_type, target_id, metadata)
  values (d.organization_id, v_uid, 'content.published_url', 'content_document', d.id::text,
    jsonb_build_object('revision', d.revision, 'url', v_url));
end; $$;
revoke all on function public.set_document_published_url(uuid, text) from public, anon, service_role;
grant execute on function public.set_document_published_url(uuid, text) to authenticated;
