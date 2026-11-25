-- DB2c-3 (docs/database.md §4.3, DB-D15): AI writes directly to content_documents with optimistic
-- revision locking (base_revision) instead of staging rows in content_ai_proposals.
-- * write_document_draft(job_id, lease_epoch, document_id, base_revision, title, body):
--     Verifies the active job lease, verifies base_revision matches the document's current revision,
--     verifies the job creator still holds content.manage, and updates content_documents as that user
--     so guard_cloud_content / snapshot_cloud_document / expire_stale_document_approvals all run.
-- * node_write_document_draft(token, ...): runner-node gateway wrapper (keeps node_* count at 12).
-- * document_complete_draft_jobs: when a document is approved, any pending_review content_draft job
--     for that document automatically transitions to succeeded.
-- * Retires content_ai_proposals and node_save_proposal.

-- ── 1. Retire content_ai_proposals and node_save_proposal ──
drop function if exists public.node_save_proposal(text, uuid, bigint, jsonb);
drop table if exists public.content_ai_proposals;

-- ── 2. Direct draft write RPC (service_role / internal; called via node_write_document_draft) ──
create function public.write_document_draft(
  p_job_id uuid,
  p_lease_epoch bigint,
  p_document_id uuid,
  p_base_revision integer,
  p_title text,
  p_body text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.agent_jobs;
  d public.content_documents;
  v_actor uuid;
  v_next_title text;
  old_claims text := current_setting('request.jwt.claims', true);
  old_sub text := current_setting('request.jwt.claim.sub', true);
begin
  if p_body is null or btrim(p_body) = '' or char_length(p_body) > 100000 then
    raise exception '草稿正文需为 1–100000 字' using errcode = 'check_violation';
  end if;
  if p_title is not null and btrim(p_title) <> '' and char_length(btrim(p_title)) > 200 then
    raise exception '稿件标题不能超过 200 字' using errcode = 'check_violation';
  end if;

  select * into j from public.agent_jobs where id = p_job_id for update;
  if not found or j.status <> 'running' or j.lease_epoch is distinct from p_lease_epoch then
    raise exception '任务租约已失效（lease_epoch 不匹配），拒绝写入草稿' using errcode = 'P0002';
  end if;
  if j.kind <> 'content_draft'
     or j.payload->'target'->>'type' is distinct from 'content_document'
     or j.payload->'target'->>'id' is distinct from p_document_id::text then
    raise exception '任务目标稿件不匹配，拒绝写入草稿' using errcode = '42501';
  end if;

  -- Crash recovery idempotency: if this job already wrote its draft before failing to record persist/complete, return it.
  if j.result ? 'written_revision' and (j.result->>'written_revision') ~ '^[1-9][0-9]{0,8}$' then
    return jsonb_build_object(
      'document_id', p_document_id,
      'revision', (j.result->>'written_revision')::integer,
      'already_written', true
    );
  end if;

  select * into d from public.content_documents
  where id = p_document_id and organization_id = j.organization_id
  for update;
  if not found then
    raise exception '任务目标稿件不存在' using errcode = 'P0002';
  end if;

  if d.revision is distinct from p_base_revision then
    raise exception 'stale_revision: 稿件已从 v% 变为 v%，拒绝覆盖人工修改', p_base_revision, d.revision using errcode = 'P0001';
  end if;

  v_actor := coalesce(j.created_by, d.created_by);
  if v_actor is null or not exists (
    select 1
    from public.organization_members m
    join public.organization_roles r
      on r.organization_id = m.organization_id and r.role_key = m.role
    where m.organization_id = j.organization_id
      and m.user_id = v_actor
      and 'content.manage' = any(r.permissions)
  ) then
    raise exception '任务发起人已无内容编辑权限，拒绝写入草稿' using errcode = '42501';
  end if;

  v_next_title := coalesce(nullif(btrim(p_title), ''), d.title);

  -- Impersonate only `sub` during the content_documents update so guard_cloud_content and snapshot_cloud_document
  -- record the human requester while human-only RPCs (which require role='authenticated') stay unavailable.
  perform set_config('request.jwt.claims', (coalesce(nullif(old_claims, ''), '{}')::jsonb || jsonb_build_object('sub', v_actor))::text, true);
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  begin
    update public.content_documents
    set title = v_next_title, body = p_body
    where id = d.id
    returning * into d;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(old_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(old_sub, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(old_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(old_sub, ''), true);

  update public.agent_jobs
  set result = coalesce(result, '{}'::jsonb) || jsonb_build_object('written_document_id', d.id, 'written_revision', d.revision)
  where id = j.id;

  insert into public.audit_events(organization_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    j.organization_id,
    v_actor,
    'content.ai_draft_written',
    'content_document',
    d.id::text,
    jsonb_build_object('job_id', j.id, 'base_revision', p_base_revision, 'revision', d.revision)
  );

  return jsonb_build_object('document_id', d.id, 'revision', d.revision, 'already_written', false);
end; $$;

revoke all on function public.write_document_draft(uuid, bigint, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.write_document_draft(uuid, bigint, uuid, integer, text, text) to service_role;

-- ── 3. Node gateway wrapper for direct draft writes ──
create function public.node_write_document_draft(
  p_token text,
  p_job_id uuid,
  p_lease_epoch bigint,
  p_document_id uuid,
  p_base_revision integer,
  p_title text,
  p_body text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.node_job(p_token, p_job_id);
  return public.write_document_draft(p_job_id, p_lease_epoch, p_document_id, p_base_revision, p_title, p_body);
end; $$;

revoke all on function public.node_write_document_draft(text, uuid, bigint, uuid, integer, text, text) from public;
grant execute on function public.node_write_document_draft(text, uuid, bigint, uuid, integer, text, text) to anon, authenticated, service_role;

-- ── 4. Approving a document marks matching pending_review content_draft jobs succeeded ──
create function private.complete_draft_jobs_on_approval() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    update public.agent_jobs
    set status = 'succeeded',
        result = coalesce(result, '{}'::jsonb) || jsonb_build_object('approved_revision', new.revision)
    where organization_id = new.organization_id
      and kind = 'content_draft'
      and status = 'pending_review'
      and payload->'target'->>'type' = 'content_document'
      and payload->'target'->>'id' = new.id::text;
  end if;
  return null;
end; $$;

revoke all on function private.complete_draft_jobs_on_approval() from public, anon, authenticated;
create trigger document_complete_draft_jobs after update on public.content_documents
  for each row execute function private.complete_draft_jobs_on_approval();
