-- Capture (docs/database.md §4.1, DB2b): one core for every entrance.
--
--   capture_only : record one intake_events row; it waits in the inbox.
--   auto_draft   : the same row, plus in one transaction a work_items card, a master document and one
--                  document per requested platform, and one content_draft job per document.
--
-- Identity model
-- * Browser: public.quick_capture(...) runs with the caller's JWT. Requires content.manage;
--   auto_draft also requires agent.dispatch (enqueue_agent_job re-checks it).
-- * Trusted server (intake-gateway, im-webhook): public.quick_capture_for_connection(token_hash, input) and
--   public.accept_intake(token_hash, input) are service_role only. Organization and acting user come from the
--   intake connection, never from the request; the connection creator must still hold content.manage
--   (+ agent.dispatch for auto_draft). For auto_draft the call binds auth.uid() to that user (only the `sub`
--   claim; role stays service_role, so human-only actions such as decide_approval_request stay impossible)
--   and restores the claims afterwards.
-- * Dedupe is the intake_events key: (organization, source, connection, external_id). A retry with the same
--   key and the same input returns the first result; the same key with different input is a conflict.

-- Worker records the optional URL fetch as its own audit step (round 0).
alter table public.agent_job_steps drop constraint agent_job_steps_step_kind_check;
alter table public.agent_job_steps add constraint agent_job_steps_step_kind_check
 check (step_kind in ('context','fetch','generate','precheck','evaluate','persist'));

create function private.capture_platform_label(p text) returns text
language sql immutable set search_path='' as $$
 select case p when 'master' then '母稿' when 'wechat_channels' then '视频号' when 'wechat_official' then '公众号'
  when 'xiaohongshu' then '小红书' when 'douyin' then '抖音' when 'x' then 'X' when 'youtube' then 'YouTube'
  when 'reddit' then 'Reddit' else p end
$$;

-- Validate and normalize user input. Raises 22023 'invalid_input: …'.
create function private.capture_normalize(p_url text, p_note text, p_title text, p_intent text, p_platforms text[])
returns jsonb language plpgsql immutable set search_path='' as $$
declare
 url text := nullif(btrim(coalesce(p_url,'')),'');
 note text := nullif(btrim(coalesce(p_note,'')),'');
 title text := nullif(btrim(regexp_replace(coalesce(p_title,''),'\s+',' ','g')),'');
 platforms text[];
 p text;
begin
 if p_intent is null or p_intent not in ('capture_only','auto_draft') then
  raise exception 'invalid_input: intent 必须是 capture_only 或 auto_draft' using errcode='22023';
 end if;
 if url is null and note is null then raise exception 'invalid_input: 请提供链接或一句话想法' using errcode='22023'; end if;
 if url is not null and (char_length(url) > 512 or url !~* '^https?://[^/?#[:space:]@]+([/?#][^[:space:]]*)?$') then
  raise exception 'invalid_input: 链接必须是不含凭证的 http(s) 地址（≤512 字符）' using errcode='22023';
 end if;
 if note is not null and char_length(note) > 4000 then raise exception 'invalid_input: 备注最多 4000 字' using errcode='22023'; end if;
 if title is not null and char_length(title) > 64 then raise exception 'invalid_input: 标题最多 64 字' using errcode='22023'; end if;
 if title is null then
  title := left(btrim(regexp_replace(coalesce(note, regexp_replace(url,'^https?://','','i')),'\s+',' ','g')), 64);
 end if;
 platforms := array[]::text[];
 if p_intent = 'auto_draft' then
  foreach p in array coalesce(p_platforms, array[]::text[]) loop
   if p not in ('wechat_channels','wechat_official','xiaohongshu','douyin','x','youtube','reddit') then
    raise exception 'invalid_input: 不支持的平台 %', p using errcode='22023';
   end if;
   if not p = any(platforms) then platforms := platforms || p; end if;
  end loop;
 end if;
 return jsonb_build_object('url', url, 'note', note, 'title', title, 'intent', p_intent, 'platforms', to_jsonb(platforms));
end; $$;

-- Result of an existing capture, rebuilt from the rows it created (intake_events stays immutable).
create function private.capture_result(e public.intake_events, p_duplicate boolean) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'event_id', e.id, 'intent', e.payload->'input'->>'intent', 'duplicate', p_duplicate,
  'work_item_id', e.work_item_id,
  'documents', coalesce((
   select jsonb_agg(jsonb_build_object('platform', d.platform, 'document_id', d.id,
     'job_id', (select j.id from public.agent_jobs j where j.organization_id = d.organization_id
                and j.idempotency_key = 'capture:' || e.id || ':' || d.platform))
     order by d.platform = 'master' desc, d.platform)
   from public.content_documents d where d.organization_id = e.organization_id and d.work_item_id = e.work_item_id
  ), '[]'::jsonb),
  'inbox_path', '/intake',
  'item_path', case when e.work_item_id is null then null else '/work-items/' || e.work_item_id end)
$$;

-- Core pipeline. Caller has authenticated the actor (browser JWT or connection) and normalized the input.
create function private.capture_core(
 p_organization_id uuid, p_source text, p_connection_id uuid, p_external_id text, p_input jsonb, p_extra jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 existing public.intake_events;
 ev public.intake_events;
 item uuid; doc uuid; job public.agent_jobs;
 url text := p_input->>'url'; note text := p_input->>'note'; title text := p_input->>'title';
 intent text := p_input->>'intent';
 platform text; instruction text;
begin
 if auth.uid() is not null and not private.has_organization_permission(p_organization_id,'content.manage') then
  raise exception '没有内容管理权限' using errcode='42501';
 end if;
 if intent = 'auto_draft' and not private.has_organization_permission(p_organization_id,'agent.dispatch') then
  raise exception '没有调度 Agent 任务的权限' using errcode='42501';
 end if;

 -- Serialize retries of the same key, then dedupe.
 perform pg_advisory_xact_lock(hashtextextended(concat_ws(':', p_organization_id, p_source, p_connection_id, p_external_id), 0));
 select * into existing from public.intake_events e
 where e.organization_id = p_organization_id and e.source = p_source
   and e.connection_id is not distinct from p_connection_id and e.external_id = p_external_id;
 if found then
  if existing.payload->'input' is distinct from p_input then raise exception 'idempotency_conflict' using errcode='23505'; end if;
  return private.capture_result(existing, true);
 end if;

 if p_connection_id is not null then
  if (select count(*) from public.intake_events where connection_id = p_connection_id and created_at > now() - interval '1 hour') >= 100 then
   raise exception 'rate_limited' using errcode='P0001';
  end if;
 elsif (select count(*) from public.intake_events where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 120 then
  raise exception 'rate_limited' using errcode='P0001';
 end if;

 ev := public.record_intake_event(p_organization_id, p_source, p_external_id,
  concat_ws(E'\n\n', title, note), url,
  jsonb_build_object('input', p_input, 'intent', intent) || coalesce(p_extra, '{}'::jsonb), p_connection_id);

 if intent = 'auto_draft' then
  insert into public.work_items(organization_id, kind, title, brief, status, created_by)
  values (p_organization_id, 'article', title,
   jsonb_strip_nulls(jsonb_build_object('text', note, 'url', url, 'platforms', p_input->'platforms', 'intake_event_id', ev.id)),
   'doing', auth.uid())
  returning id into item;
  update public.intake_events set work_item_id = item where id = ev.id returning * into ev;

  foreach platform in array array['master'] || array(select jsonb_array_elements_text(p_input->'platforms')) loop
   insert into public.content_documents(organization_id, work_item_id, platform, title, body)
   values (p_organization_id, item, platform, title, '') returning id into doc;
   instruction := format('根据速记信源撰写%s初稿。%s', private.capture_platform_label(platform),
    coalesce('用户角度/备注：' || note, '用户只提供了链接，请围绕信源核心信息展开，无法确认的事实标注 [待核实]。'));
   job := public.enqueue_agent_job(p_organization_id, 'content_draft', 'capture:' || ev.id || ':' || platform,
    jsonb_build_object('document_id', doc, 'instruction', instruction, 'source', 'capture',
     'intake_event_id', ev.id, 'fetch_source', url is not null),
    'content_document', doc::text, 1);
  end loop;
 end if;

 insert into public.audit_events(organization_id, actor_user_id, action, target_type, target_id, metadata)
 values (p_organization_id, auth.uid(), 'intake.captured', 'intake_event', ev.id::text,
  jsonb_build_object('intent', intent, 'source', p_source, 'work_item_id', item));
 return private.capture_result(ev, false);
end; $$;
revoke all on function private.capture_platform_label(text) from public, anon, authenticated;
revoke all on function private.capture_normalize(text,text,text,text,text[]) from public, anon, authenticated;
revoke all on function private.capture_result(public.intake_events, boolean) from public, anon, authenticated;
revoke all on function private.capture_core(uuid,text,uuid,text,jsonb,jsonb) from public, anon, authenticated;

-- Browser entry.
create function public.quick_capture(
 p_organization_id uuid, p_url text, p_note text, p_intent text, p_platforms text[], p_idempotency_key text,
 p_title text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then
  raise exception '需要登录' using errcode='42501';
 end if;
 if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
  raise exception 'invalid_input: 幂等键无效' using errcode='22023';
 end if;
 return private.capture_core(p_organization_id, 'web', null, p_idempotency_key,
  private.capture_normalize(p_url, p_note, p_title, p_intent, p_platforms));
end; $$;
revoke all on function public.quick_capture(uuid,text,text,text,text[],text,text) from public, anon;
grant execute on function public.quick_capture(uuid,text,text,text,text[],text,text) to authenticated;

-- Shared by every trusted-server entrance. Input:
-- {version:1, intent:'capture'|'capture_only'|'auto_draft', external_id, text, title?, url?, angle?, platforms?[]}
create function private.capture_for_connection(p_connection public.intake_connections, p_source text, p_input jsonb, p_extra jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c public.intake_connections := p_connection;
 old_claims text := current_setting('request.jwt.claims', true);
 old_sub text := current_setting('request.jwt.claim.sub', true);
 intent text := case when p_input->>'intent' in ('capture','capture_only') then 'capture_only' else p_input->>'intent' end;
 normalized jsonb; result jsonb; note text;
begin
 if c.id is null or c.revoked_at is not null or c.expires_at <= now() then
  raise exception 'invalid_connection' using errcode='28000';
 end if;
 if jsonb_typeof(p_input) is distinct from 'object' or (p_input->>'version') is distinct from '1'
  or intent not in ('capture_only','auto_draft')
  or coalesce(char_length(btrim(p_input->>'external_id')),0) not between 1 and 128
  or coalesce(char_length(btrim(p_input->>'text')),0) not between 1 and 4000
  or coalesce(char_length(p_input->>'angle'),0) > 512
  or (p_input ? 'platforms' and jsonb_typeof(p_input->'platforms') <> 'array') then
  raise exception 'invalid_input' using errcode='22023';
 end if;
 -- The connection only works while its creator may still manage content.
 if not exists (select 1 from public.organization_members m join public.organization_roles r
   on r.organization_id = m.organization_id and r.role_key = m.role
   where m.organization_id = c.organization_id and m.user_id = c.created_by and 'content.manage' = any(r.permissions)) then
  raise exception 'invalid_connection' using errcode='28000';
 end if;
 note := btrim(p_input->>'text') || coalesce(E'\n角度：' || nullif(btrim(p_input->>'angle'),''), '');
 begin
  normalized := private.capture_normalize(p_input->>'url', note, p_input->>'title', intent,
   array(select jsonb_array_elements_text(coalesce(p_input->'platforms','[]'::jsonb))));
 exception when sqlstate '22023' then
  raise exception 'invalid_input' using errcode='22023';
 end;
 if intent = 'auto_draft' then
  -- Act as the connection's creator for this call only (sub claim; role is left untouched).
  perform set_config('request.jwt.claims', (coalesce(nullif(old_claims,''),'{}')::jsonb || jsonb_build_object('sub', c.created_by))::text, true);
  perform set_config('request.jwt.claim.sub', c.created_by::text, true);
 end if;
 begin
  result := private.capture_core(c.organization_id, p_source, c.id, btrim(p_input->>'external_id'), normalized, p_extra);
 exception when sqlstate '42501' then
  raise exception 'invalid_connection' using errcode='28000';
 end;
 perform set_config('request.jwt.claims', coalesce(old_claims,''), true);
 perform set_config('request.jwt.claim.sub', coalesce(old_sub,''), true);
 return result;
end; $$;
revoke all on function private.capture_for_connection(public.intake_connections, text, jsonb, jsonb) from public, anon, authenticated;

create function public.quick_capture_for_connection(p_token_hash text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.intake_connections;
begin
 select * into c from public.intake_connections where token_hash = p_token_hash for update;
 return private.capture_for_connection(c, 'api', p_input, '{}'::jsonb);
end; $$;
revoke all on function public.quick_capture_for_connection(text,jsonb) from public, anon, authenticated;
grant execute on function public.quick_capture_for_connection(text,jsonb) to service_role;

-- V1 external entrance (applied in 20261006131202), kept for the deployed intake-gateway: same input,
-- now lands in the inbox instead of creating a signal + selection.
create or replace function public.accept_intake(p_token_hash text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 if (p_input->>'intent') is distinct from 'capture'
  or coalesce(char_length(btrim(p_input->>'title')),0) not between 1 and 64
  or coalesce(char_length(p_input->>'url'),0) > 512 then
  raise exception 'invalid_input' using errcode='22023';
 end if;
 r := public.quick_capture_for_connection(p_token_hash, (p_input - 'platforms') || jsonb_build_object('intent', 'capture_only'));
 return jsonb_build_object('receipt_id', r->'event_id', 'event_id', r->'event_id', 'duplicate', r->'duplicate',
  'status', 'captured', 'topic_path', r->>'inbox_path');
end; $$;
revoke all on function public.accept_intake(text,jsonb) from public, anon, authenticated;
grant execute on function public.accept_intake(text,jsonb) to service_role;
