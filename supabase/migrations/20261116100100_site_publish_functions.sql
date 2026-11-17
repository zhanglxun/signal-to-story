-- Site publish / unpublish transactions (docs-site/spec/sense-site-SPEC.md, "数据发布边界").
--
-- Security review notes (SECURITY DEFINER is required because clients have no
-- write grant on site_entries / releases / bodies / events):
--   * search_path is pinned to '' and every object is schema-qualified.
--   * EXECUTE is revoked from PUBLIC and anon; only authenticated may call.
--   * Caller must be signed in, non-anonymous, and hold content.publish in the
--     site's organization (private.has_organization_permission).
--   * The source document row is locked and re-checked inside the transaction:
--     same organization, status = 'approved', current revision = requested
--     revision, and an 'approved' content_review_events row for that revision.
--     Title and body are copied from the immutable content_revisions row, never
--     from client input.
--   * Only display metadata (slug, summary, category, format, column, cover,
--     access level, media/source references) comes from the caller and is
--     validated against a whitelist; member / purchase access is rejected.
--   * Releases, bodies and events are append-only (immutability triggers).

create function private.site_validate_url(value text, allow_empty boolean default true) returns boolean
language sql immutable set search_path = '' as $$
  select case when value is null or value = '' then allow_empty
    else value ~ '^https://[^[:space:]<>"]+$' and char_length(value) <= 2000 end;
$$;
revoke all on function private.site_validate_url(text, boolean) from public, anon, authenticated;

create function public.publish_site_entry(
  p_site_id uuid,
  p_document_id uuid,
  p_revision integer,
  p_meta jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_site public.site_settings%rowtype;
  v_doc public.content_documents%rowtype;
  v_rev public.content_revisions%rowtype;
  v_entry public.site_entries%rowtype;
  v_current public.site_entry_releases%rowtype;
  v_release_id uuid;
  v_version integer;
  v_action text;
  v_meta jsonb;
  v_item jsonb;
  v_slug text := lower(btrim(coalesce(p_meta ->> 'slug', '')));
  v_summary text := btrim(coalesce(p_meta ->> 'summary', ''));
  v_format text := coalesce(nullif(p_meta ->> 'format', ''), 'article');
  v_column text := nullif(btrim(coalesce(p_meta ->> 'column_key', '')), '');
  v_access text := coalesce(nullif(p_meta ->> 'access_level', ''), 'public');
  v_category uuid;
  v_cover text := btrim(coalesce(p_meta ->> 'cover_url', ''));
  v_cover_alt text := btrim(coalesce(p_meta ->> 'cover_alt', ''));
  v_media jsonb := coalesce(p_meta -> 'media', '[]'::jsonb);
  v_refs jsonb := coalesce(p_meta -> 'source_refs', '[]'::jsonb);
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception '需要登录后台账号' using errcode = '42501';
  end if;
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    raise exception '发布参数格式无效' using errcode = '22023';
  end if;

  select * into v_site from public.site_settings where id = p_site_id;
  if not found then raise exception '站点不存在' using errcode = 'P0002'; end if;
  if not private.has_organization_permission(v_site.organization_id, 'content.publish') then
    raise exception '需要该组织的站点发布权限' using errcode = '42501';
  end if;

  -- Lock the source document so review status cannot change mid-transaction.
  select * into v_doc from public.content_documents
  where id = p_document_id and organization_id = v_site.organization_id
  for update;
  if not found then raise exception '稿件不存在或不属于该站点所属组织' using errcode = '42501'; end if;
  if v_doc.status <> 'approved' or v_doc.revision <> p_revision then
    raise exception '仅可发布当前已人工审核通过的版本' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.content_review_events ev
    where ev.organization_id = v_doc.organization_id and ev.document_id = v_doc.id
      and ev.revision = p_revision and ev.status = 'approved'
  ) then
    raise exception '缺少该版本的人工审核通过记录' using errcode = 'P0001';
  end if;
  -- MANDATE HOOK (P1.5, public.approval_requests from 20261115100200_approval_requests_mandate.sql):
  -- when site publishing must also carry a database-level Mandate, add here:
  --   if not exists (select 1 from public.approval_requests a
  --     where a.organization_id = v_doc.organization_id and a.action = 'publish_site'
  --       and a.target_id = v_doc.id::text and a.target_revision = p_revision
  --       and a.status = 'approved' and a.expires_at > now()) then raise ... using errcode = '42501';
  -- (bind target_type / payload->>'site_id' per the final P1.5 convention). Until then the gate is the
  -- human review record above, which every publish already requires.

  select * into v_rev from public.content_revisions
  where organization_id = v_doc.organization_id and document_id = v_doc.id and revision = p_revision;
  if not found or btrim(v_rev.body) = '' then
    raise exception '已审核版本没有可发布的正文' using errcode = 'P0001';
  end if;

  -- Display metadata whitelist.
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or char_length(v_slug) > 96 then
    raise exception '站点链接标识仅允许小写字母、数字和连字符（最多 96 字）' using errcode = '22023';
  end if;
  if char_length(v_summary) not between 1 and 500 then
    raise exception '请填写 1–500 字的人工摘要' using errcode = '22023';
  end if;
  if v_access not in ('public', 'registered') then
    raise exception '首版仅支持 public / registered 访问级别' using errcode = '22023';
  end if;
  if v_format not in ('article', 'tutorial', 'video', 'comic', 'resource') then
    raise exception '无效的内容形式' using errcode = '22023';
  end if;
  if v_column is not null and v_column not in ('news', 'analysis', 'how_to', 'case') then
    raise exception '无效的栏目' using errcode = '22023';
  end if;
  if not private.site_validate_url(v_cover) or char_length(v_cover_alt) > 200 or (v_cover <> '' and v_cover_alt = '') then
    raise exception '封面需为 https 地址并填写替代文本' using errcode = '22023';
  end if;
  if nullif(p_meta ->> 'category_id', '') is not null then
    begin
      v_category := (p_meta ->> 'category_id')::uuid;
    exception when invalid_text_representation then
      raise exception '无效的分类' using errcode = '22023';
    end;
    if not exists (select 1 from public.site_categories c where c.id = v_category and c.site_id = p_site_id and c.enabled) then
      raise exception '分类不存在或未启用' using errcode = '22023';
    end if;
  end if;
  if jsonb_typeof(v_media) <> 'array' or jsonb_array_length(v_media) > 20 then
    raise exception '媒体引用格式无效' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(v_media) loop
    if jsonb_typeof(v_item) <> 'object'
      or coalesce(v_item ->> 'kind', '') not in ('image', 'video')
      or not private.site_validate_url(v_item ->> 'url', false)
      or not private.site_validate_url(coalesce(v_item ->> 'poster', ''))
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
    if jsonb_typeof(v_item) <> 'object'
      or char_length(btrim(coalesce(v_item ->> 'title', ''))) not between 1 and 200
      or not private.site_validate_url(v_item ->> 'url', false) then
      raise exception '来源引用需包含标题和 https 地址' using errcode = '22023';
    end if;
  end loop;

  v_meta := jsonb_build_object(
    'slug', v_slug, 'summary', v_summary, 'category_id', v_category, 'format', v_format,
    'column_key', v_column, 'cover_url', v_cover, 'cover_alt', v_cover_alt,
    'access_level', v_access, 'media', v_media, 'source_refs', v_refs);

  select * into v_entry from public.site_entries
  where site_id = p_site_id and source_document_id = v_doc.id
  for update;

  if exists (select 1 from public.site_entries e where e.site_id = p_site_id and e.slug = v_slug and e.id is distinct from v_entry.id) then
    raise exception '站点链接标识已被其他内容使用' using errcode = '23505';
  end if;

  -- Idempotent retry: same approved revision and same display metadata.
  if v_entry.id is not null and v_entry.status = 'online' then
    select * into v_current from public.site_entry_releases where id = v_entry.current_release_id;
    if v_current.source_revision = p_revision and v_current.display_meta = v_meta then
      return jsonb_build_object('entry_id', v_entry.id, 'release_id', v_current.id, 'version', v_current.version,
        'slug', v_entry.slug, 'action', 'unchanged', 'unchanged', true);
    end if;
  end if;

  if v_entry.id is null then
    insert into public.site_entries (organization_id, site_id, source_document_id, slug, title, summary, category_id,
      format, column_key, cover_url, cover_alt, access_level, status, current_version, published_at, updated_at)
    values (v_site.organization_id, p_site_id, v_doc.id, v_slug, v_rev.title, v_summary, v_category,
      v_format, v_column, v_cover, v_cover_alt, v_access, 'offline', 0, now(), now())
    returning * into v_entry;
    v_action := 'publish';
  elsif v_entry.status = 'offline' then
    v_action := 'republish';
  else
    v_action := 'replace';
  end if;
  v_version := v_entry.current_version + 1;

  insert into public.site_entry_releases (organization_id, site_id, entry_id, version, source_document_id,
    source_revision, source_platform, title, display_meta, published_by)
  values (v_site.organization_id, p_site_id, v_entry.id, v_version, v_doc.id, p_revision, v_doc.platform,
    v_rev.title, v_meta, v_uid)
  returning id into v_release_id;

  insert into public.site_entry_bodies (release_id, organization_id, site_id, entry_id, markdown, media, source_refs)
  values (v_release_id, v_site.organization_id, p_site_id, v_entry.id, v_rev.body, v_media, v_refs);

  update public.site_entries set
    slug = v_slug, title = v_rev.title, summary = v_summary, category_id = v_category, format = v_format,
    column_key = v_column, cover_url = v_cover, cover_alt = v_cover_alt, access_level = v_access,
    status = 'online', current_release_id = v_release_id, current_version = v_version,
    updated_at = now(), offline_at = null
  where id = v_entry.id;

  insert into public.site_release_events (organization_id, site_id, entry_id, release_id, action, actor_id)
  values (v_site.organization_id, p_site_id, v_entry.id, v_release_id, v_action, v_uid);

  insert into public.audit_events (organization_id, actor_user_id, action, target_type, target_id, metadata)
  values (v_site.organization_id, v_uid, 'site.entry.' || v_action, 'site_entry', v_entry.id::text,
    jsonb_build_object('release_id', v_release_id, 'document_id', v_doc.id, 'revision', p_revision, 'version', v_version));

  return jsonb_build_object('entry_id', v_entry.id, 'release_id', v_release_id, 'version', v_version,
    'slug', v_slug, 'action', v_action, 'unchanged', false);
end; $$;

create function public.unpublish_site_entry(p_entry_id uuid, p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_entry public.site_entries%rowtype;
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception '需要登录后台账号' using errcode = '42501';
  end if;
  select * into v_entry from public.site_entries where id = p_entry_id for update;
  if not found then raise exception '站点内容不存在' using errcode = 'P0002'; end if;
  if not private.has_organization_permission(v_entry.organization_id, 'content.publish') then
    raise exception '需要该组织的站点发布权限' using errcode = '42501';
  end if;
  if char_length(coalesce(p_note, '')) > 1000 then
    raise exception '下线说明不超过 1000 字' using errcode = '22023';
  end if;
  if v_entry.status = 'offline' then
    return jsonb_build_object('entry_id', v_entry.id, 'status', 'offline', 'unchanged', true);
  end if;
  -- Offline is a state change; releases, bodies and bookmarks stay for audit.
  update public.site_entries set status = 'offline', offline_at = now(), updated_at = now() where id = v_entry.id;
  insert into public.site_release_events (organization_id, site_id, entry_id, release_id, action, note, actor_id)
  values (v_entry.organization_id, v_entry.site_id, v_entry.id, v_entry.current_release_id, 'unpublish', coalesce(p_note, ''), v_uid);
  insert into public.audit_events (organization_id, actor_user_id, action, target_type, target_id, metadata)
  values (v_entry.organization_id, v_uid, 'site.entry.unpublish', 'site_entry', v_entry.id::text,
    jsonb_build_object('release_id', v_entry.current_release_id));
  return jsonb_build_object('entry_id', v_entry.id, 'status', 'offline', 'unchanged', false);
end; $$;

revoke all on function public.publish_site_entry(uuid, uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.unpublish_site_entry(uuid, text) from public, anon, authenticated;
grant execute on function public.publish_site_entry(uuid, uuid, integer, jsonb) to authenticated;
grant execute on function public.unpublish_site_entry(uuid, text) to authenticated;
