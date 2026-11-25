-- DB5 (0.5): video studio trimmed to the MVP (docs/database.md §4.6, R5, R6).
--   * video_plans hang off a work item (project_id → work_item_id); source_proposal_id is gone.
--   * The AI writes a draft plan + shots directly (node_write_video_draft); humans edit them in place.
--     Paid rendering still needs an approval bound to the plan revision (unchanged).
--   * No cost ledger: video_cost_entries, video_plan_cost_summary and the per-shot cost columns are dropped.
--     Estimates are computed on the fly (private.video_job_estimate); the paid-render approval keeps its
--     estimate in payload.estimated_cost_cents (approval_requests.estimated_cost_cents is dropped).
--   * video_storyboard_proposals and the accept/reject RPCs are retired. Knowledge for storyboards comes from
--     the repo's knowledge-base/ files read by the worker (node_storyboard_knowledge is dropped).
-- All video tables are empty live.

-- ── 1. Retire proposals, ledger and summary ──
drop function if exists public.accept_video_storyboard_proposal(uuid, text);
drop function if exists public.reject_video_storyboard_proposal(uuid, text);
drop function if exists public.node_save_storyboard_proposal(text, uuid, bigint, jsonb);
drop function if exists public.node_storyboard_knowledge(text, uuid);
drop view if exists public.video_plan_cost_summary;
drop trigger if exists video_cost_entry_apply on public.video_cost_entries;
drop function if exists private.apply_video_cost_entry();
drop table if exists public.video_cost_entries;
alter table public.video_plans drop constraint if exists video_plans_source_proposal_fkey;
drop table if exists public.video_storyboard_proposals;
drop function if exists private.guard_video_proposal();
drop trigger if exists video_plan_reprice on public.video_plans;
drop function if exists private.reprice_video_shots();

-- ── 2. video_plans: work item instead of project; source document without the revision history table ──
drop index if exists public.video_plans_project_idx;
drop index if exists public.video_plans_proposal_idx;
alter table public.video_plans drop constraint if exists video_plans_organization_id_project_id_fkey;
alter table public.video_plans drop constraint if exists video_plans_organization_id_source_document_id_source_docum_fkey;
do $$
declare c text;
begin
  -- the composite FK to content_revisions has a generated name; drop it by definition
  for c in select conname from pg_constraint where conrelid = 'public.video_plans'::regclass and contype = 'f'
           and pg_get_constraintdef(oid) like '%content_revisions%' loop
    execute format('alter table public.video_plans drop constraint %I', c);
  end loop;
end $$;
alter table public.video_plans drop column project_id, drop column source_proposal_id;
alter table public.video_plans add column work_item_id uuid,
  add constraint video_plans_work_item_fkey foreign key (organization_id, work_item_id) references public.work_items(organization_id, id) on delete set null (work_item_id),
  add constraint video_plans_source_document_fkey foreign key (organization_id, source_document_id) references public.content_documents(organization_id, id) on delete set null (source_document_id);
create index video_plans_work_item_idx on public.video_plans (organization_id, work_item_id);

-- ── 3. video_shots: no cost columns ──
alter table public.video_shots drop column estimated_cost_cents, drop column actual_cost_cents;

create or replace function private.guard_video_plan() returns trigger language plpgsql security definer set search_path='' as $$
declare content_changed boolean;
begin
 if tg_op = 'INSERT' then
  new.revision := 1; new.status := 'draft'; new.composed_video_asset_id := null; new.final_duration_ms := null; new.error := null;
  new.created_at := now(); new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.created_by);
  if new.work_item_id is not null and not exists (select 1 from public.work_items w where w.id = new.work_item_id and w.organization_id = new.organization_id) then
   raise exception '事项不存在或不属于该组织' using errcode='check_violation';
  end if;
  return new;
 end if;
 if new.organization_id is distinct from old.organization_id or new.created_by is distinct from old.created_by
  or new.created_at is distinct from old.created_at then
  raise exception '分镜计划的归属不可修改' using errcode='check_violation';
 end if;
 if not private.video_asset_in_org(new.composed_video_asset_id, new.organization_id) then
  raise exception '成片资产不属于该组织' using errcode='check_violation';
 end if;
 content_changed := (new.title, new.aspect_ratio, new.target_seconds, new.style, new.default_voice, new.tts_provider, new.bgm_track,
   new.work_item_id, new.source_document_id, new.source_document_revision)
  is distinct from (old.title, old.aspect_ratio, old.target_seconds, old.style, old.default_voice, old.tts_provider, old.bgm_track,
   old.work_item_id, old.source_document_id, old.source_document_revision);
 if content_changed then
  if old.status = 'rendering' or private.video_plan_locked(old.id) then
   raise exception '渲染进行中，分镜已锁定' using errcode='check_violation';
  end if;
  new.revision := old.revision + 1;
  if new.status in ('rendered','failed') then new.status := 'draft'; end if;
 end if;
 if new.revision < old.revision then raise exception 'revision 只能递增' using errcode='check_violation'; end if;
 new.updated_at := now();
 if auth.uid() is not null then new.updated_by := auth.uid(); end if;
 return new;
end; $$;

create or replace function private.guard_video_shot() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.video_plans; visual_changed boolean := false; audio_changed boolean := false;
begin
 if tg_op = 'DELETE' then
  if private.video_plan_locked(old.plan_id) then raise exception '渲染进行中，分镜已锁定' using errcode='check_violation'; end if;
  return old;
 end if;
 select * into p from public.video_plans where id = new.plan_id;
 if tg_op = 'INSERT' then
  if p.organization_id is distinct from new.organization_id then raise exception '镜头与计划不属于同一组织' using errcode='check_violation'; end if;
  if private.video_plan_locked(new.plan_id) then raise exception '渲染进行中，分镜已锁定' using errcode='check_violation'; end if;
  new.render_status := 'pending'; new.audio_asset_id := null; new.video_asset_id := null; new.actual_duration_ms := null;
  new.error := null; new.created_at := now();
 else
  if new.organization_id is distinct from old.organization_id or new.plan_id is distinct from old.plan_id
   or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
   raise exception '镜头归属不可修改' using errcode='check_violation';
  end if;
  visual_changed := (new.position, new.shot_size, new.camera_motion, new.motion_mode, new.visual_prompt, new.sfx_description,
    new.target_duration_ms, new.keyframe_asset_id)
   is distinct from (old.position, old.shot_size, old.camera_motion, old.motion_mode, old.visual_prompt, old.sfx_description,
    old.target_duration_ms, old.keyframe_asset_id);
  audio_changed := (new.narration, new.voice) is distinct from (old.narration, old.voice);
  if visual_changed or audio_changed then
   if private.video_plan_locked(old.plan_id) then raise exception '渲染进行中，分镜已锁定' using errcode='check_violation'; end if;
   -- position-only changes (reorder) do not invalidate rendered media
   if audio_changed then new.audio_asset_id := null; new.actual_duration_ms := null; end if;
   if audio_changed or (new.shot_size, new.camera_motion, new.motion_mode, new.visual_prompt, new.target_duration_ms, new.keyframe_asset_id)
     is distinct from (old.shot_size, old.camera_motion, old.motion_mode, old.visual_prompt, old.target_duration_ms, old.keyframe_asset_id) then
    if old.render_status in ('queued','rendered','failed') then new.render_status := 'pending'; end if;
    new.video_asset_id := null; new.error := null;
   end if;
  elsif not private.video_shot_transition_allowed(old.render_status, new.render_status) then
   raise exception '非法镜头渲染状态迁移: % -> %', old.render_status, new.render_status using errcode='check_violation';
  end if;
 end if;
 if not (private.video_asset_in_org(new.keyframe_asset_id, new.organization_id) and private.video_asset_in_org(new.audio_asset_id, new.organization_id)
   and private.video_asset_in_org(new.video_asset_id, new.organization_id)) then
  raise exception '资产不属于该组织' using errcode='check_violation';
 end if;
 new.updated_at := now();
 return new;
end; $$;

revoke all on public.video_plans from authenticated;
grant select, delete on public.video_plans to authenticated;
grant insert (organization_id, work_item_id, source_document_id, source_document_revision, title, aspect_ratio, target_seconds, style, default_voice, tts_provider, bgm_track, created_by)
 on public.video_plans to authenticated;
grant update (work_item_id, source_document_id, source_document_revision, title, aspect_ratio, target_seconds, style, default_voice, tts_provider, bgm_track)
 on public.video_plans to authenticated;

-- ── 4. Approval estimate lives in payload ──
update public.approval_requests set payload = payload || jsonb_build_object('estimated_cost_cents', estimated_cost_cents)
 where estimated_cost_cents is not null;

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
   select case when (payload->>'estimated_cost_cents') ~ '^[0-9]+(\.[0-9]+)?$' then (payload->>'estimated_cost_cents')::numeric end
   into v_approved from public.approval_requests where id = v_approval;
   -- attempts = 0: never claimed
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

-- The estimate argument stays for call compatibility and is stored in payload.estimated_cost_cents.
create or replace function public.create_approval_request(p_organization_id uuid, p_action text, p_target_type text, p_target_id text,
 p_target_revision integer default null, p_summary text default '', p_payload jsonb default '{}'::jsonb,
 p_estimated_cost_cents integer default null, p_requested_by_job uuid default null)
returns public.approval_requests language plpgsql security definer set search_path='' as $$
declare a public.approval_requests; current_rev integer; v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
 if auth.uid() is not null then
  if not private.has_organization_permission(p_organization_id,'content.manage') then
   raise exception '没有发起批准请求的权限' using errcode='42501';
  end if;
 elsif coalesce(auth.role(), '') <> 'service_role' then  -- PostgREST sets role from the service_role JWT
  raise exception '需要登录' using errcode='42501';
 elsif p_requested_by_job is null or not exists (
  select 1 from public.agent_jobs j where j.id = p_requested_by_job and j.organization_id = p_organization_id
 ) then
  raise exception 'Agent 发起的批准请求必须关联本组织任务' using errcode='check_violation';
 end if;
 if p_estimated_cost_cents is not null then
  if p_estimated_cost_cents < 0 then raise exception '预估费用不能为负' using errcode='check_violation'; end if;
  v_payload := v_payload || jsonb_build_object('estimated_cost_cents', p_estimated_cost_cents);
 end if;
 current_rev := private.current_target_revision(p_target_type, p_target_id);
 if p_target_type = 'content_document' and (current_rev is null or current_rev is distinct from p_target_revision) then
  raise exception '目标不存在或版本已变化' using errcode='check_violation';
 end if;
 select * into a from public.approval_requests
 where organization_id = p_organization_id and action = p_action and target_type = p_target_type and target_id = p_target_id
  and coalesce(target_revision,0) = coalesce(p_target_revision,0) and status = 'pending';
 if found then return a; end if;
 insert into public.approval_requests(organization_id, action, target_type, target_id, target_revision, summary, payload,
  requested_by_job, requested_by)
 values (p_organization_id, p_action, p_target_type, p_target_id, p_target_revision, coalesce(p_summary,''), v_payload,
  p_requested_by_job, auth.uid())
 returning * into a;
 return a;
end; $$;

alter table public.approval_requests drop column estimated_cost_cents;

-- ── 5. Storyboard job targets a work item ──
drop function if exists public.enqueue_video_storyboard_job(uuid, text, jsonb, uuid, text);
create function public.enqueue_video_storyboard_job(p_organization_id uuid, p_outline text, p_options jsonb default '{}'::jsonb,
 p_work_item_id uuid default null, p_idempotency_key text default null)
returns public.agent_jobs language plpgsql security definer set search_path='' as $$
declare v_key text; v_opts jsonb := coalesce(p_options, '{}'::jsonb);
begin
 if auth.uid() is null or not private.has_organization_permission(p_organization_id, 'content.manage') then
  raise exception '没有视频创作权限' using errcode='42501';
 end if;
 if char_length(btrim(coalesce(p_outline, ''))) not between 10 and 20000 then
  raise exception '大纲需要 10–20000 字' using errcode='check_violation';
 end if;
 if jsonb_typeof(v_opts) <> 'object' then raise exception '选项格式无效' using errcode='check_violation'; end if;
 v_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'video_storyboard:' || encode(extensions.digest(btrim(p_outline) || v_opts::text || coalesce(p_work_item_id::text, ''), 'sha256'), 'hex'));
 return public.enqueue_agent_job(p_organization_id, 'video_storyboard', left(v_key, 200),
  jsonb_build_object('schema_version', 1, 'outline', btrim(p_outline),
   'aspect_ratio', coalesce(v_opts->>'aspect_ratio', '9:16'), 'target_seconds', coalesce((v_opts->>'target_seconds')::integer, 30),
   'style', coalesce(v_opts->>'style', ''), 'default_voice', coalesce(v_opts->>'default_voice', 'zh-CN-XiaoxiaoNeural')),
  null, null, null, coalesce((v_opts->>'budget_cents')::integer, 100), 3, null, p_work_item_id);
end; $$;
revoke all on function public.enqueue_video_storyboard_job(uuid, text, jsonb, uuid, text) from public, anon, service_role;
grant execute on function public.enqueue_video_storyboard_job(uuid, text, jsonb, uuid, text) to authenticated;

-- ── 6. The AI writes a draft plan directly (idempotent per job: result.plan_id) ──
-- Core (service_role, used by the SQL backend in tests/demos); node_write_video_draft wraps it with the node token check.
create function public.write_video_draft(p_job_id uuid, p_lease_epoch bigint, p_draft jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs; v_plan uuid; v_shot jsonb; v_pos integer := 0;
begin
 select * into j from public.agent_jobs where id = p_job_id for update;
 if not found or j.status <> 'running' then raise exception '任务不存在或未在运行' using errcode='P0002'; end if;
 if j.lease_epoch is distinct from p_lease_epoch then raise exception '任务租约已失效（lease_epoch 不匹配），拒绝写入' using errcode='P0002'; end if;
 if j.kind <> 'video_storyboard' then raise exception '只有分镜任务可以写入分镜草稿' using errcode='42501'; end if;
 if (j.result->>'plan_id') is not null then return (j.result->>'plan_id')::uuid; end if;
 if p_draft is null or jsonb_typeof(p_draft) <> 'object' or jsonb_typeof(p_draft->'shots') <> 'array'
    or jsonb_array_length(p_draft->'shots') not between 1 and 60 or pg_column_size(p_draft) > 262144 then
  raise exception '分镜草稿格式无效（需要 1–60 个镜头）' using errcode='check_violation';
 end if;
 if j.created_by is null or not exists (
  select 1 from public.organization_members m
  join public.organization_roles r on r.organization_id = m.organization_id and r.role_key = m.role
  where m.organization_id = j.organization_id and m.user_id = j.created_by and 'content.manage' = any(r.permissions)
 ) then
  raise exception '任务发起人已无视频创作权限，拒绝写入' using errcode='42501';
 end if;
 insert into public.video_plans(organization_id, work_item_id, title, aspect_ratio, target_seconds, style, default_voice, created_by)
 values (j.organization_id, j.work_item_id,
  left(coalesce(nullif(btrim(p_draft->>'title'), ''), '未命名分镜'), 160),
  coalesce(nullif(p_draft->>'aspect_ratio', ''), j.payload->>'aspect_ratio', '9:16'),
  coalesce((p_draft->>'target_seconds')::integer, (j.payload->>'target_seconds')::integer, 30),
  left(coalesce(p_draft->>'style', j.payload->>'style', ''), 1000),
  coalesce(nullif(p_draft->>'default_voice', ''), j.payload->>'default_voice', 'zh-CN-XiaoxiaoNeural'), j.created_by)
 returning id into v_plan;
 for v_shot in select * from jsonb_array_elements(p_draft->'shots') loop
  v_pos := v_pos + 1;
  insert into public.video_shots(organization_id, plan_id, position, shot_size, camera_motion, motion_mode, visual_prompt, narration, voice,
   sfx_description, target_duration_ms, created_by)
  values (j.organization_id, v_plan, v_pos, coalesce(v_shot->>'shot_size', 'medium'), coalesce(v_shot->>'camera_motion', 'zoom_in'),
   coalesce(v_shot->>'motion_mode', 'local_ken_burns'), left(coalesce(v_shot->>'visual_prompt', ''), 2000), left(coalesce(v_shot->>'narration', ''), 1000),
   nullif(v_shot->>'voice', ''), left(coalesce(v_shot->>'sfx_description', ''), 500), coalesce((v_shot->>'target_duration_ms')::integer, 4000), j.created_by);
 end loop;
 update public.agent_jobs set result = coalesce(result, '{}'::jsonb) || jsonb_build_object('plan_id', v_plan, 'shots', v_pos) where id = j.id;
 insert into public.audit_events(organization_id, actor_user_id, action, target_type, target_id, metadata)
 values (j.organization_id, null, 'video_storyboard.drafted', 'video_plan', v_plan::text,
  jsonb_build_object('agent_job_id', j.id, 'shots', v_pos, 'model', p_draft->>'model'));
 return v_plan;
end; $$;
revoke all on function public.write_video_draft(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.write_video_draft(uuid, bigint, jsonb) to service_role;

create function public.node_write_video_draft(p_token text, p_job_id uuid, p_lease_epoch bigint, p_draft jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform private.node_job(p_token, p_job_id);
 return public.write_video_draft(p_job_id, p_lease_epoch, p_draft);
end; $$;
revoke all on function public.node_write_video_draft(text, uuid, bigint, jsonb) from public;
grant execute on function public.node_write_video_draft(text, uuid, bigint, jsonb) to anon, authenticated, service_role;
