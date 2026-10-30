-- Runnable intake path: upsert harvested items into signals with category classification.
-- Does NOT create site_entries. Called by authenticated content.manage or Edge Function service_role.

create or replace function public.ingest_harvested_signals(p_organization_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item jsonb;
  v_title text;
  v_url text;
  v_summary text;
  v_description text;
  v_category_name text;
  v_category_id bigint;
  v_signal_id bigint;
  v_created int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_existing bigint;
  v_is_service boolean := (select auth.role()) = 'service_role';
begin
  if not v_is_service then
    if v_uid is null then
      raise exception '需要登录' using errcode = '42501';
    end if;
    if not private.has_organization_permission(p_organization_id, 'content.manage') then
      raise exception '没有内容管理权限' using errcode = '42501';
    end if;
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items 必须为非空数组' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception '单次最多 50 条' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_title := nullif(btrim(v_item ->> 'title'), '');
    v_url := nullif(btrim(v_item ->> 'url'), '');
    v_summary := nullif(btrim(v_item ->> 'summary'), '');
    v_description := nullif(btrim(v_item ->> 'description'), '');
    v_category_name := coalesce(nullif(btrim(v_item ->> 'category_name'), ''), '自动采集');

    if v_title is null or char_length(v_title) > 120 then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if v_url is not null and (char_length(v_url) > 512 or v_url !~ '^https?://[^[:space:]]+$') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Resolve or create category under org (top-level).
    select id into v_category_id
    from public.source_categories
    where organization_id = p_organization_id
      and name = v_category_name
      and parent_id is null
    order by id
    limit 1;

    if v_category_id is null then
      insert into public.source_categories (
        organization_id, name, description, created_by, updated_by
      ) values (
        p_organization_id,
        left(v_category_name, 36),
        '采集自动分类，可在分类管理中调整',
        coalesce(v_uid, (select user_id from public.organization_members where organization_id = p_organization_id order by created_at limit 1)),
        coalesce(v_uid, (select user_id from public.organization_members where organization_id = p_organization_id order by created_at limit 1))
      ) returning id into v_category_id;
    end if;

    v_existing := null;
    if v_url is not null then
      select id into v_existing
      from public.signals
      where organization_id = p_organization_id and site_url = v_url
      order by id desc
      limit 1;
    end if;

    if v_existing is not null then
      update public.signals set
        name = v_title,
        summary = coalesce(v_summary, summary),
        description = coalesce(v_description, description),
        category_id = v_category_id,
        updated_by = coalesce(v_uid, updated_by),
        updated_at = now()
      where id = v_existing
      returning id into v_signal_id;
      v_updated := v_updated + 1;
    else
      insert into public.signals (
        organization_id, category_id, name, site_url, summary, description,
        is_organized, created_by, updated_by
      ) values (
        p_organization_id, v_category_id, v_title, v_url,
        coalesce(v_summary, '自动采集 · 待核实'),
        coalesce(v_description, ''),
        false,
        coalesce(v_uid, (select user_id from public.organization_members where organization_id = p_organization_id order by created_at limit 1)),
        coalesce(v_uid, (select user_id from public.organization_members where organization_id = p_organization_id order by created_at limit 1))
      ) returning id into v_signal_id;
      v_created := v_created + 1;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'signal_id', v_signal_id,
      'title', v_title,
      'category_id', v_category_id,
      'url', v_url
    ));
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'skipped', v_skipped,
    'items', v_results
  );
end;
$$;

revoke all on function public.ingest_harvested_signals(uuid, jsonb) from public, anon;
grant execute on function public.ingest_harvested_signals(uuid, jsonb) to authenticated, service_role;

comment on function public.ingest_harvested_signals(uuid, jsonb) is
  'Upsert harvested titles/URLs into signals with category classification. Never publishes site_entries.';
