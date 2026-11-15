-- P3 Quick Capture: one atomic RPC for "link / idea -> topic pool" and
-- "link / idea -> topic -> project -> master + platform documents -> queued content_draft jobs".
--
-- Identity model
-- * Browser: public.quick_capture(...) runs with the caller's JWT. Requires content.manage;
--   auto_draft also requires agent.dispatch (enqueue_agent_job re-checks it).
-- * Trusted server (intake-gateway / future IM channels): public.quick_capture_for_connection(token_hash, input)
--   is service_role only. Organization and acting user come from the intake connection (never from the request);
--   the connection creator must still hold content.manage (+ agent.dispatch for auto_draft). The function
--   binds auth.uid() to that user for the rest of the call (only the `sub` claim; role stays service_role, so
--   human-only actions such as decide_approval_request remain impossible) and restores the claims afterwards.
-- * Every write goes through the existing triggers (cloud content guard, revision snapshot, job state machine).

-- Worker records the optional URL fetch as its own audit step (round 0).
alter table public.agent_job_steps drop constraint agent_job_steps_step_kind_check;
alter table public.agent_job_steps add constraint agent_job_steps_step_kind_check
 check (step_kind in ('context','fetch','generate','precheck','evaluate','persist'));

create table public.quick_captures (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
 channel text not null check (channel in ('web','connection')),
 connection_id uuid,
 intent text not null check (intent in ('capture_only','auto_draft')),
 input jsonb not null check (jsonb_typeof(input)='object'),
 signal_id bigint not null,
 selection_id bigint not null,
 project_id uuid,
 result jsonb not null check (jsonb_typeof(result)='object'),
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 unique (organization_id, idempotency_key),
 foreign key (organization_id, signal_id) references public.signals(organization_id, id),
 foreign key (organization_id, selection_id) references public.selections(organization_id, id),
 foreign key (organization_id, project_id) references public.content_projects(organization_id, id),
 foreign key (organization_id, connection_id) references public.intake_connections(organization_id, id)
);
comment on table public.quick_captures is '速记收录回执（幂等键 org 内唯一）。只能经 quick_capture / quick_capture_for_connection 写入。';
create index quick_captures_org_created_idx on public.quick_captures (organization_id, created_at desc);
create index quick_captures_creator_idx on public.quick_captures (created_by, created_at);
create index quick_captures_connection_idx on public.quick_captures (connection_id, created_at);
create index quick_captures_org_signal_idx on public.quick_captures (organization_id, signal_id);
create index quick_captures_org_selection_idx on public.quick_captures (organization_id, selection_id);
create index quick_captures_org_project_idx on public.quick_captures (organization_id, project_id);

alter table public.quick_captures enable row level security;
revoke all on public.quick_captures from anon, authenticated;
grant select on public.quick_captures to authenticated;
grant select on public.quick_captures to service_role;
create policy quick_captures_read on public.quick_captures for select to authenticated
 using ((select private.has_organization_permission(organization_id,'content.view')));

create function private.quick_capture_platform_label(p text) returns text
language sql immutable set search_path='' as $$
 select case p when 'master' then '母稿' when 'wechat_channels' then '视频号' when 'wechat_official' then '公众号'
  when 'xiaohongshu' then '小红书' when 'douyin' then '抖音' when 'x' then 'X' when 'youtube' then 'YouTube'
  when 'reddit' then 'Reddit' else p end
$$;

-- Validate and normalize user input. Raises 22023 'invalid_input' style messages.
create function private.quick_capture_normalize(p_url text, p_note text, p_title text, p_intent text, p_platforms text[])
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

-- Core pipeline. Caller must have bound auth.uid() to p_actor and checked the channel credential.
create function private.quick_capture_core(
 p_organization_id uuid, p_actor uuid, p_channel text, p_connection_id uuid, p_idempotency_key text, p_input jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 existing public.quick_captures;
 capture_id uuid := gen_random_uuid();
 cat bigint; sig bigint; sel bigint; proj uuid; doc uuid; job public.agent_jobs;
 url text := p_input->>'url'; note text := p_input->>'note'; title text := p_input->>'title';
 intent text := p_input->>'intent';
 platform text; docs jsonb := '[]'::jsonb; result jsonb; instruction text;
begin
 if auth.uid() is distinct from p_actor then raise exception '调用身份不一致' using errcode='42501'; end if;
 if not private.has_organization_permission(p_organization_id,'content.manage') then
  raise exception '没有内容管理权限' using errcode='42501';
 end if;
 if intent = 'auto_draft' and not private.has_organization_permission(p_organization_id,'agent.dispatch') then
  raise exception '没有调度 Agent 任务的权限' using errcode='42501';
 end if;
 -- Serialize retries of the same key, then dedupe.
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':quick_capture:' || p_idempotency_key, 0));
 select * into existing from public.quick_captures where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
 if found then
  if existing.input <> p_input then raise exception 'idempotency_conflict' using errcode='23505'; end if;
  return existing.result || jsonb_build_object('duplicate', true);
 end if;
 if (select count(*) from public.quick_captures where created_by = p_actor and created_at > now() - interval '1 hour') >= 120 then
  raise exception 'rate_limited' using errcode='P0001';
 end if;

 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));
 select id into cat from public.source_categories where organization_id = p_organization_id and name = '速记收集' and parent_id is null order by id limit 1;
 if cat is null then
  insert into public.source_categories(organization_id, name, description, created_by, updated_by)
  values (p_organization_id, '速记收集', '控制台 / 外部通道速记，链接正文尚待核实', p_actor, p_actor) returning id into cat;
 end if;
 insert into public.signals(organization_id, category_id, name, site_url, summary, description, is_organized, created_by, updated_by)
 values (p_organization_id, cat, title, url,
  case when url is null then '速记想法 · 待核实' else '速记链接 · 原文待抓取与核实' end,
  note, true, p_actor, p_actor) returning id into sig;
 insert into public.selections(organization_id, signal_id, name, core_thesis, description, created_by, updated_by)
 values (p_organization_id, sig, title, left(note, 512),
  case when intent = 'auto_draft' then '速记自动立项，Agent 草案待人工审核。' else '速记形成的候选选题，等待选定及资料核查。' end,
  p_actor, p_actor) returning id into sel;

 if intent = 'auto_draft' then
  insert into public.content_projects(organization_id, selection_id, title, brief)
  values (p_organization_id, sel, title, concat_ws(E'\n',
   case when note is not null then '速记备注：' || note end,
   case when url is not null then '来源链接：' || url end,
   '由速记自动立项；Agent 只产出提案，需人工采纳与审核。')) returning id into proj;
  foreach platform in array array['master'] || array(select jsonb_array_elements_text(p_input->'platforms')) loop
   insert into public.content_documents(organization_id, project_id, platform, title, body)
   values (p_organization_id, proj, platform, title, '') returning id into doc;
   instruction := format('根据速记信源撰写%s初稿。%s', private.quick_capture_platform_label(platform),
    coalesce('用户角度/备注：' || note, '用户只提供了链接，请围绕信源核心信息展开，无法确认的事实标注 [待核实]。'));
   job := public.enqueue_agent_job(p_organization_id, 'content_draft', 'quick_capture:' || capture_id || ':' || platform,
    jsonb_build_object('document_id', doc, 'instruction', instruction, 'source', 'quick_capture',
     'quick_capture_id', capture_id, 'fetch_source', url is not null),
    'content_document', doc::text, 1);
   docs := docs || jsonb_build_object('platform', platform, 'document_id', doc, 'job_id', job.id);
  end loop;
 end if;

 result := jsonb_build_object('capture_id', capture_id, 'intent', intent, 'duplicate', false,
  'signal_id', sig, 'selection_id', sel, 'project_id', proj, 'documents', docs,
  'topic_path', '/topics/' || sel,
  'project_path', case when proj is null then null else '/content/projects/' || proj end);
 insert into public.quick_captures(id, organization_id, idempotency_key, channel, connection_id, intent, input,
  signal_id, selection_id, project_id, result, created_by)
 values (capture_id, p_organization_id, p_idempotency_key, p_channel, p_connection_id, intent, p_input,
  sig, sel, proj, result, p_actor);
 insert into public.audit_events(organization_id, actor_user_id, action, target_type, target_id, metadata)
 values (p_organization_id, p_actor, 'quick_capture.created', 'quick_capture', capture_id::text,
  jsonb_build_object('intent', intent, 'channel', p_channel, 'documents', jsonb_array_length(docs)));
 return result;
end; $$;
revoke all on function private.quick_capture_platform_label(text) from public, anon, authenticated;
revoke all on function private.quick_capture_normalize(text,text,text,text,text[]) from public, anon, authenticated;
revoke all on function private.quick_capture_core(uuid,uuid,text,uuid,text,jsonb) from public, anon, authenticated;

-- Browser entry.
create function public.quick_capture(
 p_organization_id uuid, p_url text, p_note text, p_intent text, p_platforms text[], p_idempotency_key text,
 p_title text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then
  raise exception '需要登录' using errcode='42501';
 end if;
 if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 or p_idempotency_key like 'conn:%' then
  raise exception 'invalid_input: 幂等键无效' using errcode='22023';
 end if;
 return private.quick_capture_core(p_organization_id, auth.uid(), 'web', null, p_idempotency_key,
  private.quick_capture_normalize(p_url, p_note, p_title, p_intent, p_platforms));
end; $$;
revoke all on function public.quick_capture(uuid,text,text,text,text[],text,text) from public, anon;
grant execute on function public.quick_capture(uuid,text,text,text,text[],text,text) to authenticated;

-- Trusted-server entry (intake-gateway, IM adapters). Input:
-- {version:1, intent:'capture'|'capture_only'|'auto_draft', external_id, text, title?, url?, angle?, platforms?[]}
-- capture / capture_only delegate unchanged to accept_intake (existing receipts + dedupe).
create function public.quick_capture_for_connection(p_token_hash text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c public.intake_connections;
 old_claims text := current_setting('request.jwt.claims', true);
 old_sub text := current_setting('request.jwt.claim.sub', true);
 normalized jsonb; result jsonb; note text;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or (p_input->>'version') is distinct from '1' then
  raise exception 'invalid_input' using errcode='22023';
 end if;
 if p_input->>'intent' in ('capture','capture_only') then
  return public.accept_intake(p_token_hash, (p_input - 'platforms') || jsonb_build_object('intent','capture'));
 end if;
 if p_input->>'intent' is distinct from 'auto_draft'
  or coalesce(char_length(btrim(p_input->>'external_id')),0) not between 1 and 128
  or coalesce(char_length(btrim(p_input->>'text')),0) not between 1 and 4000
  or coalesce(char_length(p_input->>'angle'),0) > 512
  or (p_input ? 'platforms' and jsonb_typeof(p_input->'platforms') <> 'array') then
  raise exception 'invalid_input' using errcode='22023';
 end if;
 select * into c from public.intake_connections where token_hash = p_token_hash for update;
 if not found or c.revoked_at is not null or c.expires_at <= now() then
  raise exception 'invalid_connection' using errcode='28000';
 end if;
 if (select count(*) from public.quick_captures where connection_id = c.id and created_at > now() - interval '1 hour')
  + (select count(*) from public.intake_receipts where connection_id = c.id and created_at > now() - interval '1 hour') >= 100 then
  raise exception 'rate_limited' using errcode='P0001';
 end if;
 note := btrim(p_input->>'text') || coalesce(E'\n角度：' || nullif(btrim(p_input->>'angle'),''), '');
 begin
  normalized := private.quick_capture_normalize(p_input->>'url', note, p_input->>'title', 'auto_draft',
   array(select jsonb_array_elements_text(coalesce(p_input->'platforms','[]'::jsonb))));
 exception when sqlstate '22023' then
  raise exception 'invalid_input' using errcode='22023';
 end;
 -- Act as the connection's creator for this call only (sub claim; role is left untouched).
 perform set_config('request.jwt.claims', (coalesce(nullif(old_claims,''),'{}')::jsonb || jsonb_build_object('sub', c.created_by))::text, true);
 perform set_config('request.jwt.claim.sub', c.created_by::text, true);
 begin
  result := private.quick_capture_core(c.organization_id, c.created_by, 'connection', c.id,
   'conn:' || c.id || ':' || btrim(p_input->>'external_id'), normalized);
 exception when sqlstate '42501' then
  raise exception 'invalid_connection' using errcode='28000';
 end;
 perform set_config('request.jwt.claims', coalesce(old_claims,''), true);
 perform set_config('request.jwt.claim.sub', coalesce(old_sub,''), true);
 return result;
end; $$;
revoke all on function public.quick_capture_for_connection(text,jsonb) from public, anon, authenticated;
grant execute on function public.quick_capture_for_connection(text,jsonb) to service_role;
