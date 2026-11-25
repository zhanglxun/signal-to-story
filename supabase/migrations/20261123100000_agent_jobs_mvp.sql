-- DB2c-1 (docs/database.md §4.4, §6, DB-D13): agent_jobs / agent_job_steps MVP shape.
--
-- agent_jobs keeps 21 columns. What moved where:
--   job_type                    → renamed kind (same format check)
--   target_type/id/revision     → payload.target = {type, id, revision?} (CHECKed shape; immutable like before)
--   approval_request_id         → payload.approval_request_id (validated by the Mandate trigger exactly as before)
--   budget_cents/max_rounds/max_hops/token_budget → payload.limits (CHECKed ranges; resume raises them)
--   rounds/hops/cost/tokens/driver/model/started_at/finished_at → derived from agent_job_steps
--     (old job-level values of existing rows are kept in result.legacy_columns)
--   locked_by/last_heartbeat_at → lease_epoch (+1 per claim; every node write must carry it) + node_id (FK later, DB2c-2)
--   priority                    → FIFO by run_after, created_at
-- New: work_item_id (status sync to the board card; at most one running non-chat job per item),
--      notified_at on agent_jobs and approval_requests (the node's notifier replaces an outbox).
-- agent_job_steps keeps 10 columns: round/stage/digest/summary/evaluation → output, model/driver/cost/duration → usage.
-- Node writes only through security-definer RPCs; service_role loses direct INSERT/UPDATE on both tables.

-- ── 0. functions whose signature changes, or which are replaced by the notifier ──
drop function public.enqueue_agent_job(uuid,text,text,jsonb,text,text,integer,integer,integer,uuid);
drop function public.claim_agent_job(text,text[],integer);
drop function public.heartbeat_agent_job(uuid,text,integer);
drop function public.complete_agent_job(uuid,text,text,jsonb,text,text);
drop function public.fail_agent_job(uuid,text,text,boolean,integer,text);
drop function public.ask_question(uuid,jsonb);
drop function public.im_notify_target(uuid);

-- ── 1. agent_jobs: new columns, carry existing rows over ──
alter table public.agent_jobs rename column job_type to kind;
alter table public.agent_jobs rename constraint agent_jobs_job_type_check to agent_jobs_kind_check;
alter table public.agent_jobs
 add column work_item_id uuid,
 add column node_id uuid,
 add column lease_epoch bigint not null default 0,
 add column notified_at timestamptz;

alter table public.agent_jobs disable trigger user;
update public.agent_jobs j set
 payload = j.payload - 'target' - 'limits' - 'approval_request_id'
  || case when j.target_type is not null and j.target_id is not null
      then jsonb_build_object('target', jsonb_strip_nulls(jsonb_build_object('type', j.target_type, 'id', j.target_id, 'revision', j.target_revision)))
      else '{}'::jsonb end
  || case when j.approval_request_id is not null then jsonb_build_object('approval_request_id', j.approval_request_id) else '{}'::jsonb end
  || jsonb_build_object('limits', jsonb_strip_nulls(jsonb_build_object('max_rounds', j.max_rounds, 'max_hops', j.max_hops,
       'budget_cents', j.budget_cents, 'token_budget', j.token_budget))),
 result = case when j.rounds > 0 or j.cost_cents > 0 or j.tokens_used > 0 or j.started_at is not null or j.model is not null
  then coalesce(j.result, '{}'::jsonb) || jsonb_build_object('legacy_columns', jsonb_strip_nulls(jsonb_build_object(
   'rounds', j.rounds, 'hops_used', j.hops_used, 'cost_cents', j.cost_cents, 'tokens_used', j.tokens_used, 'driver', j.driver,
   'model', j.model, 'priority', j.priority, 'locked_by', j.locked_by, 'started_at', j.started_at, 'finished_at', j.finished_at)))
  else j.result end,
 work_item_id = case when j.target_type = 'content_document' then
   (select d.work_item_id from public.content_documents d where d.id::text = j.target_id and d.organization_id = j.organization_id) end,
 notified_at = case when j.status in ('pending_review','blocked_needs_human','failed') then coalesce(j.finished_at, j.updated_at) end;
alter table public.agent_jobs enable trigger user;

alter table public.agent_jobs
 drop column priority, drop column target_type, drop column target_id, drop column target_revision,
 drop column locked_by, drop column last_heartbeat_at, drop column budget_cents, drop column cost_cents,
 drop column token_budget, drop column tokens_used, drop column hops_used, drop column max_hops,
 drop column rounds, drop column max_rounds, drop column driver, drop column model,
 drop column approval_request_id, drop column started_at, drop column finished_at;

alter table public.agent_jobs
 add constraint agent_jobs_work_item_fkey foreign key (organization_id, work_item_id) references public.work_items(organization_id, id),
 add constraint agent_jobs_lease_epoch_check check (lease_epoch >= 0),
 add constraint agent_jobs_payload_target_check check (
  not (payload ? 'target') or (
   jsonb_typeof(payload->'target') = 'object'
   and jsonb_typeof(payload->'target'->'type') = 'string' and (payload->'target'->>'type') ~ '^[a-z][a-z0-9_]{1,63}$'
   and jsonb_typeof(payload->'target'->'id') = 'string' and char_length(payload->'target'->>'id') between 1 and 128
   and (not (payload->'target' ? 'revision')
     or (jsonb_typeof(payload->'target'->'revision') = 'number' and (payload->'target'->>'revision') ~ '^[1-9][0-9]{0,8}$'))
  )),
 add constraint agent_jobs_payload_approval_check check (
  not (payload ? 'approval_request_id') or (jsonb_typeof(payload->'approval_request_id') = 'string'
   and (payload->>'approval_request_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')),
 add constraint agent_jobs_payload_limits_check check (
  jsonb_typeof(payload->'limits') = 'object'
  and case when jsonb_typeof(payload->'limits'->'max_rounds') = 'number' and (payload->'limits'->>'max_rounds') ~ '^[0-9]{1,2}$'
       then (payload->'limits'->>'max_rounds')::integer between 1 and 5 else false end
  and case when jsonb_typeof(payload->'limits'->'max_hops') = 'number' and (payload->'limits'->>'max_hops') ~ '^[0-9]{1,2}$'
       then (payload->'limits'->>'max_hops')::integer between 2 and 32 else false end
  and case when jsonb_typeof(payload->'limits'->'budget_cents') = 'number' and (payload->'limits'->>'budget_cents') ~ '^[0-9]{1,7}$'
       then (payload->'limits'->>'budget_cents')::integer between 0 and 1000000 else false end
  and case when not (payload->'limits' ? 'token_budget') then true
       else jsonb_typeof(payload->'limits'->'token_budget') = 'number' and (payload->'limits'->>'token_budget') ~ '^[1-9][0-9]{0,8}$' end
 );

create index agent_jobs_claim_idx on public.agent_jobs (kind, run_after, created_at) where status = 'queued';
create index agent_jobs_org_target_idx on public.agent_jobs (organization_id, (payload->'target'->>'type'), (payload->'target'->>'id'));
create index agent_jobs_approval_idx on public.agent_jobs ((payload->>'approval_request_id')) where payload ? 'approval_request_id';
create index agent_jobs_work_item_idx on public.agent_jobs (organization_id, work_item_id) where work_item_id is not null;
-- §6.2 / B6: one running non-chat job per board card. Several queued jobs per card are fine (one per platform).
create unique index agent_jobs_one_running_per_item on public.agent_jobs (work_item_id)
 where status = 'running' and kind <> 'chat_turn';
create index agent_jobs_notice_idx on public.agent_jobs (updated_at)
 where notified_at is null and status in ('pending_review','blocked_needs_human','failed');
comment on table public.agent_jobs is 'Agent 任务队列（DB2c-1）：目标、批准、上限在 payload；用量从 agent_job_steps 推出；节点写入都带 lease_epoch。';

-- ── 2. agent_job_steps: 10 columns ──
alter table public.agent_job_steps add column seq integer, add column kind text;
update public.agent_job_steps s set
 seq = o.rn,
 kind = case s.step_kind when 'precheck' then 'check' when 'evaluate' then 'check' else s.step_kind end,
 output = case when s.output is null then '{}'::jsonb when jsonb_typeof(s.output) = 'object' then s.output else jsonb_build_object('value', s.output) end
  || jsonb_strip_nulls(jsonb_build_object('round', s.round,
    'stage', case when s.step_kind in ('precheck','evaluate') then s.step_kind end,
    'input_digest', s.input_digest, 'input_summary', s.input_summary, 'evaluation', s.evaluation)),
 usage = (coalesce(s.usage, '{}'::jsonb) - 'inputTokens' - 'outputTokens' - 'costCents')
  || jsonb_strip_nulls(jsonb_build_object(
    'input_tokens', coalesce(s.usage->'input_tokens', s.usage->'inputTokens'),
    'output_tokens', coalesce(s.usage->'output_tokens', s.usage->'outputTokens'),
    'cost_cents', s.cost_cents, 'model', s.model, 'driver', s.driver, 'duration_ms', s.duration_ms))
from (select id, row_number() over (partition by job_id order by created_at, round,
   array_position(array['fetch','context','generate','precheck','evaluate','persist'], step_kind), id) as rn from public.agent_job_steps) o
where o.id = s.id;

alter table public.agent_job_steps
 drop column round, drop column step_kind, drop column driver, drop column model, drop column input_digest,
 drop column input_summary, drop column evaluation, drop column cost_cents, drop column duration_ms;
update public.agent_job_steps set usage = '{}'::jsonb where usage is null;
alter table public.agent_job_steps
 alter column seq set not null,
 alter column kind set not null,
 alter column output set default '{}'::jsonb, alter column output set not null,
 alter column usage set default '{}'::jsonb, alter column usage set not null,
 drop constraint if exists agent_job_steps_usage_check,
 add constraint agent_job_steps_seq_check check (seq >= 1),
 add constraint agent_job_steps_kind_check check (kind in ('context','fetch','generate','check','persist')),
 add constraint agent_job_steps_output_check check (jsonb_typeof(output) = 'object'
  and (kind <> 'check' or output->>'stage' in ('precheck','evaluate'))),
 add constraint agent_job_steps_usage_check check (jsonb_typeof(usage) = 'object'),
 add constraint agent_job_steps_job_seq_key unique (job_id, seq);
comment on table public.agent_job_steps is '任务的每一步一行，只追加：output 含 round / stage / 评估 / 输入摘要，usage 含 tokens / 费用 / 模型 / 驱动 / 耗时。';

create function private.agent_job_steps_append_only() returns trigger language plpgsql set search_path='' as $$
begin
 raise exception '任务步骤只追加，不可修改' using errcode='check_violation';
end; $$;
revoke all on function private.agent_job_steps_append_only() from public, anon, authenticated;
create trigger agent_job_steps_append_only before update on public.agent_job_steps
 for each row execute function private.agent_job_steps_append_only();

-- ── 3. approval_requests.notified_at ──
alter table public.approval_requests add column notified_at timestamptz;
update public.approval_requests set notified_at = created_at;  -- existing rows: no retroactive notices
create index approval_requests_notice_idx on public.approval_requests (created_at) where notified_at is null and status = 'pending';

-- ── 4. guard: identity, input and target immutable; only limits may be raised (resume) ──
create or replace function private.guard_agent_job() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op = 'INSERT' then
  if new.status <> 'queued' then raise exception '新任务必须为 queued' using errcode='check_violation'; end if;
  if jsonb_typeof(new.payload) = 'object' and (new.payload->'limits' is null or jsonb_typeof(new.payload->'limits') = 'object') then
   new.payload := new.payload || jsonb_build_object('limits',
    '{"max_rounds":3,"max_hops":8,"budget_cents":100}'::jsonb || coalesce(new.payload->'limits', '{}'::jsonb));
  end if;
  new.attempts := 0; new.lease_epoch := 0; new.node_id := null; new.locked_until := null;
  new.result := null; new.error := null; new.notified_at := null;
  new.created_at := now(); new.updated_at := now();
  return new;
 end if;
 if new.organization_id is distinct from old.organization_id or new.kind is distinct from old.kind
  or new.idempotency_key is distinct from old.idempotency_key or new.created_by is distinct from old.created_by
  or new.created_at is distinct from old.created_at or new.work_item_id is distinct from old.work_item_id
  or (new.payload - 'limits') is distinct from (old.payload - 'limits') then
  raise exception '任务身份、输入与目标不可修改' using errcode='check_violation';
 end if;
 if new.lease_epoch < old.lease_epoch then raise exception '租约代数不能回退' using errcode='check_violation'; end if;
 -- Notice bookkeeping only: allowed in every state and does not move the task in lists.
 if (to_jsonb(new) - 'notified_at') = (to_jsonb(old) - 'notified_at') then return new; end if;
 if not private.agent_job_transition_allowed(old.status, new.status) then
  raise exception '非法任务状态迁移: % -> %', old.status, new.status using errcode='check_violation';
 end if;
 -- A new state needs a new notice, unless the same statement records one (ask_question).
 if new.status <> old.status and new.notified_at is not distinct from old.notified_at then new.notified_at := null; end if;
 if new.status <> 'running' then new.node_id := null; new.locked_until := null; end if;
 new.updated_at := now();
 return new;
end; $$;

-- ── 5. Mandate on the queue, now reading payload.target / payload.approval_request_id ──
create or replace function private.enforce_job_mandate() returns trigger language plpgsql security definer set search_path='' as $$
declare
 mandate_action text := private.job_type_mandate_action(new.kind);
 v_target_type text := new.payload->'target'->>'type';
 v_target_id text := new.payload->'target'->>'id';
 v_target_rev integer := case when (new.payload->'target'->>'revision') ~ '^[0-9]{1,9}$' then (new.payload->'target'->>'revision')::integer end;
 v_approval uuid := case when (new.payload->>'approval_request_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  then (new.payload->>'approval_request_id')::uuid end;
 v_plan public.video_plans; v_est jsonb; v_approved numeric; v_used numeric;
begin
 if private.is_video_render_job(new.kind) and new.status in ('queued','running','succeeded')
  and (tg_op = 'INSERT' or new.status is distinct from old.status) then
  select * into v_plan from public.video_plans where id::text = v_target_id and organization_id = new.organization_id;
  if v_target_type is distinct from 'video_plan' or not found then
   raise exception '视频任务必须指向本组织的分镜计划' using errcode='check_violation';
  end if;
  if tg_op = 'INSERT' then
   if auth.uid() is not null and not private.has_organization_permission(new.organization_id, 'content.manage') then
    raise exception '没有视频创作权限' using errcode='42501';
   end if;
   if v_target_rev is distinct from v_plan.revision then
    raise exception '分镜计划版本已变化，请刷新后重试' using errcode='check_violation';
   end if;
   if new.kind <> 'video_compose' and not exists (
    select 1 from public.video_shots s where s.plan_id = v_plan.id and s.id::text = new.payload->>'shot_id'
   ) then raise exception '镜头不存在或不属于该计划' using errcode='check_violation'; end if;
  elsif new.status = 'running' and v_target_rev is distinct from v_plan.revision then
   -- Content changed while queued: never render outdated content (paid or free).
   new.status := 'failed'; new.node_id := null; new.locked_until := null;
   new.error := '分镜已修改（版本变化），任务作废，请重新提交'; new.error_code := 'stale_target';
   return new;
  end if;
  v_est := private.video_job_estimate(new.kind, v_plan.id, new.payload);
  if tg_op = 'INSERT' then
   new.payload := new.payload || jsonb_build_object('server_estimate', v_est);
  end if;
  if not (v_est->>'requires_approval')::boolean then
   return new;  -- free / below threshold: no approval needed
  end if;
  mandate_action := 'paid_video_render';
  if tg_op = 'INSERT' and v_approval is not null then
   select estimated_cost_cents into v_approved from public.approval_requests where id = v_approval;
   -- attempts = 0: never claimed (the old started_at is null)
   select coalesce(sum(coalesce((j.payload->'server_estimate'->>'cost_cents')::numeric, 0)), 0) into v_used
   from public.agent_jobs j where j.payload->>'approval_request_id' = v_approval::text and not (j.status = 'cancelled' and j.attempts = 0);
   if v_approved is null or v_used + (v_est->>'cost_cents')::numeric > v_approved then
    raise exception '超出已批准金额（已用 %，本次 %，批准 %），请重新申请批准', v_used, v_est->>'cost_cents', coalesce(v_approved, 0) using errcode='42501';
   end if;
  end if;
 end if;

 if mandate_action is null or new.status not in ('queued','running','succeeded') then return new; end if;
 -- approval and target are immutable (guard), so a same-status update is a heartbeat on a validated job
 if tg_op = 'UPDATE' and new.status = old.status then return new; end if;
 if v_approval is null or v_target_type is null or v_target_id is null
  or not private.approval_is_valid(v_approval, new.organization_id, mandate_action, v_target_type, v_target_id) then
  if tg_op = 'INSERT' or new.status = 'succeeded' then
   raise exception '任务 [%] 需要针对同一对象与版本的有效人工批准 (Mandate)', new.kind using errcode='42501';
  end if;
  -- Approval expired / revision changed while queued: park the job for a human.
  new.status := 'blocked_needs_human'; new.node_id := null; new.locked_until := null;
  new.error := '人工批准已失效（版本变化或过期），请重新批准'; new.error_code := 'mandate_invalid';
 end if;
 return new;
end; $$;

create or replace function private.sync_video_job_state() returns trigger language plpgsql security definer set search_path='' as $$
declare v_shot uuid; v_plan text := new.payload->'target'->>'id';
begin
 if not private.is_video_render_job(new.kind) or new.status = old.status
  or new.status not in ('failed','cancelled','blocked_needs_human') then return null; end if;
 if new.kind = 'video_shot_render' then
  begin v_shot := nullif(new.payload->>'shot_id','')::uuid; exception when others then return null; end;
  update public.video_shots set render_status = 'failed', error = coalesce(new.error, '任务未完成')
  where id = v_shot and render_status in ('queued','rendering');
 elsif new.kind = 'video_compose' then
  update public.video_plans set status = 'failed', error = coalesce(new.error, '合成未完成') where id::text = v_plan and status = 'rendering';
  update public.video_shots set render_status = 'failed', error = coalesce(new.error, '合成未完成')
  where plan_id::text = v_plan and render_status = 'rendering';
 end if;
 return null;
end; $$;

-- ── 6. Board sync: job state drives the card column, except done / dropped cards and chat turns ──
create function private.sync_work_item_status() returns trigger language plpgsql security definer set search_path='' as $$
declare v_status text;
begin
 if new.work_item_id is null or new.kind = 'chat_turn' or (tg_op = 'UPDATE' and new.status is not distinct from old.status) then
  return null;
 end if;
 v_status := case new.status when 'queued' then 'doing' when 'running' then 'doing'
  when 'blocked_needs_human' then 'waiting' when 'failed' then 'waiting' when 'pending_review' then 'review' end;
 if v_status is null then return null; end if;  -- succeeded / cancelled leave the card as the human set it
 update public.work_items set status = v_status
 where id = new.work_item_id and organization_id = new.organization_id
  and status not in ('done','dropped') and status <> v_status;
 return null;
end; $$;
revoke all on function private.sync_work_item_status() from public, anon, authenticated;
create trigger agent_job_work_item_sync after insert or update on public.agent_jobs
 for each row execute function private.sync_work_item_status();

-- ── 7. Human RPCs ──
-- Parameter names are unchanged (p_job_type …) so callers deployed before this migration keep working.
create function public.enqueue_agent_job(
 p_organization_id uuid, p_job_type text, p_idempotency_key text,
 p_payload jsonb default '{}'::jsonb,
 p_target_type text default null, p_target_id text default null, p_target_revision integer default null,
 p_budget_cents integer default null, p_max_rounds integer default null,
 p_approval_request_id uuid default null, p_work_item_id uuid default null
) returns public.agent_jobs language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs; v_payload jsonb; v_item uuid := p_work_item_id; v_doc_item uuid;
begin
 if auth.uid() is null or not private.has_organization_permission(p_organization_id,'agent.dispatch') then
  raise exception '没有调度 Agent 任务的权限' using errcode='42501';
 end if;
 if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then raise exception '任务输入必须是 JSON 对象' using errcode='check_violation'; end if;
 if p_job_type = 'content_draft' then
  if not private.has_organization_permission(p_organization_id,'content.manage') then
   raise exception '没有创作权限' using errcode='42501';
  end if;
  if p_target_type is distinct from 'content_document' or not exists (
   select 1 from public.content_documents d
   where d.id::text = p_target_id and d.organization_id = p_organization_id and d.revision = p_target_revision
  ) then raise exception '稿件不存在、不属于该组织或版本已变化' using errcode='check_violation'; end if;
 end if;
 -- B7: work_item_id says which card the job belongs to; a document target must belong to the same card.
 if p_target_type = 'content_document' then
  select d.work_item_id into v_doc_item from public.content_documents d where d.id::text = p_target_id and d.organization_id = p_organization_id;
  if v_item is not null and v_doc_item is not null and v_item <> v_doc_item then
   raise exception '任务的事项与稿件所属事项不一致' using errcode='check_violation';
  end if;
  v_item := coalesce(v_item, v_doc_item);
 end if;
 if v_item is not null and not exists (select 1 from public.work_items w where w.id = v_item and w.organization_id = p_organization_id) then
  raise exception '事项不存在或不属于该组织' using errcode='check_violation';
 end if;
 select * into j from public.agent_jobs where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
 if found then
  if j.kind <> p_job_type then raise exception '幂等键已被其他类型任务使用' using errcode='unique_violation'; end if;
  return j;
 end if;
 v_payload := (coalesce(p_payload, '{}'::jsonb) - 'target' - 'limits' - 'approval_request_id')
  || case when p_target_type is not null or p_target_id is not null
      then jsonb_build_object('target', jsonb_strip_nulls(jsonb_build_object('type', p_target_type, 'id', p_target_id, 'revision', p_target_revision)))
      else '{}'::jsonb end
  || case when p_approval_request_id is not null then jsonb_build_object('approval_request_id', p_approval_request_id) else '{}'::jsonb end
  || jsonb_build_object('limits', jsonb_build_object('max_rounds', coalesce(p_max_rounds, 3), 'max_hops', 8, 'budget_cents', coalesce(p_budget_cents, 100)));
 begin
  insert into public.agent_jobs(organization_id, work_item_id, kind, idempotency_key, payload, created_by)
  values (p_organization_id, v_item, p_job_type, p_idempotency_key, v_payload, auth.uid())
  returning * into j;
 exception when unique_violation then
  -- Concurrent retry with the same key: return the winner.
  select * into j from public.agent_jobs where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if not found or j.kind <> p_job_type then raise; end if;
  return j;
 end;
 insert into public.audit_events(organization_id, actor_user_id, action, target_type, target_id, metadata)
 values (p_organization_id, auth.uid(), 'agent_job.enqueued', 'agent_job', j.id::text, jsonb_build_object('job_type', p_job_type, 'work_item_id', v_item));
 return j;
end; $$;
revoke all on function public.enqueue_agent_job(uuid,text,text,jsonb,text,text,integer,integer,integer,uuid,uuid) from public, anon;
grant execute on function public.enqueue_agent_job(uuid,text,text,jsonb,text,text,integer,integer,integer,uuid,uuid) to authenticated;

create or replace function public.resume_agent_job(p_job_id uuid, p_extra_rounds integer default 1, p_extra_budget_cents integer default 0)
returns public.agent_jobs language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs; l jsonb;
begin
 select * into j from public.agent_jobs where id = p_job_id for update;
 if not found or auth.uid() is null or not private.has_organization_permission(j.organization_id,'agent.dispatch') then
  raise exception '任务不存在或没有权限' using errcode='42501';
 end if;
 if j.status <> 'blocked_needs_human' then raise exception '只有等待人工处理的任务可以继续' using errcode='check_violation'; end if;
 if p_extra_rounds not between 0 and 2 or p_extra_budget_cents not between 0 and 10000 then
  raise exception '追加轮次或预算超出范围' using errcode='check_violation';
 end if;
 l := j.payload->'limits';
 update public.agent_jobs set status = 'queued', run_after = now(), error = null, error_code = null,
  payload = jsonb_set(payload, '{limits}', l || jsonb_build_object(
   'max_rounds', least((l->>'max_rounds')::integer + p_extra_rounds, 5),
   'max_hops', least((l->>'max_hops')::integer + 2 * p_extra_rounds, 32),
   'budget_cents', least((l->>'budget_cents')::integer + p_extra_budget_cents, 1000000))),
  max_attempts = least(j.attempts + 1, 10)
 where id = j.id returning * into j;
 insert into public.audit_events(organization_id, actor_user_id, action, target_type, target_id, metadata)
 values (j.organization_id, auth.uid(), 'agent_job.resumed', 'agent_job', j.id::text,
  jsonb_build_object('extra_rounds', p_extra_rounds, 'extra_budget_cents', p_extra_budget_cents));
 return j;
end; $$;

-- ── 8. Node RPCs (service_role only). Every write after claim carries the lease_epoch claim returned. ──
create function public.claim_agent_job(p_job_types text[], p_lease_seconds integer default 120)
returns setof public.agent_jobs language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs; cand uuid; tried uuid[] := '{}';
begin
 if p_lease_seconds is null or p_lease_seconds not between 15 and 3600 then raise exception 'lease_seconds 需在 15–3600 之间'; end if;
 -- Expired leases: node crashed or lost connectivity. Retry only while attempts remain.
 update public.agent_jobs set
  status = case when cancel_requested_at is not null then 'cancelled' when attempts >= max_attempts then 'failed' else 'queued' end,
  error = case when cancel_requested_at is not null then '人工取消' when attempts >= max_attempts then '执行租约过期且已无剩余重试次数' else '执行租约过期，已重新排队' end,
  error_code = 'lease_expired'
 where status = 'running' and locked_until < now();

 -- Mandate may park a candidate, and a card may already have a running job; try the next one.
 for i in 1..20 loop
  select q.id into cand from public.agent_jobs q
  where q.status = 'queued' and q.kind = any(p_job_types) and q.run_after <= now() and not (q.id = any(tried))
   and (q.work_item_id is null or q.kind = 'chat_turn' or not exists (
    select 1 from public.agent_jobs r where r.work_item_id = q.work_item_id and r.status = 'running' and r.kind <> 'chat_turn'))
  order by q.run_after, q.created_at
  for update skip locked
  limit 1;
  if not found then return; end if;
  tried := tried || cand;
  begin
   update public.agent_jobs set status = 'running', lease_epoch = lease_epoch + 1,
    locked_until = now() + make_interval(secs => p_lease_seconds), attempts = attempts + 1
   where id = cand returning * into j;
  exception when unique_violation then
   continue;  -- another node started a job on the same card concurrently
  end;
  if j.status = 'running' then
   return next j;
   return;
  end if;
 end loop;
end; $$;

create function public.heartbeat_agent_job(p_job_id uuid, p_lease_epoch bigint, p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs;
begin
 update public.agent_jobs set locked_until = now() + make_interval(secs => greatest(least(coalesce(p_lease_seconds, 120), 3600), 15))
 where id = p_job_id and status = 'running' and lease_epoch = p_lease_epoch
 returning * into j;
 if not found then return jsonb_build_object('ok', false, 'cancel_requested', false); end if;
 return jsonb_build_object('ok', true, 'cancel_requested', j.cancel_requested_at is not null);
end; $$;

create function public.complete_agent_job(
 p_job_id uuid, p_lease_epoch bigint, p_status text, p_result jsonb default null, p_error text default null, p_error_code text default null
) returns public.agent_jobs language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs;
begin
 if p_status not in ('pending_review','blocked_needs_human','succeeded','failed','cancelled') then
  raise exception '无效的完成状态 %', p_status using errcode='check_violation';
 end if;
 update public.agent_jobs set status = p_status, result = coalesce(p_result, result), error = p_error, error_code = p_error_code
 where id = p_job_id and status = 'running' and lease_epoch = p_lease_epoch
 returning * into j;
 if not found then raise exception '任务租约已失效（lease_epoch 不匹配），拒绝写入' using errcode='P0002'; end if;
 return j;
end; $$;

-- Failure: retryable only for non-billable failures (request never reached the provider, 429, DB hiccup).
create function public.fail_agent_job(
 p_job_id uuid, p_lease_epoch bigint, p_error text, p_retryable boolean default false, p_retry_delay_seconds integer default 30, p_error_code text default null
) returns public.agent_jobs language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs;
begin
 select * into j from public.agent_jobs where id = p_job_id and status = 'running' and lease_epoch = p_lease_epoch for update;
 if not found then raise exception '任务租约已失效（lease_epoch 不匹配），拒绝写入' using errcode='P0002'; end if;
 if p_retryable and j.attempts < j.max_attempts and j.cancel_requested_at is null then
  update public.agent_jobs set status = 'queued', error = p_error, error_code = p_error_code,
   run_after = now() + make_interval(secs => greatest(least(p_retry_delay_seconds, 3600), 0))
  where id = j.id returning * into j;
 else
  update public.agent_jobs set status = 'failed', error = p_error, error_code = p_error_code where id = j.id returning * into j;
 end if;
 return j;
end; $$;

-- Steps are appended only through here: seq is assigned under the job row lock, stale leases are refused.
create function public.record_agent_job_step(
 p_job_id uuid, p_lease_epoch bigint, p_kind text, p_status text default 'succeeded',
 p_output jsonb default '{}'::jsonb, p_usage jsonb default '{}'::jsonb, p_error text default null
) returns public.agent_job_steps language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs; s public.agent_job_steps;
begin
 select * into j from public.agent_jobs where id = p_job_id for update;
 if not found or j.status <> 'running' or j.lease_epoch is distinct from p_lease_epoch then
  raise exception '任务租约已失效（lease_epoch 不匹配），拒绝写入步骤' using errcode='P0002';
 end if;
 insert into public.agent_job_steps(organization_id, job_id, seq, kind, status, output, usage, error)
 values (j.organization_id, j.id, coalesce((select max(seq) from public.agent_job_steps where job_id = j.id), 0) + 1,
  p_kind, coalesce(p_status, 'succeeded'), coalesce(p_output, '{}'::jsonb), coalesce(p_usage, '{}'::jsonb), p_error)
 returning * into s;
 return s;
end; $$;

-- Agent question: the node asks on behalf of the job it holds and parks it; the question row carries the notice.
create function public.ask_question(p_job_id uuid, p_question jsonb, p_lease_epoch bigint)
returns public.approval_requests language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs; a public.approval_requests;
begin
 if coalesce(auth.role(), '') <> 'service_role' then raise exception '只有执行节点可以提问' using errcode='42501'; end if;
 if jsonb_typeof(p_question) is distinct from 'object' or coalesce(char_length(btrim(p_question->>'title')),0) not between 1 and 500
  or (p_question ? 'options' and jsonb_typeof(p_question->'options') <> 'array') then
  raise exception '问题格式无效' using errcode='check_violation';
 end if;
 select * into j from public.agent_jobs where id = p_job_id for update;
 if not found or j.status <> 'running' then raise exception '只有运行中的任务可以提问' using errcode='check_violation'; end if;
 if j.lease_epoch is distinct from p_lease_epoch then raise exception '任务租约已失效（lease_epoch 不匹配），拒绝提问' using errcode='P0002'; end if;
 select * into a from public.approval_requests where requested_by_job = j.id and kind = 'question' and status = 'pending';
 if found then return a; end if;
 insert into public.approval_requests(organization_id, kind, target_type, target_id, target_revision, question, summary, requested_by_job)
 values (j.organization_id, 'question', j.payload->'target'->>'type', j.payload->'target'->>'id',
  case when (j.payload->'target'->>'revision') ~ '^[0-9]{1,9}$' then (j.payload->'target'->>'revision')::integer end,
  p_question, left(p_question->>'title', 2000), j.id)
 returning * into a;
 update public.agent_jobs set status = 'blocked_needs_human', error = '等待人工回答', error_code = 'needs_answer', notified_at = now() where id = j.id;
 return a;
end; $$;

revoke all on function public.claim_agent_job(text[],integer) from public, anon, authenticated;
revoke all on function public.heartbeat_agent_job(uuid,bigint,integer) from public, anon, authenticated;
revoke all on function public.complete_agent_job(uuid,bigint,text,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.fail_agent_job(uuid,bigint,text,boolean,integer,text) from public, anon, authenticated;
revoke all on function public.record_agent_job_step(uuid,bigint,text,text,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.ask_question(uuid,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.claim_agent_job(text[],integer) to service_role;
grant execute on function public.heartbeat_agent_job(uuid,bigint,integer) to service_role;
grant execute on function public.complete_agent_job(uuid,bigint,text,jsonb,text,text) to service_role;
grant execute on function public.fail_agent_job(uuid,bigint,text,boolean,integer,text) to service_role;
grant execute on function public.record_agent_job_step(uuid,bigint,text,text,jsonb,jsonb,text) to service_role;
grant execute on function public.ask_question(uuid,jsonb,bigint) to service_role;

-- Nodes write jobs and steps only through the RPCs above.
revoke insert, update on public.agent_jobs from service_role;
revoke insert on public.agent_job_steps from service_role;

-- ── 9. Video: storyboard adoption reads LLM usage from steps instead of job columns ──
create or replace function public.accept_video_storyboard_proposal(p_proposal_id uuid, p_title text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare pr public.video_storyboard_proposals; v_plan uuid; v_shot jsonb; v_pos integer := 0; v_job public.agent_jobs;
 v_doc jsonb; v_cost numeric; v_driver text; v_model text;
begin
 select * into pr from public.video_storyboard_proposals where id = p_proposal_id for update;
 if not found or auth.uid() is null or not private.has_organization_permission(pr.organization_id, 'content.manage') then
  raise exception '提案不存在或没有权限' using errcode='42501';
 end if;
 if pr.status <> 'pending' then raise exception '提案已处理（%）', pr.status using errcode='check_violation'; end if;
 v_doc := pr.proposal;
 if jsonb_array_length(v_doc->'shots') not between 1 and 60 then raise exception '提案镜头数量无效' using errcode='check_violation'; end if;
 insert into public.video_plans(organization_id, project_id, title, aspect_ratio, target_seconds, style, default_voice, created_by, source_proposal_id)
 values (pr.organization_id, pr.project_id, left(coalesce(nullif(btrim(p_title), ''), v_doc->>'title'), 160),
  coalesce(v_doc->>'aspect_ratio', '9:16'), coalesce((v_doc->>'target_seconds')::integer, 30), left(coalesce(v_doc->>'style', ''), 1000),
  coalesce(v_doc->>'default_voice', 'zh-CN-XiaoxiaoNeural'), auth.uid(), pr.id)
 returning id into v_plan;
 for v_shot in select * from jsonb_array_elements(v_doc->'shots') loop
  v_pos := v_pos + 1;
  insert into public.video_shots(organization_id, plan_id, position, shot_size, camera_motion, motion_mode, visual_prompt, narration, voice,
   sfx_description, target_duration_ms, created_by)
  values (pr.organization_id, v_plan, v_pos, coalesce(v_shot->>'shot_size', 'medium'), coalesce(v_shot->>'camera_motion', 'zoom_in'),
   coalesce(v_shot->>'motion_mode', 'local_ken_burns'), coalesce(v_shot->>'visual_prompt', ''), coalesce(v_shot->>'narration', ''),
   nullif(v_shot->>'voice', ''), coalesce(v_shot->>'sfx_description', ''), coalesce((v_shot->>'target_duration_ms')::integer, 4000), auth.uid());
 end loop;
 update public.video_storyboard_proposals set status = 'accepted', accepted_plan_id = v_plan, decided_by = auth.uid(), decided_at = now() where id = pr.id;
 select * into v_job from public.agent_jobs where id = pr.agent_job_id for update;
 if v_job.status = 'pending_review' then
  update public.agent_jobs set status = 'succeeded', result = coalesce(result, '{}'::jsonb) || jsonb_build_object('accepted_plan_id', v_plan) where id = v_job.id;
 end if;
 select coalesce(sum(case when (s.usage->>'cost_cents') ~ '^[0-9]+(\.[0-9]+)?$' then (s.usage->>'cost_cents')::numeric else 0 end), 0)
 into v_cost from public.agent_job_steps s where s.job_id = v_job.id;
 select s.usage->>'driver', s.usage->>'model' into v_driver, v_model from public.agent_job_steps s
 where s.job_id = v_job.id and s.kind = 'generate' order by s.seq desc limit 1;
 if v_cost > 0 then
  insert into public.video_cost_entries(organization_id, plan_id, agent_job_id, kind, provider, estimated_cents, actual_cents, metadata)
  values (pr.organization_id, v_plan, v_job.id, 'storyboard_llm', coalesce(v_driver, 'llm'), v_cost, v_cost, jsonb_build_object('model', v_model));
 end if;
 insert into public.audit_events(organization_id, actor_user_id, action, target_type, target_id, metadata)
 values (pr.organization_id, auth.uid(), 'video_storyboard.accepted', 'video_plan', v_plan::text, jsonb_build_object('proposal_id', pr.id, 'shots', v_pos));
 return v_plan;
end; $$;

-- ── 10. Notifier (R4, replaces outbox and im_notify_target): the node polls, sends, then marks ──
-- Reply address: the job's own IM input, else the card's earliest IM input; revoked / expired connections give none.
create function private.notice_reply_to(p_organization_id uuid, p_work_item_id uuid, p_intake_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('channel', e.payload->'reply_to'->>'channel', 'target', e.payload->'reply_to'->>'target', 'connection_id', c.id)
 from public.intake_events e
 join public.intake_connections c on c.id = e.connection_id and c.organization_id = e.organization_id
 where e.organization_id = p_organization_id and e.source = 'im' and jsonb_typeof(e.payload->'reply_to') = 'object'
  and c.revoked_at is null and c.expires_at > now()
  and (e.id = p_intake_event_id or (p_work_item_id is not null and e.work_item_id = p_work_item_id))
 order by (e.id is not distinct from p_intake_event_id) desc, e.created_at
 limit 1
$$;
revoke all on function private.notice_reply_to(uuid,uuid,uuid) from public, anon, authenticated;

create function public.list_pending_notices(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_limit integer := greatest(least(coalesce(p_limit, 50), 200), 1); v_jobs jsonb; v_requests jsonb;
 uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
 select coalesce(jsonb_agg(x.n order by x.at), '[]'::jsonb) into v_jobs from (
  select j.updated_at as at, jsonb_build_object(
   'kind', 'job', 'id', j.id, 'organization_id', j.organization_id, 'status', j.status,
   'error_code', j.error_code, 'error', left(j.error, 500), 'job_kind', j.kind, 'job_id', j.id,
   'work_item_id', j.work_item_id, 'document_id', d.id, 'platform', d.platform, 'title', coalesce(d.title, w.title),
   'rounds', (select coalesce(max((s.output->>'round')::integer), 0) from public.agent_job_steps s
              where s.job_id = j.id and s.kind = 'generate' and (s.output->>'round') ~ '^[0-9]{1,4}$'),
   'max_rounds', (j.payload->'limits'->>'max_rounds')::integer,
   'reply_to', private.notice_reply_to(j.organization_id, j.work_item_id,
     case when (j.payload->>'intake_event_id') ~ uuid_re then (j.payload->>'intake_event_id')::uuid end)) as n
  from public.agent_jobs j
  left join public.content_documents d on j.payload->'target'->>'type' = 'content_document'
   and d.id::text = j.payload->'target'->>'id' and d.organization_id = j.organization_id
  left join public.work_items w on w.id = j.work_item_id
  where j.notified_at is null and j.status in ('pending_review','blocked_needs_human','failed')
  order by j.updated_at limit v_limit
 ) x;
 select coalesce(jsonb_agg(x.n order by x.at), '[]'::jsonb) into v_requests from (
  select a.created_at as at, jsonb_build_object(
   'kind', a.kind, 'id', a.id, 'organization_id', a.organization_id, 'status', a.status, 'action', a.action,
   'summary', left(a.summary, 500), 'job_id', a.requested_by_job, 'work_item_id', coalesce(j.work_item_id, d.work_item_id),
   'document_id', d.id, 'platform', d.platform, 'title', coalesce(d.title, w.title, left(a.summary, 200)),
   'reply_to', private.notice_reply_to(a.organization_id, coalesce(j.work_item_id, d.work_item_id),
     case when (j.payload->>'intake_event_id') ~ uuid_re then (j.payload->>'intake_event_id')::uuid end)) as n
  from public.approval_requests a
  left join public.agent_jobs j on j.id = a.requested_by_job
  left join public.content_documents d on a.target_type = 'content_document' and d.id::text = a.target_id and d.organization_id = a.organization_id
  left join public.work_items w on w.id = coalesce(j.work_item_id, d.work_item_id)
  where a.notified_at is null and a.status = 'pending' and a.expires_at > now()
  order by a.created_at limit v_limit
 ) x;
 return v_jobs || v_requests;
end; $$;

-- Mark only if the row is still in the state that was announced; a failed send is simply not marked.
create function public.mark_notice_sent(p_kind text, p_id uuid, p_status text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_kind = 'job' then
  update public.agent_jobs set notified_at = now() where id = p_id and status = p_status and notified_at is null;
 elsif p_kind in ('approval','question') then
  update public.approval_requests set notified_at = now() where id = p_id and kind = p_kind and status = p_status and notified_at is null;
 else
  raise exception '未知通知类型 %', p_kind using errcode='check_violation';
 end if;
 return found;
end; $$;
revoke all on function public.list_pending_notices(integer) from public, anon, authenticated;
revoke all on function public.mark_notice_sent(text,uuid,text) from public, anon, authenticated;
grant execute on function public.list_pending_notices(integer) to service_role;
grant execute on function public.mark_notice_sent(text,uuid,text) to service_role;
