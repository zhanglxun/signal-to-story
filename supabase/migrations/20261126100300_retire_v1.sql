-- Retire release (0.5, docs/database.md §3, §7, DB-D3 / DB-D6): the V1 tables go after one last backfill
-- and a reconciliation that refuses to drop anything that is not accounted for in the 0.5 tables.
--   V1 capture: signals, selections, intake_receipts, intake_oauth_{requests,grants,tokens} (+ intake_oauth RPC)
--   V1 content: content_projects, content_project_assets, content_revisions, content_review_events
--   Knowledge (not in the MVP): knowledge_entries, decision_memories — the worker reads knowledge-base/ files.
-- content_documents: work_item_id becomes NOT NULL, project_id is dropped. Review history keeps flowing into
-- audit_events (content.<status>); revisions keep counting but no snapshot table exists any more.

-- ── 1. Last backfill + reconciliation (aborts the whole release on any gap) ──
do $reconcile$
declare r jsonb; n bigint;
begin
 r := private.backfill_v1();
 raise notice 'backfill_v1 (final): %', r;

 select count(*) into n from public.intake_receipts x
 where not exists (select 1 from public.intake_events e where e.payload -> 'legacy' ->> 'receipt_id' = x.id::text);
 if n > 0 then raise exception 'reconcile: % intake_receipts have no intake_events row', n; end if;

 select count(*) into n from public.signals s
 where not exists (select 1 from public.intake_events e where e.payload -> 'legacy' ->> 'signal_id' = s.id::text);
 if n > 0 then raise exception 'reconcile: % signals have no intake_events row', n; end if;

 select count(*) into n from public.selections x
 where not exists (select 1 from public.work_items w where w.brief -> 'legacy' ->> 'selection_id' = x.id::text);
 if n > 0 then raise exception 'reconcile: % selections have no work_items row', n; end if;

 select count(*) into n from public.content_projects p
 where not exists (select 1 from public.work_items w where w.brief -> 'legacy' ->> 'content_project_id' = p.id::text);
 if n > 0 then raise exception 'reconcile: % content_projects have no work_items row', n; end if;

 select count(*) into n from public.content_review_events v
 where not exists (select 1 from public.audit_events a where a.metadata -> 'legacy' ->> 'review_event_id' = v.id::text);
 if n > 0 then raise exception 'reconcile: % content_review_events have no audit_events row', n; end if;

 select count(*) into n from public.content_documents where work_item_id is null;
 if n > 0 then raise exception 'reconcile: % content_documents are not on a work item', n; end if;

 select count(*) into n from public.content_project_assets;
 if n > 0 then raise exception 'reconcile: content_project_assets has % rows; linked assets are not carried over', n; end if;
end $reconcile$;

-- ── 2. content_documents: card only, no snapshot table ──
create or replace function private.guard_cloud_content() returns trigger language plpgsql set search_path='' as $$
begin
 if auth.uid() is null then raise exception '需要登录' using errcode='42501'; end if;
 if tg_op='INSERT' then
  new.created_by:=auth.uid(); new.created_at:=now(); new.updated_at:=now();
  if new.status<>'draft' then raise exception '新稿件必须为草稿'; end if;
  new.revision:=1;
  return new;
 end if;
 if new.organization_id is distinct from old.organization_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
  raise exception '不能修改所属组织或创建记录';
 end if;
 new.updated_at:=now();
 if new.work_item_id is distinct from old.work_item_id or new.platform<>old.platform or new.revision<>old.revision then
  raise exception '不能修改稿件归属或版本号';
 end if;
 if new.title is distinct from old.title or new.body is distinct from old.body then
  if not private.has_organization_permission(new.organization_id,'content.manage') then raise exception '没有编辑权限' using errcode='42501'; end if;
  new.revision:=old.revision+1; new.status:='draft'; new.review_note:='';
 elsif new.status<>old.status then
  if new.status='in_review' then
   if old.status not in ('draft','changes_requested') or btrim(new.body)='' or not private.has_organization_permission(new.organization_id,'content.manage') then raise exception '稿件不能提交审核'; end if;
  elsif new.status in ('approved','changes_requested') then
   if old.status<>'in_review' or not private.has_organization_permission(new.organization_id,'content.review') then raise exception '需要审核权限及待审核稿件' using errcode='42501'; end if;
   if new.status='changes_requested' and btrim(new.review_note)='' then raise exception '请填写退回原因'; end if;
  else raise exception '无效的审核状态变化'; end if;
 elsif new.review_note is distinct from old.review_note then raise exception '审核意见必须随审核决定提交';
 end if;
 return new;
end; $$;

-- Review history → audit_events (same shape the backfill produced: action content.<status>, metadata.revision/note).
create or replace function private.snapshot_cloud_document() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception '需要登录'; end if;
 if tg_op='INSERT' or new.status<>old.status then
  insert into public.audit_events(organization_id, actor_user_id, action, target_type, target_id, metadata)
  values (new.organization_id, auth.uid(), 'content.' || new.status, 'content_document', new.id::text,
   jsonb_build_object('revision', new.revision, 'note', new.review_note));
 end if;
 return new;
end; $$;

alter table public.content_documents drop constraint if exists content_documents_owner_present;
alter table public.content_documents drop constraint if exists content_documents_organization_id_project_id_fkey;
alter table public.content_documents drop constraint if exists content_documents_project_id_platform_key;
drop index if exists public.content_documents_organization_id_project_id_idx;
alter table public.content_documents drop column project_id;
alter table public.content_documents alter column work_item_id set not null;

-- ── 3. Knowledge comes from repo files; node_draft_context returns only the document, card and source ──
create or replace function public.node_draft_context(p_token text, p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
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
  'source', src);
end; $$;

-- ── 4. Drop the retired objects (no CASCADE: an unexpected dependency must fail the release) ──
drop function if exists public.intake_oauth(text, jsonb);
drop function if exists private.backfill_v1();
drop table public.intake_oauth_tokens;
drop table public.intake_oauth_grants;
drop table public.intake_oauth_requests;
drop table public.intake_receipts;
drop table public.content_project_assets;
drop table public.content_projects;
drop table public.selections;
drop table public.signals;
drop table public.content_review_events;
drop table public.content_revisions;
drop table public.decision_memories;
drop table public.knowledge_entries;
drop function if exists private.guard_knowledge_memory();
