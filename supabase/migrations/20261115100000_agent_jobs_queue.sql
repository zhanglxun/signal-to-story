-- P1.5 Agent Harness kernel: durable job queue + per-step audit log.
-- Browser: read via RLS (content.view), enqueue/cancel/resume via RPC (agent.dispatch).
-- Worker: service_role only; claim with FOR UPDATE SKIP LOCKED, lease + heartbeat.

-- Approving paid / irreversible agent actions is a separate capability from authoring.
update public.organization_roles
set permissions = array(select distinct unnest(permissions || array['agent.approve']))
where role_key in ('owner','admin');

create table public.agent_jobs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 job_type text not null check (job_type ~ '^[a-z][a-z0-9_]{1,63}$'),
 status text not null default 'queued'
  check (status in ('queued','running','pending_review','blocked_needs_human','succeeded','failed','cancelled')),
 priority smallint not null default 100 check (priority between 0 and 1000),
 target_type text check (target_type is null or target_type ~ '^[a-z][a-z0-9_]{1,63}$'),
 target_id text check (target_id is null or char_length(target_id) between 1 and 128),
 target_revision integer check (target_revision is null or target_revision >= 1),
 payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object' and pg_column_size(payload) <= 262144),
 result jsonb check (result is null or jsonb_typeof(result)='object'),
 idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
 attempts integer not null default 0 check (attempts >= 0),
 max_attempts integer not null default 2 check (max_attempts between 1 and 10),
 run_after timestamptz not null default now(),
 locked_by text check (locked_by is null or char_length(locked_by) between 1 and 128),
 locked_until timestamptz,
 last_heartbeat_at timestamptz,
 cancel_requested_at timestamptz,
 budget_cents integer not null default 100 check (budget_cents between 0 and 1000000),
 cost_cents numeric(14,4) not null default 0 check (cost_cents >= 0),
 token_budget integer check (token_budget is null or token_budget > 0),
 tokens_used bigint not null default 0 check (tokens_used >= 0),
 hops_used integer not null default 0 check (hops_used >= 0),
 max_hops integer not null default 8 check (max_hops between 2 and 32),
 rounds integer not null default 0 check (rounds >= 0),
 max_rounds integer not null default 3 check (max_rounds between 1 and 5),
 driver text check (driver is null or char_length(driver) <= 64),
 model text check (model is null or char_length(model) <= 128),
 approval_request_id uuid,
 error text check (error is null or char_length(error) <= 4000),
 error_code text check (error_code is null or char_length(error_code) <= 64),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 started_at timestamptz,
 finished_at timestamptz,
 unique (organization_id, id),
 unique (organization_id, idempotency_key)
);
comment on table public.agent_jobs is 'Agent Harness 持久任务队列。状态机见 sense-console/docs/agent-harness.md。';

create table public.agent_job_steps (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 job_id uuid not null,
 round integer not null check (round between 0 and 10),
 step_kind text not null check (step_kind in ('context','generate','precheck','evaluate','persist')),
 status text not null default 'succeeded' check (status in ('succeeded','failed')),
 driver text check (driver is null or char_length(driver) <= 64),
 model text check (model is null or char_length(model) <= 128),
 input_digest text check (input_digest is null or char_length(input_digest) <= 128),
 input_summary jsonb check (input_summary is null or jsonb_typeof(input_summary)='object'),
 output jsonb,
 evaluation jsonb,
 usage jsonb check (usage is null or jsonb_typeof(usage)='object'),
 cost_cents numeric(14,4) not null default 0 check (cost_cents >= 0),
 duration_ms integer check (duration_ms is null or duration_ms >= 0),
 error text check (error is null or char_length(error) <= 4000),
 created_at timestamptz not null default now(),
 unique (job_id, round, step_kind),
 foreign key (organization_id, job_id) references public.agent_jobs(organization_id, id) on delete cascade
);
comment on table public.agent_job_steps is '每一步 (context/generate/precheck/evaluate/persist) 一行，不可修改；循环从最后一步恢复。';

create index agent_jobs_claim_idx on public.agent_jobs (job_type, priority, created_at) where status = 'queued';
create index agent_jobs_lease_idx on public.agent_jobs (locked_until) where status = 'running';
create index agent_jobs_org_status_idx on public.agent_jobs (organization_id, status, updated_at desc);
create index agent_jobs_org_target_idx on public.agent_jobs (organization_id, target_type, target_id);
create index agent_jobs_created_by_idx on public.agent_jobs (created_by);
create index agent_jobs_approval_idx on public.agent_jobs (approval_request_id);
create index agent_job_steps_job_idx on public.agent_job_steps (job_id, round, created_at);
create index agent_job_steps_org_idx on public.agent_job_steps (organization_id, job_id);

-- State machine. Applies to every writer, including service_role (triggers are not bypassed by BYPASSRLS).
create function private.agent_job_transition_allowed(old_status text, new_status text) returns boolean
language sql immutable set search_path='' as $$
 -- same-status updates (heartbeat, progress, priority) are allowed only while not terminal
 select old_status = new_status and old_status in ('queued','running','pending_review','blocked_needs_human')
  or (old_status, new_status) in (
   ('queued','running'),('queued','cancelled'),('queued','blocked_needs_human'),('queued','failed'),
   ('running','queued'),('running','pending_review'),('running','blocked_needs_human'),
   ('running','succeeded'),('running','failed'),('running','cancelled'),
   ('pending_review','succeeded'),('pending_review','cancelled'),('pending_review','failed'),
   ('blocked_needs_human','queued'),('blocked_needs_human','cancelled'),('blocked_needs_human','failed')
  )
$$;
revoke all on function private.agent_job_transition_allowed(text,text) from public, anon, authenticated;

-- security definer: service_role has no USAGE on schema private.
create function private.guard_agent_job() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op = 'INSERT' then
  if new.status <> 'queued' then raise exception '新任务必须为 queued' using errcode='check_violation'; end if;
  new.attempts := 0; new.rounds := 0; new.hops_used := 0; new.cost_cents := 0; new.tokens_used := 0;
  new.locked_by := null; new.locked_until := null; new.result := null; new.error := null;
  new.created_at := now(); new.updated_at := now(); new.started_at := null; new.finished_at := null;
  return new;
 end if;
 if new.organization_id is distinct from old.organization_id or new.job_type is distinct from old.job_type
  or new.idempotency_key is distinct from old.idempotency_key or new.created_by is distinct from old.created_by
  or new.created_at is distinct from old.created_at or new.payload is distinct from old.payload
  or new.target_type is distinct from old.target_type or new.target_id is distinct from old.target_id
  or new.target_revision is distinct from old.target_revision then
  raise exception '任务身份、输入与目标不可修改' using errcode='check_violation';
 end if;
 if not private.agent_job_transition_allowed(old.status, new.status) then
  raise exception '非法任务状态迁移: % -> %', old.status, new.status using errcode='check_violation';
 end if;
 if new.status in ('succeeded','failed','cancelled') and old.status not in ('succeeded','failed','cancelled') then
  new.finished_at := now(); new.locked_by := null; new.locked_until := null;
 end if;
 if new.status in ('queued','pending_review','blocked_needs_human') then
  new.locked_by := null; new.locked_until := null;
 end if;
 new.updated_at := now();
 return new;
end; $$;
revoke all on function private.guard_agent_job() from public, anon, authenticated;
create trigger agent_job_guard before insert or update on public.agent_jobs
 for each row execute function private.guard_agent_job();

alter table public.agent_jobs enable row level security;
alter table public.agent_job_steps enable row level security;
revoke all on public.agent_jobs, public.agent_job_steps from anon, authenticated, service_role;
grant select on public.agent_jobs, public.agent_job_steps to authenticated;
grant select, insert, update on public.agent_jobs to service_role;
grant select, insert on public.agent_job_steps to service_role;
create policy agent_jobs_read on public.agent_jobs for select to authenticated
 using ((select private.has_organization_permission(organization_id,'content.view')));
create policy agent_job_steps_read on public.agent_job_steps for select to authenticated
 using ((select private.has_organization_permission(organization_id,'content.view')));

-- Browser / Edge Function enqueue (runs with the caller's JWT). Idempotent per organization.
create function public.enqueue_agent_job(
 p_organization_id uuid, p_job_type text, p_idempotency_key text,
 p_payload jsonb default '{}'::jsonb,
 p_target_type text default null, p_target_id text default null, p_target_revision integer default null,
 p_budget_cents integer default null, p_max_rounds integer default null,
 p_approval_request_id uuid default null
) returns public.agent_jobs language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs;
begin
 if auth.uid() is null or not private.has_organization_permission(p_organization_id,'agent.dispatch') then
  raise exception '没有调度 Agent 任务的权限' using errcode='42501';
 end if;
 if p_job_type = 'content_draft' then
  if not private.has_organization_permission(p_organization_id,'content.manage') then
   raise exception '没有创作权限' using errcode='42501';
  end if;
  if p_target_type is distinct from 'content_document' or not exists (
   select 1 from public.content_documents d
   where d.id::text = p_target_id and d.organization_id = p_organization_id and d.revision = p_target_revision
  ) then raise exception '稿件不存在、不属于该组织或版本已变化' using errcode='check_violation'; end if;
 end if;
 select * into j from public.agent_jobs where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
 if found then
  if j.job_type <> p_job_type then raise exception '幂等键已被其他类型任务使用' using errcode='unique_violation'; end if;
  return j;
 end if;
 begin
  insert into public.agent_jobs(organization_id, job_type, idempotency_key, payload, target_type, target_id, target_revision,
   budget_cents, max_rounds, approval_request_id, created_by)
  values (p_organization_id, p_job_type, p_idempotency_key, coalesce(p_payload,'{}'::jsonb), p_target_type, p_target_id, p_target_revision,
   coalesce(p_budget_cents, 100), coalesce(p_max_rounds, 3), p_approval_request_id, auth.uid())
  returning * into j;
 exception when unique_violation then
  -- Concurrent retry with the same key: return the winner.
  select * into j from public.agent_jobs where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if not found or j.job_type <> p_job_type then raise; end if;
  return j;
 end;
 insert into public.audit_events(organization_id, actor_user_id, action, target_type, target_id, metadata)
 values (p_organization_id, auth.uid(), 'agent_job.enqueued', 'agent_job', j.id::text, jsonb_build_object('job_type', p_job_type));
 return j;
end; $$;
revoke all on function public.enqueue_agent_job(uuid,text,text,jsonb,text,text,integer,integer,integer,uuid) from public, anon;
grant execute on function public.enqueue_agent_job(uuid,text,text,jsonb,text,text,integer,integer,integer,uuid) to authenticated;

-- Human controls.
create function public.cancel_agent_job(p_job_id uuid) returns public.agent_jobs
language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs;
begin
 select * into j from public.agent_jobs where id = p_job_id for update;
 if not found or auth.uid() is null or not private.has_organization_permission(j.organization_id,'agent.dispatch') then
  raise exception '任务不存在或没有权限' using errcode='42501';
 end if;
 if j.status = 'running' then
  -- Worker observes cancel_requested_at on its next heartbeat and stops cooperatively.
  update public.agent_jobs set cancel_requested_at = now() where id = j.id returning * into j;
 elsif j.status in ('queued','pending_review','blocked_needs_human') then
  update public.agent_jobs set status = 'cancelled', cancel_requested_at = now(), error = '人工取消' where id = j.id returning * into j;
 end if;
 return j;
end; $$;
revoke all on function public.cancel_agent_job(uuid) from public, anon;
grant execute on function public.cancel_agent_job(uuid) to authenticated;

create function public.resume_agent_job(p_job_id uuid, p_extra_rounds integer default 1, p_extra_budget_cents integer default 0)
returns public.agent_jobs language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs;
begin
 select * into j from public.agent_jobs where id = p_job_id for update;
 if not found or auth.uid() is null or not private.has_organization_permission(j.organization_id,'agent.dispatch') then
  raise exception '任务不存在或没有权限' using errcode='42501';
 end if;
 if j.status <> 'blocked_needs_human' then raise exception '只有等待人工处理的任务可以继续' using errcode='check_violation'; end if;
 if p_extra_rounds not between 0 and 2 or p_extra_budget_cents not between 0 and 10000 then
  raise exception '追加轮次或预算超出范围' using errcode='check_violation';
 end if;
 update public.agent_jobs set status = 'queued', run_after = now(), error = null, error_code = null,
  max_rounds = least(j.max_rounds + p_extra_rounds, 5), max_hops = least(j.max_hops + 2 * p_extra_rounds, 32),
  budget_cents = j.budget_cents + p_extra_budget_cents, max_attempts = least(j.attempts + 1, 10)
 where id = j.id returning * into j;
 insert into public.audit_events(organization_id, actor_user_id, action, target_type, target_id, metadata)
 values (j.organization_id, auth.uid(), 'agent_job.resumed', 'agent_job', j.id::text,
  jsonb_build_object('extra_rounds', p_extra_rounds, 'extra_budget_cents', p_extra_budget_cents));
 return j;
end; $$;
revoke all on function public.resume_agent_job(uuid,integer,integer) from public, anon;
grant execute on function public.resume_agent_job(uuid,integer,integer) to authenticated;

-- Worker RPCs (service_role only). Lease recovery happens inside claim so no cron is required.
create function public.claim_agent_job(p_worker_id text, p_job_types text[], p_lease_seconds integer default 120)
returns setof public.agent_jobs language plpgsql security invoker set search_path='' as $$
declare j public.agent_jobs;
begin
 if p_worker_id is null or char_length(p_worker_id) not between 1 and 128 then raise exception 'worker_id 无效'; end if;
 if p_lease_seconds not between 15 and 3600 then raise exception 'lease_seconds 需在 15–3600 之间'; end if;
 -- Expired leases: worker crashed or lost connectivity. Retry only while attempts remain.
 update public.agent_jobs set
  status = case when cancel_requested_at is not null then 'cancelled' when attempts >= max_attempts then 'failed' else 'queued' end,
  error = case when cancel_requested_at is not null then '人工取消' when attempts >= max_attempts then '执行租约过期且已无剩余重试次数' else '执行租约过期，已重新排队' end,
  error_code = 'lease_expired'
 where status = 'running' and locked_until < now();

 -- Later triggers (e.g. Mandate) may park a candidate instead of running it; try the next one.
 for i in 1..20 loop
  select * into j from public.agent_jobs
  where status = 'queued' and job_type = any(p_job_types) and run_after <= now()
  order by priority, created_at
  for update skip locked
  limit 1;
  if not found then return; end if;

  update public.agent_jobs set status = 'running', locked_by = p_worker_id,
   locked_until = now() + make_interval(secs => p_lease_seconds), last_heartbeat_at = now(),
   attempts = attempts + 1, started_at = coalesce(started_at, now())
  where id = j.id returning * into j;
  if j.status = 'running' then
   return next j;
   return;
  end if;
 end loop;
end; $$;

create function public.heartbeat_agent_job(p_job_id uuid, p_worker_id text, p_lease_seconds integer default 120)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.agent_jobs;
begin
 update public.agent_jobs set locked_until = now() + make_interval(secs => greatest(least(p_lease_seconds,3600),15)), last_heartbeat_at = now()
 where id = p_job_id and status = 'running' and locked_by = p_worker_id
 returning * into j;
 if not found then return jsonb_build_object('ok', false, 'cancel_requested', false); end if;
 return jsonb_build_object('ok', true, 'cancel_requested', j.cancel_requested_at is not null);
end; $$;

create function public.complete_agent_job(
 p_job_id uuid, p_worker_id text, p_status text, p_result jsonb default null, p_error text default null, p_error_code text default null
) returns public.agent_jobs language plpgsql security invoker set search_path='' as $$
declare j public.agent_jobs;
begin
 if p_status not in ('pending_review','blocked_needs_human','succeeded','failed','cancelled') then
  raise exception '无效的完成状态 %', p_status using errcode='check_violation';
 end if;
 update public.agent_jobs set status = p_status, result = coalesce(p_result, result), error = p_error, error_code = p_error_code
 where id = p_job_id and status = 'running' and locked_by = p_worker_id
 returning * into j;
 if not found then raise exception '任务租约已失效或不属于该 worker' using errcode='P0002'; end if;
 return j;
end; $$;

-- Failure: retryable only for non-billable failures (request never reached the provider, 429, DB hiccup).
create function public.fail_agent_job(
 p_job_id uuid, p_worker_id text, p_error text, p_retryable boolean default false, p_retry_delay_seconds integer default 30, p_error_code text default null
) returns public.agent_jobs language plpgsql security invoker set search_path='' as $$
declare j public.agent_jobs;
begin
 select * into j from public.agent_jobs where id = p_job_id and status = 'running' and locked_by = p_worker_id for update;
 if not found then raise exception '任务租约已失效或不属于该 worker' using errcode='P0002'; end if;
 if p_retryable and j.attempts < j.max_attempts and j.cancel_requested_at is null then
  update public.agent_jobs set status = 'queued', error = p_error, error_code = p_error_code,
   run_after = now() + make_interval(secs => greatest(least(p_retry_delay_seconds, 3600), 0))
  where id = j.id returning * into j;
 else
  update public.agent_jobs set status = 'failed', error = p_error, error_code = p_error_code where id = j.id returning * into j;
 end if;
 return j;
end; $$;

revoke all on function public.claim_agent_job(text,text[],integer) from public, anon, authenticated;
revoke all on function public.heartbeat_agent_job(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.complete_agent_job(uuid,text,text,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.fail_agent_job(uuid,text,text,boolean,integer,text) from public, anon, authenticated;
grant execute on function public.claim_agent_job(text,text[],integer) to service_role;
grant execute on function public.heartbeat_agent_job(uuid,text,integer) to service_role;
grant execute on function public.complete_agent_job(uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.fail_agent_job(uuid,text,text,boolean,integer,text) to service_role;

-- Proposals written by the harness reference their job for traceability.
alter table public.content_ai_proposals add column agent_job_id uuid;
alter table public.content_ai_proposals add constraint content_ai_proposals_agent_job_fkey
 foreign key (organization_id, agent_job_id) references public.agent_jobs(organization_id, id);
create unique index content_ai_proposals_one_per_job on public.content_ai_proposals (agent_job_id) where agent_job_id is not null;
