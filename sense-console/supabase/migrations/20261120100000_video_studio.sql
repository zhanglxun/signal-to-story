-- P5 Video Studio: storyboard plans/shots, storyboard proposals, cost ledger, private media bucket.
-- * Browser: read via RLS (content.view); author shots via column grants (content.manage).
-- * Any storyboard content change bumps video_plans.revision exactly once per statement.
-- * Worker (service_role) may only write render state / asset references / ledger rows, never content.
-- * Shots are locked while any shot of the plan (or the plan's composition) is rendering.
-- Rendering jobs, cost rules and the Mandate are in 20261120100100_video_studio_mandate.sql.

-- Generated media is registered in the existing asset ledger under one dedicated type.
alter table public.assets drop constraint assets_asset_type_check;
alter table public.assets add constraint assets_asset_type_check
  check (asset_type in ('character', 'scene', 'prop', 'sound', 'style', 'video_studio'));
comment on column public.assets.asset_type is '业务分类：character/scene/prop/sound/style；video_studio = 视频工坊生成物（category: keyframe/voiceover/shot_clip/final_video）。';

create table public.video_plans (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 project_id uuid,
 source_document_id uuid,
 source_document_revision integer,
 title text not null check (char_length(btrim(title)) between 1 and 160),
 aspect_ratio text not null default '9:16' check (aspect_ratio in ('9:16','16:9','1:1')),
 target_seconds integer not null default 30 check (target_seconds between 3 and 600),
 style text not null default '' check (char_length(style) <= 1000),
 default_voice text not null default 'zh-CN-XiaoxiaoNeural' check (char_length(default_voice) between 1 and 80),
 tts_provider text not null default 'edge_tts' check (tts_provider in ('edge_tts','cloud_tts')),
 bgm_track text check (bgm_track is null or char_length(bgm_track) <= 300),
 status text not null default 'draft' check (status in ('draft','rendering','rendered','failed','archived')),
 revision integer not null default 1 check (revision >= 1),
 composed_video_asset_id bigint references public.assets(id) on delete set null,
 final_duration_ms integer check (final_duration_ms is null or final_duration_ms >= 0),
 error text check (error is null or char_length(error) <= 4000),
 source_proposal_id uuid,
 created_by uuid not null default auth.uid() references auth.users(id),
 updated_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (organization_id, id),
 foreign key (organization_id, project_id) references public.content_projects(organization_id, id),
 foreign key (organization_id, source_document_id, source_document_revision)
  references public.content_revisions(organization_id, document_id, revision)
);
comment on table public.video_plans is '视频工坊分镜计划。任何分镜内容变化都会递增 revision；付费渲染批准绑定 (video_plan, id, revision)。';

create table public.video_shots (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 plan_id uuid not null,
 position integer not null check (position between 1 and 200),
 shot_size text not null default 'medium' check (shot_size in ('extreme_wide','wide','full','medium','close_up','extreme_close_up')),
 camera_motion text not null default 'zoom_in' check (camera_motion in ('zoom_in','zoom_out','pan_left','pan_right','pan_up','static')),
 motion_mode text not null default 'local_ken_burns' check (motion_mode in ('local_ken_burns','cloud_video_model')),
 visual_prompt text not null default '' check (char_length(visual_prompt) <= 2000),
 narration text not null default '' check (char_length(narration) <= 1000),
 voice text check (voice is null or char_length(voice) between 1 and 80),
 sfx_description text not null default '' check (char_length(sfx_description) <= 500),
 target_duration_ms integer not null default 4000 check (target_duration_ms between 500 and 60000),
 actual_duration_ms integer check (actual_duration_ms is null or actual_duration_ms between 0 and 600000),
 keyframe_asset_id bigint references public.assets(id) on delete set null,
 audio_asset_id bigint references public.assets(id) on delete set null,
 video_asset_id bigint references public.assets(id) on delete set null,
 render_status text not null default 'pending' check (render_status in ('pending','queued','rendering','rendered','failed')),
 estimated_cost_cents numeric(14,4) not null default 0 check (estimated_cost_cents >= 0),
 actual_cost_cents numeric(14,4) not null default 0 check (actual_cost_cents >= 0),
 error text check (error is null or char_length(error) <= 4000),
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (organization_id, id),
 constraint video_shots_position_unique unique (plan_id, position) deferrable initially deferred,
 foreign key (organization_id, plan_id) references public.video_plans(organization_id, id) on delete cascade
);
comment on table public.video_shots is '分镜镜头。内容列由人编辑；render_status/资产引用/实际时长/成本由 worker 回写。';

create table public.video_storyboard_proposals (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 agent_job_id uuid not null,
 project_id uuid,
 input_outline text not null check (char_length(input_outline) between 1 and 20000),
 proposal jsonb not null check (jsonb_typeof(proposal) = 'object' and jsonb_typeof(proposal->'shots') = 'array' and pg_column_size(proposal) <= 262144),
 model text check (model is null or char_length(model) <= 128),
 status text not null default 'pending' check (status in ('pending','accepted','rejected')),
 accepted_plan_id uuid,
 decided_by uuid references auth.users(id) on delete set null,
 decided_at timestamptz,
 reason text not null default '' check (char_length(reason) <= 2000),
 created_at timestamptz not null default now(),
 unique (organization_id, id),
 unique (agent_job_id),
 foreign key (organization_id, agent_job_id) references public.agent_jobs(organization_id, id) on delete cascade,
 foreign key (organization_id, project_id) references public.content_projects(organization_id, id),
 foreign key (organization_id, accepted_plan_id) references public.video_plans(organization_id, id) on delete set null (accepted_plan_id)
);
comment on table public.video_storyboard_proposals is 'Agent 分镜拆解提案。只有人通过 accept_video_storyboard_proposal 才会写入 video_plans/video_shots。';

alter table public.video_plans add constraint video_plans_source_proposal_fkey
 foreign key (organization_id, source_proposal_id) references public.video_storyboard_proposals(organization_id, id) on delete set null (source_proposal_id);

create table public.video_cost_entries (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 plan_id uuid not null,
 shot_id uuid,
 agent_job_id uuid,
 kind text not null check (kind in ('tts','shot_render','compose','keyframe','storyboard_llm')),
 provider text not null check (char_length(provider) between 1 and 64),
 estimated_cents numeric(14,4) not null default 0 check (estimated_cents >= 0),
 actual_cents numeric(14,4) not null default 0 check (actual_cents >= 0),
 metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
 created_at timestamptz not null default now(),
 foreign key (organization_id, plan_id) references public.video_plans(organization_id, id) on delete cascade,
 foreign key (organization_id, shot_id) references public.video_shots(organization_id, id) on delete set null (shot_id),
 foreign key (organization_id, agent_job_id) references public.agent_jobs(organization_id, id) on delete set null (agent_job_id)
);
comment on table public.video_cost_entries is '视频成本账本（追加写入，不可修改）。镜头与计划的实际成本由此汇总。';
create unique index video_cost_entries_job_once on public.video_cost_entries
 (agent_job_id, kind, coalesce(shot_id, '00000000-0000-0000-0000-000000000000'::uuid)) where agent_job_id is not null;

create index video_plans_org_updated_idx on public.video_plans (organization_id, updated_at desc);
create index video_plans_project_idx on public.video_plans (organization_id, project_id);
create index video_plans_source_doc_idx on public.video_plans (organization_id, source_document_id, source_document_revision);
create index video_plans_proposal_idx on public.video_plans (organization_id, source_proposal_id);
create index video_plans_created_by_idx on public.video_plans (created_by);
create index video_plans_updated_by_idx on public.video_plans (updated_by);
create index video_plans_composed_asset_idx on public.video_plans (composed_video_asset_id);
create index video_shots_plan_idx on public.video_shots (organization_id, plan_id, position);
create index video_shots_keyframe_idx on public.video_shots (keyframe_asset_id);
create index video_shots_audio_idx on public.video_shots (audio_asset_id);
create index video_shots_video_idx on public.video_shots (video_asset_id);
create index video_shots_created_by_idx on public.video_shots (created_by);
create index video_proposals_org_idx on public.video_storyboard_proposals (organization_id, status, created_at desc);
create index video_proposals_project_idx on public.video_storyboard_proposals (organization_id, project_id);
create index video_proposals_plan_idx on public.video_storyboard_proposals (organization_id, accepted_plan_id);
create index video_proposals_decided_by_idx on public.video_storyboard_proposals (decided_by);
create index video_cost_entries_plan_idx on public.video_cost_entries (organization_id, plan_id, created_at);
create index video_cost_entries_shot_idx on public.video_cost_entries (organization_id, shot_id);
create index video_cost_entries_job_idx on public.video_cost_entries (organization_id, agent_job_id);

-- ---------------------------------------------------------------- cost model (mirrors src/contracts/video-studio.ts)
-- Unit: cents of CNY (分). Estimates only; the worker records actual cost in video_cost_entries.
create function private.video_cost_rate(p_key text) returns numeric language sql immutable set search_path='' as $$
 select case p_key
  when 'cloud_tts_per_100_chars' then 2::numeric   -- paid cloud TTS, per started 100 characters
  when 'cloud_video_per_5s' then 35::numeric        -- cloud video model (e.g. wan2.7 t2v ≈ ¥0.35 / 5 s clip)
  when 'free_threshold' then 10::numeric            -- jobs above this (or using a cloud video model) need approval
  when 'padding_ms' then 300::numeric               -- Audio-First tail padding after narration
  else 0::numeric end
$$;

-- Duration billed for a cloud clip: narration-aligned when TTS exists, else the target. Clip length 5 s or 10 s.
create function private.video_cloud_clip_seconds(p_target_ms integer, p_actual_ms integer) returns integer
language sql immutable set search_path='' as $$
 select case when coalesce(p_actual_ms + private.video_cost_rate('padding_ms')::integer, p_target_ms) <= 5000 then 5 else 10 end
$$;

create function private.video_shot_cost_cents(
 p_motion_mode text, p_target_ms integer, p_actual_ms integer, p_narration text, p_tts_provider text,
 p_include_tts boolean, p_include_video boolean
) returns numeric language sql immutable set search_path='' as $$
 select
  (case when p_include_tts and p_tts_provider = 'cloud_tts' and char_length(btrim(coalesce(p_narration,''))) > 0
     then ceil(char_length(btrim(p_narration)) / 100.0) * private.video_cost_rate('cloud_tts_per_100_chars') else 0 end)
  + (case when p_include_video and p_motion_mode = 'cloud_video_model'
     then (private.video_cloud_clip_seconds(p_target_ms, p_actual_ms) / 5) * private.video_cost_rate('cloud_video_per_5s') else 0 end)
$$;

revoke all on function private.video_cost_rate(text) from public, anon, authenticated;
revoke all on function private.video_cloud_clip_seconds(integer,integer) from public, anon, authenticated;
revoke all on function private.video_shot_cost_cents(text,integer,integer,text,text,boolean,boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- locking & revision
create function private.video_plan_locked(p_plan_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists (select 1 from public.video_plans p where p.id = p_plan_id and p.status = 'rendering')
  or exists (select 1 from public.video_shots s where s.plan_id = p_plan_id and s.render_status = 'rendering')
$$;
revoke all on function private.video_plan_locked(uuid) from public, anon, authenticated;

create function private.video_asset_in_org(p_asset_id bigint, p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_asset_id is null or exists (select 1 from public.assets a where a.id = p_asset_id and a.organization_id = p_org)
$$;
revoke all on function private.video_asset_in_org(bigint,uuid) from public, anon, authenticated;

create function private.guard_video_plan() returns trigger language plpgsql security definer set search_path='' as $$
declare content_changed boolean;
begin
 if tg_op = 'INSERT' then
  new.revision := 1; new.status := 'draft'; new.composed_video_asset_id := null; new.final_duration_ms := null; new.error := null;
  new.created_at := now(); new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.created_by);
  return new;
 end if;
 if new.organization_id is distinct from old.organization_id or new.created_by is distinct from old.created_by
  or new.created_at is distinct from old.created_at or new.source_proposal_id is distinct from old.source_proposal_id then
  raise exception '分镜计划的归属不可修改' using errcode='check_violation';
 end if;
 if not private.video_asset_in_org(new.composed_video_asset_id, new.organization_id) then
  raise exception '成片资产不属于该组织' using errcode='check_violation';
 end if;
 content_changed := (new.title, new.aspect_ratio, new.target_seconds, new.style, new.default_voice, new.tts_provider, new.bgm_track,
   new.project_id, new.source_document_id, new.source_document_revision)
  is distinct from (old.title, old.aspect_ratio, old.target_seconds, old.style, old.default_voice, old.tts_provider, old.bgm_track,
   old.project_id, old.source_document_id, old.source_document_revision);
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
revoke all on function private.guard_video_plan() from public, anon, authenticated;
create trigger video_plan_guard before insert or update on public.video_plans
 for each row execute function private.guard_video_plan();

-- Render state machine for one shot. Content changes force 'pending' and drop stale outputs.
create function private.video_shot_transition_allowed(old_status text, new_status text) returns boolean
language sql immutable set search_path='' as $$
 select old_status = new_status or (old_status, new_status) in (
  ('pending','queued'),('failed','queued'),('rendered','queued'),
  ('queued','rendering'),('queued','pending'),('queued','failed'),
  ('rendering','rendered'),('rendering','failed'),
  ('failed','pending'),('rendered','pending')
 )
$$;
revoke all on function private.video_shot_transition_allowed(text,text) from public, anon, authenticated;

create function private.guard_video_shot() returns trigger language plpgsql security definer set search_path='' as $$
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
  new.actual_cost_cents := 0; new.error := null; new.created_at := now();
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
  if new.actual_cost_cents < old.actual_cost_cents then raise exception '实际成本只能由账本累加' using errcode='check_violation'; end if;
 end if;
 if not (private.video_asset_in_org(new.keyframe_asset_id, new.organization_id) and private.video_asset_in_org(new.audio_asset_id, new.organization_id)
   and private.video_asset_in_org(new.video_asset_id, new.organization_id)) then
  raise exception '资产不属于该组织' using errcode='check_violation';
 end if;
 new.estimated_cost_cents := private.video_shot_cost_cents(new.motion_mode, new.target_duration_ms, new.actual_duration_ms, new.narration,
  coalesce(p.tts_provider, 'edge_tts'), true, true);
 new.updated_at := now();
 return new;
end; $$;
revoke all on function private.guard_video_shot() from public, anon, authenticated;
create trigger video_shot_guard before insert or update or delete on public.video_shots
 for each row execute function private.guard_video_shot();

-- One revision bump per statement (so a reorder of N shots bumps once). A plan created in the same
-- transaction (proposal acceptance) keeps revision 1.
create function private.bump_plan_revision_on_shot_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.video_plans p set revision = p.revision + 1, status = case when p.status in ('rendered','failed') then 'draft' else p.status end
 where p.id in (select distinct plan_id from new_rows) and p.created_at < now();
 return null;
end; $$;
create function private.bump_plan_revision_on_shot_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.video_plans p set revision = p.revision + 1, status = case when p.status in ('rendered','failed') then 'draft' else p.status end
 where p.id in (select distinct plan_id from old_rows);
 return null;
end; $$;
create function private.bump_plan_revision_on_shot_update() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.video_plans p set revision = p.revision + 1, status = case when p.status in ('rendered','failed') then 'draft' else p.status end
 where p.id in (
  select distinct n.plan_id from new_rows n join old_rows o on o.id = n.id
  where (n.position, n.shot_size, n.camera_motion, n.motion_mode, n.visual_prompt, n.narration, n.voice, n.sfx_description, n.target_duration_ms, n.keyframe_asset_id)
   is distinct from (o.position, o.shot_size, o.camera_motion, o.motion_mode, o.visual_prompt, o.narration, o.voice, o.sfx_description, o.target_duration_ms, o.keyframe_asset_id)
 );
 return null;
end; $$;
revoke all on function private.bump_plan_revision_on_shot_insert() from public, anon, authenticated;
revoke all on function private.bump_plan_revision_on_shot_delete() from public, anon, authenticated;
revoke all on function private.bump_plan_revision_on_shot_update() from public, anon, authenticated;
create trigger video_shots_bump_insert after insert on public.video_shots
 referencing new table as new_rows for each statement execute function private.bump_plan_revision_on_shot_insert();
create trigger video_shots_bump_delete after delete on public.video_shots
 referencing old table as old_rows for each statement execute function private.bump_plan_revision_on_shot_delete();
create trigger video_shots_bump_update after update on public.video_shots
 referencing old table as old_rows new table as new_rows for each statement execute function private.bump_plan_revision_on_shot_update();

-- TTS provider change re-prices every shot of the plan.
create function private.reprice_video_shots() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.tts_provider is distinct from old.tts_provider then
  update public.video_shots s set estimated_cost_cents = private.video_shot_cost_cents(s.motion_mode, s.target_duration_ms, s.actual_duration_ms, s.narration, new.tts_provider, true, true)
  where s.plan_id = new.id;
 end if;
 return null;
end; $$;
revoke all on function private.reprice_video_shots() from public, anon, authenticated;
create trigger video_plan_reprice after update on public.video_plans for each row execute function private.reprice_video_shots();

-- Ledger → actual cost on the shot (append-only, so totals only grow).
create function private.apply_video_cost_entry() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists (select 1 from public.video_plans p where p.id = new.plan_id and p.organization_id = new.organization_id) then
  raise exception '账本计划不属于该组织' using errcode='check_violation';
 end if;
 if new.shot_id is not null then
  update public.video_shots set actual_cost_cents = actual_cost_cents + new.actual_cents where id = new.shot_id and plan_id = new.plan_id;
 end if;
 return null;
end; $$;
revoke all on function private.apply_video_cost_entry() from public, anon, authenticated;
create trigger video_cost_entry_apply after insert on public.video_cost_entries for each row execute function private.apply_video_cost_entry();

-- Proposals are immutable except through the accept/reject RPCs.
create function private.guard_video_proposal() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op = 'INSERT' then
  new.status := 'pending'; new.accepted_plan_id := null; new.decided_by := null; new.decided_at := null; new.reason := ''; new.created_at := now();
  return new;
 end if;
 if (new.organization_id, new.agent_job_id, new.input_outline, new.proposal, new.created_at) is distinct from
    (old.organization_id, old.agent_job_id, old.input_outline, old.proposal, old.created_at) then
  raise exception '提案内容不可修改' using errcode='check_violation';
 end if;
 if new.status <> old.status and (old.status <> 'pending' or auth.uid() is null or new.decided_by is distinct from auth.uid()) then
  raise exception '只有人类成员可以处理待定提案' using errcode='42501';
 end if;
 return new;
end; $$;
revoke all on function private.guard_video_proposal() from public, anon, authenticated;
create trigger video_proposal_guard before insert or update on public.video_storyboard_proposals
 for each row execute function private.guard_video_proposal();

-- ---------------------------------------------------------------- RLS & grants
alter table public.video_plans enable row level security;
alter table public.video_shots enable row level security;
alter table public.video_storyboard_proposals enable row level security;
alter table public.video_cost_entries enable row level security;
revoke all on public.video_plans, public.video_shots, public.video_storyboard_proposals, public.video_cost_entries from anon, authenticated, service_role;

create policy video_plans_read on public.video_plans for select to authenticated
 using ((select private.has_organization_permission(organization_id,'content.view')));
create policy video_plans_insert on public.video_plans for insert to authenticated
 with check ((select private.has_organization_permission(organization_id,'content.manage')) and created_by = (select auth.uid()));
create policy video_plans_update on public.video_plans for update to authenticated
 using ((select private.has_organization_permission(organization_id,'content.manage')))
 with check ((select private.has_organization_permission(organization_id,'content.manage')));
create policy video_plans_delete on public.video_plans for delete to authenticated
 using ((select private.has_organization_permission(organization_id,'content.manage')) and status <> 'rendering');

create policy video_shots_read on public.video_shots for select to authenticated
 using ((select private.has_organization_permission(organization_id,'content.view')));
create policy video_shots_insert on public.video_shots for insert to authenticated
 with check ((select private.has_organization_permission(organization_id,'content.manage')) and created_by = (select auth.uid()));
create policy video_shots_update on public.video_shots for update to authenticated
 using ((select private.has_organization_permission(organization_id,'content.manage')))
 with check ((select private.has_organization_permission(organization_id,'content.manage')));
create policy video_shots_delete on public.video_shots for delete to authenticated
 using ((select private.has_organization_permission(organization_id,'content.manage')));

create policy video_proposals_read on public.video_storyboard_proposals for select to authenticated
 using ((select private.has_organization_permission(organization_id,'content.view')));
create policy video_cost_entries_read on public.video_cost_entries for select to authenticated
 using ((select private.has_organization_permission(organization_id,'content.view')));

grant select on public.video_plans, public.video_shots, public.video_storyboard_proposals, public.video_cost_entries to authenticated;
grant insert (organization_id, project_id, source_document_id, source_document_revision, title, aspect_ratio, target_seconds, style, default_voice, tts_provider, bgm_track, created_by)
 on public.video_plans to authenticated;
grant update (project_id, source_document_id, source_document_revision, title, aspect_ratio, target_seconds, style, default_voice, tts_provider, bgm_track)
 on public.video_plans to authenticated;
grant delete on public.video_plans to authenticated;
grant insert (organization_id, plan_id, position, shot_size, camera_motion, motion_mode, visual_prompt, narration, voice, sfx_description, target_duration_ms, keyframe_asset_id, created_by)
 on public.video_shots to authenticated;
grant update (position, shot_size, camera_motion, motion_mode, visual_prompt, narration, voice, sfx_description, target_duration_ms, keyframe_asset_id)
 on public.video_shots to authenticated;
grant delete on public.video_shots to authenticated;

-- Worker: read everything, write render state only.
grant select on public.video_plans, public.video_shots, public.video_storyboard_proposals, public.video_cost_entries to service_role;
grant update (status, composed_video_asset_id, final_duration_ms, error) on public.video_plans to service_role;
grant update (render_status, actual_duration_ms, audio_asset_id, video_asset_id, error) on public.video_shots to service_role;
grant insert (organization_id, agent_job_id, project_id, input_outline, proposal, model) on public.video_storyboard_proposals to service_role;
grant insert (organization_id, plan_id, shot_id, agent_job_id, kind, provider, estimated_cents, actual_cents, metadata) on public.video_cost_entries to service_role;

-- Cost summary per plan (security_invoker: the caller's RLS applies).
create view public.video_plan_cost_summary with (security_invoker = true) as
select p.id as plan_id, p.organization_id, p.revision,
 coalesce((select sum(s.estimated_cost_cents) from public.video_shots s where s.plan_id = p.id), 0) as estimated_cents,
 coalesce((select sum(e.actual_cents) from public.video_cost_entries e where e.plan_id = p.id), 0) as actual_cents,
 coalesce((select sum(e.actual_cents) from public.video_cost_entries e where e.plan_id = p.id and e.shot_id is null), 0) as plan_level_actual_cents,
 (select count(*) from public.video_shots s where s.plan_id = p.id)::integer as shot_count,
 (select count(*) from public.video_shots s where s.plan_id = p.id and s.render_status = 'rendered')::integer as rendered_count,
 (select count(*) from public.video_shots s where s.plan_id = p.id and s.motion_mode = 'cloud_video_model')::integer as cloud_shot_count
from public.video_plans p;
revoke all on public.video_plan_cost_summary from anon, authenticated, service_role;
grant select on public.video_plan_cost_summary to authenticated, service_role;

-- ---------------------------------------------------------------- private media bucket (worker uploads, members read via signed URL)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('video-studio', 'video-studio', false, 524288000,
 array['video/mp4','audio/mpeg','audio/wav','image/png','image/jpeg','text/plain','application/json'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy video_studio_storage_select_viewer on storage.objects for select to authenticated
 using (bucket_id = 'video-studio' and (select private.has_organization_permission((storage.foldername(name))[1]::uuid, 'content.view')));
