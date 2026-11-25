-- DB2c-2 (docs/database.md §4.4, DB-D16): node identity. A worker holds a revocable node token instead of
-- service_role and calls node_* RPCs with the publishable key; each RPC hashes the token and resolves the node.
--   runner_nodes: id, organization_id, name, token_hash, revoked_at, last_seen_at, created_at
--   agent_jobs.node_id → runner_nodes (set by node_claim; cleared when the job leaves running, as before)
-- A node claims only jobs of its own organization and writes only jobs it currently holds (node_id + lease_epoch).
-- The service_role node RPCs of DB2c-1 stay for the video worker until DB5.

-- ── 1. runner_nodes ──
create table public.runner_nodes (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check (char_length(btrim(name)) between 1 and 80),
 token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
 revoked_at timestamptz,
 last_seen_at timestamptz,
 created_at timestamptz not null default now()
);
create index runner_nodes_organization_idx on public.runner_nodes(organization_id, created_at desc);
-- A revoked node's name can be reused for its replacement.
create unique index runner_nodes_active_name on public.runner_nodes(organization_id, name) where revoked_at is null;
alter table public.runner_nodes enable row level security;
revoke all on public.runner_nodes from anon, authenticated;
-- token_hash is never readable from the browser; create / revoke go through the RPCs below.
grant select (id, organization_id, name, revoked_at, last_seen_at, created_at) on public.runner_nodes to authenticated;
create policy runner_nodes_select on public.runner_nodes for select to authenticated
 using ((select private.has_organization_permission(organization_id, 'content.view')));

alter table public.agent_jobs
 add constraint agent_jobs_node_id_fkey foreign key (node_id) references public.runner_nodes(id) on delete set null;
create index agent_jobs_node_idx on public.agent_jobs(node_id) where node_id is not null;

-- ── 2. Create / revoke (organization.manage). The plain token is returned once and never stored. ──
create function public.create_runner_node(p_organization_id uuid, p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_token text := 'stn_' || encode(extensions.gen_random_bytes(32), 'hex'); n public.runner_nodes;
begin
 if not private.has_organization_permission(p_organization_id, 'organization.manage') then
  raise exception '没有管理执行节点的权限' using errcode='42501';
 end if;
 if exists (select 1 from public.runner_nodes where organization_id = p_organization_id and name = btrim(p_name) and revoked_at is null) then
  raise exception '已有同名的未吊销节点' using errcode='unique_violation';
 end if;
 insert into public.runner_nodes(organization_id, name, token_hash)
 values (p_organization_id, btrim(p_name), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
 returning * into n;
 return jsonb_build_object('id', n.id, 'name', n.name, 'created_at', n.created_at, 'token', v_token);
end; $$;

create function public.revoke_runner_node(p_node_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare n public.runner_nodes;
begin
 select * into n from public.runner_nodes where id = p_node_id for update;
 if not found or not private.has_organization_permission(n.organization_id, 'organization.manage') then
  raise exception '没有管理执行节点的权限' using errcode='42501';
 end if;
 update public.runner_nodes set revoked_at = coalesce(revoked_at, now()) where id = n.id;
end; $$;
revoke all on function public.create_runner_node(uuid, text) from public, anon;
revoke all on function public.revoke_runner_node(uuid) from public, anon;
grant execute on function public.create_runner_node(uuid, text) to authenticated;
grant execute on function public.revoke_runner_node(uuid) to authenticated;

-- ── 3. Token → node, and node → the job it holds ──
create function private.node_from_token(p_token text) returns public.runner_nodes
language plpgsql security definer set search_path='' as $$
declare n public.runner_nodes;
begin
 if p_token is null or p_token !~ '^stn_[a-f0-9]{64}$' then raise exception '节点令牌无效' using errcode='42501'; end if;
 select * into n from public.runner_nodes
 where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and revoked_at is null;
 if not found then raise exception '节点令牌无效或已吊销' using errcode='42501'; end if;
 -- Presence for the console ("online" = seen within the last two minutes); throttled to one write per 30 s.
 if n.last_seen_at is null or n.last_seen_at < now() - interval '30 seconds' then
  update public.runner_nodes set last_seen_at = now() where id = n.id;
 end if;
 return n;
end; $$;

-- The job must belong to the node's organization and be held by this node right now.
create function private.node_job(p_token text, p_job_id uuid) returns public.agent_jobs
language plpgsql security definer set search_path='' as $$
declare n public.runner_nodes := private.node_from_token(p_token); j public.agent_jobs;
begin
 select * into j from public.agent_jobs where id = p_job_id and organization_id = n.organization_id;
 if not found or j.node_id is distinct from n.id or j.status <> 'running' then
  raise exception '该任务不由本节点执行，拒绝访问' using errcode='42501';
 end if;
 return j;
end; $$;
revoke all on function private.node_from_token(text) from public, anon, authenticated;
revoke all on function private.node_job(text, uuid) from public, anon, authenticated;

-- ── 4. Claim: same queue rules as claim_agent_job (expiry sweep, card serialization, Mandate), scoped to the node ──
create function public.node_claim(p_token text, p_job_types text[], p_lease_seconds integer default 120) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.runner_nodes := private.node_from_token(p_token); j public.agent_jobs; cand uuid; tried uuid[] := '{}';
begin
 if p_lease_seconds is null or p_lease_seconds not between 15 and 3600 then raise exception 'lease_seconds 需在 15–3600 之间'; end if;
 update public.agent_jobs set
  status = case when cancel_requested_at is not null then 'cancelled' when attempts >= max_attempts then 'failed' else 'queued' end,
  error = case when cancel_requested_at is not null then '人工取消' when attempts >= max_attempts then '执行租约过期且已无剩余重试次数' else '执行租约过期，已重新排队' end,
  error_code = 'lease_expired'
 where status = 'running' and locked_until < now() and organization_id = n.organization_id;

 for i in 1..20 loop
  select q.id into cand from public.agent_jobs q
  where q.organization_id = n.organization_id and q.status = 'queued' and q.kind = any(p_job_types)
   and q.run_after <= now() and not (q.id = any(tried))
   and (q.work_item_id is null or q.kind = 'chat_turn' or not exists (
    select 1 from public.agent_jobs r where r.work_item_id = q.work_item_id and r.status = 'running' and r.kind <> 'chat_turn'))
  order by q.run_after, q.created_at
  for update skip locked
  limit 1;
  if not found then return null; end if;
  tried := tried || cand;
  begin
   update public.agent_jobs set status = 'running', lease_epoch = lease_epoch + 1, node_id = n.id,
    locked_until = now() + make_interval(secs => p_lease_seconds), attempts = attempts + 1
   where id = cand returning * into j;
  exception when unique_violation then
   continue;
  end;
  if j.status = 'running' then return to_jsonb(j); end if;
 end loop;
 return null;
end; $$;

-- ── 5. Lease-bound writes: ownership check, then the DB2c-1 RPC (which re-checks lease_epoch) ──
create function public.node_heartbeat(p_token text, p_job_id uuid, p_lease_epoch bigint, p_lease_seconds integer default 120) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.runner_nodes := private.node_from_token(p_token);
begin
 -- A job the node lost (expired, cancelled, re-claimed elsewhere) reports ok=false instead of raising.
 if not exists (select 1 from public.agent_jobs where id = p_job_id and organization_id = n.organization_id and node_id = n.id) then
  return jsonb_build_object('ok', false, 'cancel_requested', false);
 end if;
 return public.heartbeat_agent_job(p_job_id, p_lease_epoch, p_lease_seconds);
end; $$;

create function public.node_complete(
 p_token text, p_job_id uuid, p_lease_epoch bigint, p_status text, p_result jsonb default null, p_error text default null, p_error_code text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.node_job(p_token, p_job_id);
 return to_jsonb(public.complete_agent_job(p_job_id, p_lease_epoch, p_status, p_result, p_error, p_error_code));
end; $$;

create function public.node_fail(
 p_token text, p_job_id uuid, p_lease_epoch bigint, p_error text, p_retryable boolean default false, p_retry_delay_seconds integer default 30, p_error_code text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.node_job(p_token, p_job_id);
 return to_jsonb(public.fail_agent_job(p_job_id, p_lease_epoch, p_error, p_retryable, p_retry_delay_seconds, p_error_code));
end; $$;

create function public.node_record_step(
 p_token text, p_job_id uuid, p_lease_epoch bigint, p_kind text, p_status text default 'succeeded',
 p_output jsonb default '{}'::jsonb, p_usage jsonb default '{}'::jsonb, p_error text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.node_job(p_token, p_job_id);
 return to_jsonb(public.record_agent_job_step(p_job_id, p_lease_epoch, p_kind, p_status, p_output, p_usage, p_error));
end; $$;

-- ── 6. Reads for the job the node holds ──
create function public.node_list_steps(p_token text, p_job_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.node_job(p_token, p_job_id);
 return (select coalesce(jsonb_agg(to_jsonb(s) order by s.seq), '[]'::jsonb) from public.agent_job_steps s where s.job_id = p_job_id);
end; $$;

-- Context Pack rows for a content_draft job: target document, its card, the card's first input, memories, knowledge.
create function public.node_draft_context(p_token text, p_job_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs := private.node_job(p_token, p_job_id); d public.content_documents; w jsonb; src jsonb;
begin
 select * into d from public.content_documents
 where id::text = j.payload->'target'->>'id' and organization_id = j.organization_id and j.payload->'target'->>'type' = 'content_document';
 if not found then raise exception '任务目标稿件不存在' using errcode='P0002'; end if;
 select jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'brief', x.brief) into w
 from public.work_items x where x.id = d.work_item_id and x.organization_id = j.organization_id;
 if w is not null then
  select jsonb_build_object('id', e.id, 'text', e.text, 'url', e.url, 'created_at', e.created_at) into src
  from public.intake_events e where e.work_item_id = d.work_item_id and e.organization_id = j.organization_id
  order by e.created_at, e.id limit 1;
 end if;
 return jsonb_build_object(
  'document', jsonb_build_object('id', d.id, 'organization_id', d.organization_id, 'work_item_id', d.work_item_id,
    'platform', d.platform, 'title', d.title, 'body', d.body, 'revision', d.revision),
  'workItem', w,
  'source', src,
  'memories', (select coalesce(jsonb_agg(m.r order by m.created_at desc), '[]'::jsonb) from (
    select jsonb_build_object('id', id, 'kind', kind, 'summary', summary, 'human_quote', human_quote, 'platform', platform,
      'content_kind', content_kind, 'active', active, 'expires_at', expires_at, 'created_at', created_at) as r, created_at
    from public.decision_memories
    where organization_id = j.organization_id and active and (expires_at is null or expires_at > now())
    order by created_at desc limit 100) m),
  'knowledge', (select coalesce(jsonb_agg(k.r order by k.updated_at desc), '[]'::jsonb) from (
    select jsonb_build_object('slug', slug, 'title', title, 'category', category, 'tags', tags, 'content', content, 'trust_level', trust_level) as r, updated_at
    from public.knowledge_entries
    where organization_id = j.organization_id and trust_level <> 'archived'
    order by updated_at desc limit 200) k));
end; $$;

create function public.node_storyboard_knowledge(p_token text, p_job_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs := private.node_job(p_token, p_job_id);
begin
 return (select coalesce(jsonb_agg(k.r order by k.slug), '[]'::jsonb) from (
  select slug, jsonb_build_object('slug', slug, 'title', title, 'content', content, 'tags', tags, 'category', category) as r
  from public.knowledge_entries
  where organization_id = j.organization_id and trust_level = 'trusted'
   and (slug = 'video-storyboard-sop' or 'video' = any(tags) or category = 'brand_voice')
  order by slug limit 10) k);
end; $$;

-- ── 7. Proposals (idempotent per job; content_ai_proposals is retired in DB2c-3) ──
create function public.node_save_proposal(p_token text, p_job_id uuid, p_lease_epoch bigint, p_proposal jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs := private.node_job(p_token, p_job_id); v_id uuid; d public.content_documents;
begin
 if j.lease_epoch is distinct from p_lease_epoch then raise exception '任务租约已失效（lease_epoch 不匹配），拒绝写入' using errcode='P0002'; end if;
 select id into v_id from public.content_ai_proposals where agent_job_id = j.id;
 if found then return v_id; end if;
 select * into d from public.content_documents
 where id::text = j.payload->'target'->>'id' and organization_id = j.organization_id and j.payload->'target'->>'type' = 'content_document';
 if not found then raise exception '任务目标稿件不存在' using errcode='P0002'; end if;
 insert into public.content_ai_proposals(organization_id, document_id, input_revision, model, prompt_version, instruction,
   input_brief, status, body, usage, created_by, finished_at, agent_job_id)
 values (j.organization_id, d.id, (p_proposal->>'input_revision')::integer, p_proposal->>'model', coalesce(p_proposal->>'prompt_version', 'draft-v1'),
   p_proposal->>'instruction', p_proposal->>'input_brief', 'succeeded', p_proposal->>'body', coalesce(p_proposal->'usage', '{}'::jsonb),
   j.created_by, now(), j.id)
 returning id into v_id;
 return v_id;
end; $$;

create function public.node_save_storyboard_proposal(p_token text, p_job_id uuid, p_lease_epoch bigint, p_proposal jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs := private.node_job(p_token, p_job_id); v_id uuid;
begin
 if j.lease_epoch is distinct from p_lease_epoch then raise exception '任务租约已失效（lease_epoch 不匹配），拒绝写入' using errcode='P0002'; end if;
 select id into v_id from public.video_storyboard_proposals where agent_job_id = j.id;
 if found then return v_id; end if;
 insert into public.video_storyboard_proposals(organization_id, agent_job_id, project_id, input_outline, proposal, model)
 values (j.organization_id, j.id, (p_proposal->>'project_id')::uuid, p_proposal->>'input_outline', p_proposal->'proposal', p_proposal->>'model')
 returning id into v_id;
 return v_id;
end; $$;

-- ── 8. Notices, limited to the node's organization ──
create function public.node_list_pending_notices(p_token text, p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.runner_nodes := private.node_from_token(p_token);
begin
 -- list_pending_notices caps each kind at p_limit; filter afterwards, so ask for the maximum.
 return (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
  select x from jsonb_array_elements(public.list_pending_notices(200)) x
  where x->>'organization_id' = n.organization_id::text
  limit greatest(least(coalesce(p_limit, 50), 200), 1)) t);
end; $$;

create function public.node_mark_notice_sent(p_token text, p_kind text, p_id uuid, p_status text) returns boolean
language plpgsql security definer set search_path='' as $$
declare n public.runner_nodes := private.node_from_token(p_token);
begin
 if not exists (select 1 from public.agent_jobs where p_kind = 'job' and id = p_id and organization_id = n.organization_id)
  and not exists (select 1 from public.approval_requests where p_kind <> 'job' and id = p_id and organization_id = n.organization_id) then
  return false;
 end if;
 return public.mark_notice_sent(p_kind, p_id, p_status);
end; $$;

-- ── 9. Grants: node RPCs are called with the publishable key (anon); the token is the credential ──
do $grants$
declare f text;
begin
 foreach f in array array[
  'public.node_claim(text,text[],integer)', 'public.node_heartbeat(text,uuid,bigint,integer)',
  'public.node_complete(text,uuid,bigint,text,jsonb,text,text)', 'public.node_fail(text,uuid,bigint,text,boolean,integer,text)',
  'public.node_record_step(text,uuid,bigint,text,text,jsonb,jsonb,text)', 'public.node_list_steps(text,uuid)',
  'public.node_draft_context(text,uuid)', 'public.node_storyboard_knowledge(text,uuid)',
  'public.node_save_proposal(text,uuid,bigint,jsonb)', 'public.node_save_storyboard_proposal(text,uuid,bigint,jsonb)',
  'public.node_list_pending_notices(text,integer)', 'public.node_mark_notice_sent(text,text,uuid,text)'] loop
  execute format('revoke all on function %s from public', f);
  execute format('grant execute on function %s to anon, authenticated, service_role', f);
 end loop;
end $grants$;
