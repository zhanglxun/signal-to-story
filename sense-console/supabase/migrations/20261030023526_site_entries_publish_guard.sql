-- Gate publish/unpublish pointer fields: only security-definer release RPCs may flip them.
-- Staff may still update metadata (title/summary/featured/etc.) on any status via RLS.

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

-- Mark release RPCs so the guard allows their intentional pointer updates.
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

comment on function private.site_entries_guard_release_fields() is
  'Blocks direct client updates to status/published_at/unpublished_at/current_version; release RPCs set app.site_release_rpc=1.';
