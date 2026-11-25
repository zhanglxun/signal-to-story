-- P5 Video Studio: render jobs on agent_jobs + database-level Mandate for paid rendering.
--
-- Job types (all target video_plan / plan id / plan revision):
--   video_storyboard   LLM outline → storyboard proposal (not gated; LLM budget via budget_cents)
--   video_tts_preview  one shot narration → voiceover asset
--   video_shot_render  one shot → clip (local_ken_burns or cloud_video_model)
--   video_compose      whole plan → final video (renders/TTS whatever is still missing)
--
-- Approval rule (computed server-side from the CURRENT shots, never from the client payload):
--   a video job needs an approved 'paid_video_render' request bound to (video_plan, id, revision)
--   iff it would call a cloud video model OR its estimated cost > 10 cents (private.video_cost_rate('free_threshold')).
--   => Ken Burns preview + edge_tts preview are free and run without approval; cloud TTS for a single line
--      (≤ 500 chars = 10 cents) is free; any cloud shot render, or a compose that still has to render a cloud shot, is gated.
--   Total server estimate of all jobs referencing one approval may not exceed approval.estimated_cost_cents.
--   The deciding human needs 'agent.approve' (private.approval_required_permission('paid_video_render')).
--   Any plan revision bump expires pending/approved requests on older revisions.
--   A queued video job whose plan revision changed is failed at claim time (error_code stale_target).
--
-- Adjusts two P1.5 functions with CREATE OR REPLACE (bodies otherwise identical):
--   private.current_target_revision  + 'video_plan'
--   private.enforce_job_mandate      + cost-aware gating for video_* job types

create or replace function private.current_target_revision(p_target_type text, p_target_id text) returns integer
language plpgsql stable security definer set search_path='' as $$
declare r integer;
begin
 if p_target_type = 'content_document' then
  select d.revision into r from public.content_documents d where d.id::text = p_target_id;
  return r;
 elsif p_target_type = 'content_publication' then
  select d.revision into r from public.content_publications p join public.content_documents d on d.id = p.document_id where p.id::text = p_target_id;
  return r;
 elsif p_target_type = 'video_plan' then
  select v.revision into r from public.video_plans v where v.id::text = p_target_id;
  return r;
 end if;
 return null;
end; $$;

create function private.is_video_render_job(p_job_type text) returns boolean language sql immutable set search_path='' as $$
 select p_job_type in ('video_tts_preview','video_shot_render','video_compose')
$$;
revoke all on function private.is_video_render_job(text) from public, anon, authenticated;

-- Server-side estimate of what a job would spend given the current shots.
create function private.video_job_estimate(p_job_type text, p_plan_id uuid, p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.video_plans; s public.video_shots; v_cost numeric := 0; v_cloud boolean := false; v_shot uuid;
begin
 select * into p from public.video_plans where id = p_plan_id;
 if not found then return jsonb_build_object('cost_cents', 0, 'uses_cloud_video', false); end if;
 if p_job_type in ('video_tts_preview','video_shot_render') then
  begin v_shot := nullif(p_payload->>'shot_id','')::uuid; exception when others then v_shot := null; end;
  select * into s from public.video_shots where id = v_shot and plan_id = p_plan_id;
  if not found then return jsonb_build_object('cost_cents', 0, 'uses_cloud_video', false); end if;
  if p_job_type = 'video_tts_preview' then
   v_cost := private.video_shot_cost_cents(s.motion_mode, s.target_duration_ms, s.actual_duration_ms, s.narration, p.tts_provider, true, false);
  else
   v_cost := private.video_shot_cost_cents(s.motion_mode, s.target_duration_ms, s.actual_duration_ms, s.narration, p.tts_provider, s.audio_asset_id is null, true);
   v_cloud := s.motion_mode = 'cloud_video_model';
  end if;
 elsif p_job_type = 'video_compose' then
  for s in select * from public.video_shots where plan_id = p_plan_id loop
   v_cost := v_cost + private.video_shot_cost_cents(s.motion_mode, s.target_duration_ms, s.actual_duration_ms, s.narration, p.tts_provider,
    s.audio_asset_id is null, s.video_asset_id is null or s.render_status <> 'rendered');
   if s.motion_mode = 'cloud_video_model' and (s.video_asset_id is null or s.render_status <> 'rendered') then v_cloud := true; end if;
  end loop;
 end if;
 return jsonb_build_object('cost_cents', v_cost, 'uses_cloud_video', v_cloud,
  'requires_approval', v_cloud or v_cost > private.video_cost_rate('free_threshold'));
end; $$;
revoke all on function private.video_job_estimate(text,uuid,jsonb) from public, anon, authenticated;

create or replace function private.enforce_job_mandate() returns trigger language plpgsql security definer set search_path='' as $$
declare
 mandate_action text := private.job_type_mandate_action(new.job_type);
 v_plan public.video_plans; v_est jsonb; v_approved numeric; v_used numeric;
begin
 if private.is_video_render_job(new.job_type) and new.status in ('queued','running','succeeded')
  and (tg_op = 'INSERT' or new.status is distinct from old.status or new.approval_request_id is distinct from old.approval_request_id) then
  select * into v_plan from public.video_plans where id::text = new.target_id and organization_id = new.organization_id;
  if new.target_type is distinct from 'video_plan' or not found then
   raise exception '视频任务必须指向本组织的分镜计划' using errcode='check_violation';
  end if;
  if tg_op = 'INSERT' then
   if auth.uid() is not null and not private.has_organization_permission(new.organization_id, 'content.manage') then
    raise exception '没有视频创作权限' using errcode='42501';
   end if;
   if new.target_revision is distinct from v_plan.revision then
    raise exception '分镜计划版本已变化，请刷新后重试' using errcode='check_violation';
   end if;
   if new.job_type <> 'video_compose' and not exists (
    select 1 from public.video_shots s where s.plan_id = v_plan.id and s.id::text = new.payload->>'shot_id'
   ) then raise exception '镜头不存在或不属于该计划' using errcode='check_violation'; end if;
  elsif new.status = 'running' and new.target_revision is distinct from v_plan.revision then
   -- Content changed while queued: never render outdated content (paid or free).
   new.status := 'failed'; new.locked_by := null; new.locked_until := null; new.finished_at := now();
   new.error := '分镜已修改（版本变化），任务作废，请重新提交'; new.error_code := 'stale_target';
   return new;
  end if;
  v_est := private.video_job_estimate(new.job_type, v_plan.id, new.payload);
  if tg_op = 'INSERT' then
   new.payload := new.payload || jsonb_build_object('server_estimate', v_est);
  end if;
  if not (v_est->>'requires_approval')::boolean then
   return new;  -- free / below threshold: no approval needed
  end if;
  mandate_action := 'paid_video_render';
  if tg_op = 'INSERT' and new.approval_request_id is not null then
   select estimated_cost_cents into v_approved from public.approval_requests where id = new.approval_request_id;
   select coalesce(sum(coalesce((j.payload->'server_estimate'->>'cost_cents')::numeric, 0)), 0) into v_used
   from public.agent_jobs j where j.approval_request_id = new.approval_request_id and not (j.status = 'cancelled' and j.started_at is null);
   if v_approved is null or v_used + (v_est->>'cost_cents')::numeric > v_approved then
    raise exception '超出已批准金额（已用 %，本次 %，批准 %），请重新申请批准', v_used, v_est->>'cost_cents', coalesce(v_approved, 0) using errcode='42501';
   end if;
  end if;
 end if;

 -- Original P1.5 behaviour.
 if mandate_action is null or new.status not in ('queued','running','succeeded') then return new; end if;
 if tg_op = 'UPDATE' and new.status = old.status and new.approval_request_id is not distinct from old.approval_request_id then
  return new;
 end if;
 if new.approval_request_id is null or new.target_type is null or new.target_id is null
  or not private.approval_is_valid(new.approval_request_id, new.organization_id, mandate_action, new.target_type, new.target_id) then
  if tg_op = 'INSERT' or new.status = 'succeeded' then
   raise exception '任务 [%] 需要针对同一对象与版本的有效人工批准 (Mandate)', new.job_type using errcode='42501';
  end if;
  new.status := 'blocked_needs_human'; new.locked_by := null; new.locked_until := null;
  new.error := '人工批准已失效（版本变化或过期），请重新批准'; new.error_code := 'mandate_invalid';
 end if;
 return new;
end; $$;

-- Plan revision bump => older video_plan approvals expire.
create function private.expire_stale_video_plan_approvals() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.revision <> old.revision then
  update public.approval_requests set status = 'expired'
  where organization_id = new.organization_id and kind = 'approval' and status in ('pending','approved')
   and target_type = 'video_plan' and target_id = new.id::text and coalesce(target_revision, 0) < new.revision;
 end if;
 return null;
end; $$;
revoke all on function private.expire_stale_video_plan_approvals() from public, anon, authenticated;
create trigger video_plan_expire_approvals after update on public.video_plans
 for each row execute function private.expire_stale_video_plan_approvals();

-- Keep shot / plan render state consistent when a job ends without the worker writing it
-- (human cancel, lease expiry, mandate parking, stale_target).
create function private.sync_video_job_state() returns trigger language plpgsql security definer set search_path='' as $$
declare v_shot uuid;
begin
 if not private.is_video_render_job(new.job_type) or new.status = old.status
  or new.status not in ('failed','cancelled','blocked_needs_human') then return null; end if;
 if new.job_type = 'video_shot_render' then
  begin v_shot := nullif(new.payload->>'shot_id','')::uuid; exception when others then return null; end;
  update public.video_shots set render_status = 'failed', error = coalesce(new.error, '任务未完成')
  where id = v_shot and render_status in ('queued','rendering');
 elsif new.job_type = 'video_compose' then
  update public.video_plans set status = 'failed', error = coalesce(new.error, '合成未完成') where id::text = new.target_id and status = 'rendering';
  update public.video_shots set render_status = 'failed', error = coalesce(new.error, '合成未完成')
  where plan_id::text = new.target_id and render_status = 'rendering';
 end if;
 return null;
end; $$;
revoke all on function private.sync_video_job_state() from public, anon, authenticated;
create trigger agent_job_video_state_sync after update on public.agent_jobs
 for each row execute function private.sync_video_job_state();

-- ---------------------------------------------------------------- RPCs (authenticated humans)

create function public.estimate_video_job(p_plan_id uuid, p_job_type text, p_shot_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.video_plans;
begin
 select * into p from public.video_plans where id = p_plan_id;
 if not found or not private.has_organization_permission(p.organization_id, 'content.view') then
  raise exception '分镜计划不存在或没有权限' using errcode='42501';
 end if;
 if not private.is_video_render_job(p_job_type) then raise exception '未知视频任务类型' using errcode='check_violation'; end if;
 return private.video_job_estimate(p_job_type, p_plan_id, jsonb_build_object('shot_id', p_shot_id)) || jsonb_build_object('plan_revision', p.revision);
end; $$;
revoke all on function public.estimate_video_job(uuid,text,uuid) from public, anon;
grant execute on function public.estimate_video_job(uuid,text,uuid) to authenticated;

-- One pending request per plan revision (P1.5 rule). It covers every cloud shot still to render,
-- the explicitly re-rolled shots, and cloud TTS that is still missing.
create function public.request_video_render_approval(p_plan_id uuid, p_rerender_shot_ids uuid[] default '{}', p_note text default '')
returns public.approval_requests language plpgsql security definer set search_path='' as $$
declare p public.video_plans; s public.video_shots; v_cost numeric := 0; v_cloud integer := 0; v_ids uuid[] := '{}';
 v_render boolean;
begin
 select * into p from public.video_plans where id = p_plan_id;
 if not found or auth.uid() is null or not private.has_organization_permission(p.organization_id, 'content.manage') then
  raise exception '分镜计划不存在或没有权限' using errcode='42501';
 end if;
 for s in select * from public.video_shots where plan_id = p.id order by position loop
  v_render := s.motion_mode = 'cloud_video_model'
   and (s.video_asset_id is null or s.render_status <> 'rendered' or s.id = any(coalesce(p_rerender_shot_ids, '{}')));
  if v_render then v_cloud := v_cloud + 1; v_ids := v_ids || s.id; end if;
  v_cost := v_cost + private.video_shot_cost_cents(s.motion_mode, s.target_duration_ms, s.actual_duration_ms, s.narration, p.tts_provider,
   s.audio_asset_id is null, v_render);
 end loop;
 if v_cloud = 0 and v_cost <= private.video_cost_rate('free_threshold') then
  raise exception '当前分镜不含付费渲染（估算 % 分），无需批准', v_cost using errcode='check_violation';
 end if;
 return public.create_approval_request(p.organization_id, 'paid_video_render', 'video_plan', p.id::text, p.revision,
  format('视频「%s」第 %s 版付费渲染：%s 个云端镜头，预计 %s 分', p.title, p.revision, v_cloud, v_cost),
  jsonb_build_object('schema_version', 1, 'plan_id', p.id, 'plan_revision', p.revision, 'cloud_shot_ids', to_jsonb(v_ids),
   'rerender_shot_ids', to_jsonb(coalesce(p_rerender_shot_ids, '{}')), 'note', left(coalesce(p_note, ''), 500)),
  ceil(v_cost)::integer, null);
end; $$;
revoke all on function public.request_video_render_approval(uuid,uuid[],text) from public, anon;
grant execute on function public.request_video_render_approval(uuid,uuid[],text) to authenticated;

create function public.enqueue_video_job(
 p_plan_id uuid, p_job_type text, p_shot_id uuid default null, p_approval_request_id uuid default null, p_idempotency_key text default null
) returns public.agent_jobs language plpgsql security definer set search_path='' as $$
declare p public.video_plans; j public.agent_jobs; v_key text; v_est jsonb;
begin
 select * into p from public.video_plans where id = p_plan_id for update;
 if not found or auth.uid() is null or not private.has_organization_permission(p.organization_id, 'content.manage') then
  raise exception '分镜计划不存在或没有权限' using errcode='42501';
 end if;
 if not private.is_video_render_job(p_job_type) then raise exception '未知视频任务类型' using errcode='check_violation'; end if;
 if p_job_type <> 'video_compose' and p_shot_id is null then raise exception '需要指定镜头' using errcode='check_violation'; end if;
 if p_job_type = 'video_compose' and not exists (select 1 from public.video_shots where plan_id = p.id) then
  raise exception '分镜为空，无法合成' using errcode='check_violation';
 end if;
 v_est := private.video_job_estimate(p_job_type, p.id, jsonb_build_object('shot_id', p_shot_id));
 v_key := coalesce(nullif(btrim(p_idempotency_key), ''),
  format('%s:%s:r%s:%s:%s', p_job_type, p.id, p.revision, coalesce(p_shot_id::text, 'all'), coalesce(p_approval_request_id::text, 'free')));
 j := public.enqueue_agent_job(p.organization_id, p_job_type, v_key,
  jsonb_build_object('schema_version', 1, 'plan_id', p.id, 'plan_revision', p.revision, 'shot_id', p_shot_id),
  'video_plan', p.id::text, p.revision,
  greatest(ceil((v_est->>'cost_cents')::numeric)::integer, 1), 1, p_approval_request_id);
 if j.created_at = now() then  -- inserted in this transaction (not an idempotent replay)
  if p_job_type = 'video_shot_render' then
   update public.video_shots set render_status = 'queued', error = null where id = p_shot_id and render_status in ('pending','failed','rendered');
  end if;
 end if;
 return j;
end; $$;
revoke all on function public.enqueue_video_job(uuid,text,uuid,uuid,text) from public, anon;
grant execute on function public.enqueue_video_job(uuid,text,uuid,uuid,text) to authenticated;

create function public.enqueue_video_storyboard_job(
 p_organization_id uuid, p_outline text, p_options jsonb default '{}'::jsonb, p_project_id uuid default null, p_idempotency_key text default null
) returns public.agent_jobs language plpgsql security definer set search_path='' as $$
declare v_key text; v_opts jsonb := coalesce(p_options, '{}'::jsonb);
begin
 if auth.uid() is null or not private.has_organization_permission(p_organization_id, 'content.manage') then
  raise exception '没有视频创作权限' using errcode='42501';
 end if;
 if char_length(btrim(coalesce(p_outline, ''))) not between 10 and 20000 then
  raise exception '大纲需要 10–20000 字' using errcode='check_violation';
 end if;
 if jsonb_typeof(v_opts) <> 'object' then raise exception '选项格式无效' using errcode='check_violation'; end if;
 if p_project_id is not null and not exists (select 1 from public.content_projects c where c.id = p_project_id and c.organization_id = p_organization_id) then
  raise exception '内容项目不存在' using errcode='check_violation';
 end if;
 v_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'video_storyboard:' || encode(extensions.digest(btrim(p_outline) || v_opts::text, 'sha256'), 'hex'));
 return public.enqueue_agent_job(p_organization_id, 'video_storyboard', left(v_key, 200),
  jsonb_build_object('schema_version', 1, 'outline', btrim(p_outline), 'project_id', p_project_id,
   'aspect_ratio', coalesce(v_opts->>'aspect_ratio', '9:16'), 'target_seconds', coalesce((v_opts->>'target_seconds')::integer, 30),
   'style', coalesce(v_opts->>'style', ''), 'default_voice', coalesce(v_opts->>'default_voice', 'zh-CN-XiaoxiaoNeural')),
  case when p_project_id is null then null else 'content_project' end, p_project_id::text, null,
  coalesce((v_opts->>'budget_cents')::integer, 100), 3, null);
end; $$;
revoke all on function public.enqueue_video_storyboard_job(uuid,text,jsonb,uuid,text) from public, anon;
grant execute on function public.enqueue_video_storyboard_job(uuid,text,jsonb,uuid,text) to authenticated;

-- Human adoption: proposal → formal plan + shots (the only path from Agent output to formal tables).
create function public.accept_video_storyboard_proposal(p_proposal_id uuid, p_title text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare pr public.video_storyboard_proposals; v_plan uuid; v_shot jsonb; v_pos integer := 0; v_job public.agent_jobs;
 v_doc jsonb;
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
 if coalesce(v_job.cost_cents, 0) > 0 then
  insert into public.video_cost_entries(organization_id, plan_id, agent_job_id, kind, provider, estimated_cents, actual_cents, metadata)
  values (pr.organization_id, v_plan, v_job.id, 'storyboard_llm', coalesce(v_job.driver, 'llm'), v_job.cost_cents, v_job.cost_cents,
   jsonb_build_object('model', v_job.model));
 end if;
 insert into public.audit_events(organization_id, actor_user_id, action, target_type, target_id, metadata)
 values (pr.organization_id, auth.uid(), 'video_storyboard.accepted', 'video_plan', v_plan::text, jsonb_build_object('proposal_id', pr.id, 'shots', v_pos));
 return v_plan;
end; $$;
revoke all on function public.accept_video_storyboard_proposal(uuid,text) from public, anon;
grant execute on function public.accept_video_storyboard_proposal(uuid,text) to authenticated;

create function public.reject_video_storyboard_proposal(p_proposal_id uuid, p_reason text)
returns public.video_storyboard_proposals language plpgsql security definer set search_path='' as $$
declare pr public.video_storyboard_proposals;
begin
 select * into pr from public.video_storyboard_proposals where id = p_proposal_id for update;
 if not found or auth.uid() is null or not private.has_organization_permission(pr.organization_id, 'content.manage') then
  raise exception '提案不存在或没有权限' using errcode='42501';
 end if;
 if pr.status <> 'pending' then raise exception '提案已处理（%）', pr.status using errcode='check_violation'; end if;
 if btrim(coalesce(p_reason, '')) = '' then raise exception '请填写退回原因' using errcode='check_violation'; end if;
 update public.video_storyboard_proposals set status = 'rejected', decided_by = auth.uid(), decided_at = now(), reason = left(p_reason, 2000)
 where id = pr.id returning * into pr;
 update public.agent_jobs set status = 'cancelled', error = '人工退回分镜提案' where id = pr.agent_job_id and status = 'pending_review';
 return pr;
end; $$;
revoke all on function public.reject_video_storyboard_proposal(uuid,text) from public, anon;
grant execute on function public.reject_video_storyboard_proposal(uuid,text) to authenticated;

-- Single-statement reorder => one revision bump.
create function public.reorder_video_shots(p_plan_id uuid, p_shot_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare p public.video_plans; v_count integer;
begin
 select * into p from public.video_plans where id = p_plan_id for update;
 if not found or auth.uid() is null or not private.has_organization_permission(p.organization_id, 'content.manage') then
  raise exception '分镜计划不存在或没有权限' using errcode='42501';
 end if;
 select count(*) into v_count from public.video_shots where plan_id = p.id;
 if v_count <> coalesce(array_length(p_shot_ids, 1), 0) or v_count <> (select count(distinct x) from unnest(p_shot_ids) x)
  or exists (select 1 from unnest(p_shot_ids) x where not exists (select 1 from public.video_shots s where s.id = x and s.plan_id = p.id)) then
  raise exception '镜头列表与计划不一致' using errcode='check_violation';
 end if;
 update public.video_shots s set position = o.ord::integer
 from unnest(p_shot_ids) with ordinality as o(id, ord)
 where s.id = o.id and s.position is distinct from o.ord::integer;
 return (select revision from public.video_plans where id = p.id);
end; $$;
revoke all on function public.reorder_video_shots(uuid,uuid[]) from public, anon;
grant execute on function public.reorder_video_shots(uuid,uuid[]) to authenticated;
