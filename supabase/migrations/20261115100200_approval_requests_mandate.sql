-- P1.5 Mandate: high-risk agent actions require a human approval bound to the exact target revision.
-- * service_role / Agent can only CREATE pending requests (via RPC); it can never decide them.
-- * Humans decide via decide_approval_request(), which checks membership + action permission.
-- * Editing a content document (revision bump) expires every pending/approved request on older revisions.
-- * Mandate-gated agent_jobs (publish_external / publish_site / video_render) cannot be queued, run or
--   succeed without a valid approval — enforced by trigger for every writer, including service_role.
-- content_publications already enforce an equivalent human gate (approved document + same revision +
-- auth.uid() required); that existing flow is reused unchanged.
-- 0.5: the same table also carries agent *questions* (kind = 'question'): the agent parks its job and asks;
--   only a human answers via answer_question(), which re-queues the asking job.

create table public.approval_requests (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 kind text not null default 'approval' check (kind in ('approval','question')),
 action text check (action in ('publish_external','publish_site','paid_video_render','rotate_credentials','delete_project','change_org_permissions')),
 target_type text check (target_type ~ '^[a-z][a-z0-9_]{1,63}$'),
 target_id text check (char_length(target_id) between 1 and 128),
 target_revision integer check (target_revision is null or target_revision >= 1),
 question jsonb check (question is null or (jsonb_typeof(question)='object' and pg_column_size(question) <= 16384)),
 answer jsonb check (answer is null or (jsonb_typeof(answer)='object' and pg_column_size(answer) <= 16384)),
 status text not null default 'pending' check (status in ('pending','approved','rejected','answered','expired')),
 summary text not null default '' check (char_length(summary) <= 2000),
 payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object' and pg_column_size(payload) <= 65536),
 estimated_cost_cents integer check (estimated_cost_cents is null or estimated_cost_cents >= 0),
 requested_by_job uuid,
 requested_by uuid references auth.users(id) on delete set null,
 decided_by uuid references auth.users(id) on delete set null,
 decided_at timestamptz,
 reason text not null default '' check (char_length(reason) <= 4000),
 expires_at timestamptz not null default now() + interval '7 days',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (organization_id, id),
 foreign key (organization_id, requested_by_job) references public.agent_jobs(organization_id, id) on delete set null (requested_by_job),
 constraint approval_requests_kind_shape check (
  (kind = 'approval' and action is not null and target_type is not null and target_id is not null
   and question is null and answer is null and status <> 'answered')
  or (kind = 'question' and action is null and question is not null and (question ? 'title')
   and status in ('pending','answered','expired') and (answer is not null) = (status = 'answered'))
 )
);
comment on table public.approval_requests is 'Mandate 人工批准请求。只能通过 create_approval_request / decide_approval_request 写入。';

create unique index approval_requests_one_pending on public.approval_requests
 (organization_id, action, target_type, target_id, coalesce(target_revision, 0)) where status = 'pending' and kind = 'approval';
create unique index approval_requests_one_open_question on public.approval_requests
 (requested_by_job) where status = 'pending' and kind = 'question';
create index approval_requests_org_status_idx on public.approval_requests (organization_id, status, created_at desc);
create index approval_requests_target_idx on public.approval_requests (organization_id, target_type, target_id);
create index approval_requests_job_idx on public.approval_requests (organization_id, requested_by_job);
create index approval_requests_requested_by_idx on public.approval_requests (requested_by);
create index approval_requests_decided_by_idx on public.approval_requests (decided_by);

alter table public.agent_jobs add constraint agent_jobs_approval_request_fkey
 foreign key (organization_id, approval_request_id) references public.approval_requests(organization_id, id);

-- Permission each action requires from the deciding human.
create function private.approval_required_permission(p_action text) returns text
language sql immutable set search_path='' as $$
 select case p_action
  when 'publish_external' then 'content.publish'
  when 'publish_site' then 'content.publish'
  when 'paid_video_render' then 'agent.approve'
  when 'delete_project' then 'agent.approve'
  when 'rotate_credentials' then 'account.manage'
  when 'change_org_permissions' then 'account.manage'
 end
$$;

-- Current revision of a target, or null when the target type is not versioned.
create function private.current_target_revision(p_target_type text, p_target_id text) returns integer
language plpgsql stable security definer set search_path='' as $$
declare r integer;
begin
 if p_target_type = 'content_document' then
  select d.revision into r from public.content_documents d where d.id::text = p_target_id;
  return r;
 elsif p_target_type = 'content_publication' then
  select d.revision into r from public.content_publications p join public.content_documents d on d.id = p.document_id where p.id::text = p_target_id;
  return r;
 end if;
 return null;
end; $$;

create function private.approval_is_valid(p_approval_id uuid, p_organization_id uuid, p_action text, p_target_type text, p_target_id text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare a public.approval_requests; current_rev integer;
begin
 select * into a from public.approval_requests where id = p_approval_id;
 if not found or a.organization_id <> p_organization_id or a.status <> 'approved' or a.expires_at <= now()
  or a.action <> p_action or a.target_type <> p_target_type or a.target_id <> p_target_id then
  return false;
 end if;
 current_rev := private.current_target_revision(a.target_type, a.target_id);
 return a.target_revision is not distinct from current_rev;
end; $$;

create function private.job_type_mandate_action(p_job_type text) returns text
language sql immutable set search_path='' as $$
 select case p_job_type
  when 'publish_external' then 'publish_external'
  when 'publish_site' then 'publish_site'
  when 'video_render' then 'paid_video_render'
 end
$$;

revoke all on function private.approval_required_permission(text) from public, anon, authenticated;
revoke all on function private.current_target_revision(text,text) from public, anon, authenticated;
revoke all on function private.approval_is_valid(uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function private.job_type_mandate_action(text) from public, anon, authenticated;

-- Guard: only legal transitions; approve/reject only by a permitted human.
create function private.guard_approval_request() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op = 'INSERT' then
  if new.status <> 'pending' then raise exception '新批准请求必须为 pending' using errcode='check_violation'; end if;
  new.decided_by := null; new.decided_at := null; new.reason := ''; new.answer := null; new.created_at := now(); new.updated_at := now();
  return new;
 end if;
 if new.organization_id is distinct from old.organization_id or new.kind is distinct from old.kind
  or new.question is distinct from old.question or new.action is distinct from old.action
  or new.target_type is distinct from old.target_type or new.target_id is distinct from old.target_id
  or new.target_revision is distinct from old.target_revision or new.payload is distinct from old.payload
  or new.requested_by is distinct from old.requested_by or new.created_at is distinct from old.created_at then
  raise exception '批准请求的目标与内容不可修改' using errcode='check_violation';
 end if;
 if new.status <> old.status then
  if old.status = 'pending' and new.status in ('approved','rejected') and new.kind = 'approval' then
   if auth.uid() is null or new.decided_by is distinct from auth.uid()
    or not private.has_organization_permission(new.organization_id, private.approval_required_permission(new.action)) then
    raise exception '只有具备相应权限的人类成员可以批准或拒绝' using errcode='42501';
   end if;
   new.decided_at := now();
  elsif old.status = 'pending' and new.status = 'answered' and new.kind = 'question' then
   if auth.uid() is null or new.decided_by is distinct from auth.uid()
    or not private.has_organization_permission(new.organization_id, 'content.manage') then
    raise exception '只有具备创作权限的人类成员可以回答' using errcode='42501';
   end if;
   new.decided_at := now();
  elsif old.status in ('pending','approved') and new.status = 'expired' then
   null;
  else
   raise exception '非法批准状态迁移: % -> %', old.status, new.status using errcode='check_violation';
  end if;
 elsif new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at
  or new.answer is distinct from old.answer then
  raise exception '决定信息不可单独修改' using errcode='check_violation';
 end if;
 new.updated_at := now();
 return new;
end; $$;
revoke all on function private.guard_approval_request() from public, anon, authenticated;
create trigger approval_request_guard before insert or update on public.approval_requests
 for each row execute function private.guard_approval_request();

alter table public.approval_requests enable row level security;
revoke all on public.approval_requests from anon, authenticated, service_role;
grant select on public.approval_requests to authenticated, service_role;
create policy approval_requests_read on public.approval_requests for select to authenticated
 using ((select private.has_organization_permission(organization_id,'content.view')));

-- Create a pending request. Humans need content.manage; service_role (worker) must name its job.
create function public.create_approval_request(
 p_organization_id uuid, p_action text, p_target_type text, p_target_id text,
 p_target_revision integer default null, p_summary text default '', p_payload jsonb default '{}'::jsonb,
 p_estimated_cost_cents integer default null, p_requested_by_job uuid default null
) returns public.approval_requests language plpgsql security definer set search_path='' as $$
declare a public.approval_requests; current_rev integer;
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
 current_rev := private.current_target_revision(p_target_type, p_target_id);
 if p_target_type in ('content_document','content_publication') and (current_rev is null or current_rev is distinct from p_target_revision) then
  raise exception '目标不存在或版本已变化' using errcode='check_violation';
 end if;
 select * into a from public.approval_requests
 where organization_id = p_organization_id and action = p_action and target_type = p_target_type and target_id = p_target_id
  and coalesce(target_revision,0) = coalesce(p_target_revision,0) and status = 'pending';
 if found then return a; end if;
 insert into public.approval_requests(organization_id, action, target_type, target_id, target_revision, summary, payload,
  estimated_cost_cents, requested_by_job, requested_by)
 values (p_organization_id, p_action, p_target_type, p_target_id, p_target_revision, coalesce(p_summary,''), coalesce(p_payload,'{}'::jsonb),
  p_estimated_cost_cents, p_requested_by_job, auth.uid())
 returning * into a;
 return a;
end; $$;
revoke all on function public.create_approval_request(uuid,text,text,text,integer,text,jsonb,integer,uuid) from public, anon;
grant execute on function public.create_approval_request(uuid,text,text,text,integer,text,jsonb,integer,uuid) to authenticated, service_role;

-- Human decision. Not executable by service_role at all.
create function public.decide_approval_request(p_request_id uuid, p_decision text, p_reason text default '')
returns public.approval_requests language plpgsql security definer set search_path='' as $$
declare a public.approval_requests; current_rev integer;
begin
 if auth.uid() is null or coalesce(auth.role(),'') <> 'authenticated' then
  raise exception '只有登录的人类成员可以决定批准请求' using errcode='42501';
 end if;
 if p_decision not in ('approved','rejected') then raise exception '无效的决定' using errcode='check_violation'; end if;
 select * into a from public.approval_requests where id = p_request_id for update;
 if not found or a.kind <> 'approval' or not private.has_organization_permission(a.organization_id, private.approval_required_permission(a.action)) then
  raise exception '批准请求不存在或没有权限' using errcode='42501';
 end if;
 if a.status <> 'pending' then raise exception '该请求已处理（%）', a.status using errcode='check_violation'; end if;
 current_rev := private.current_target_revision(a.target_type, a.target_id);
 if a.expires_at <= now() or (a.target_type in ('content_document','content_publication') and a.target_revision is distinct from current_rev) then
  update public.approval_requests set status = 'expired' where id = a.id;
  return (select r from public.approval_requests r where r.id = a.id);
 end if;
 if p_decision = 'rejected' and btrim(coalesce(p_reason,'')) = '' then raise exception '请填写拒绝原因' using errcode='check_violation'; end if;
 update public.approval_requests set status = p_decision, decided_by = auth.uid(), reason = coalesce(p_reason,'')
 where id = a.id returning * into a;
 insert into public.audit_events(organization_id, actor_user_id, action, target_type, target_id, metadata)
 values (a.organization_id, auth.uid(), 'approval.' || p_decision, 'approval_request', a.id::text,
  jsonb_build_object('action', a.action, 'target_type', a.target_type, 'target_id', a.target_id, 'target_revision', a.target_revision));
 return a;
end; $$;
revoke all on function public.decide_approval_request(uuid,text,text) from public, anon, service_role;
grant execute on function public.decide_approval_request(uuid,text,text) to authenticated;

-- Agent question: the worker (service_role) asks on behalf of a running job and parks it as blocked_needs_human.
-- question = {"title": text, "options": [text], "recommended": text?, "detail": text?}
create function public.ask_question(p_job_id uuid, p_question jsonb)
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
 select * into a from public.approval_requests where requested_by_job = j.id and kind = 'question' and status = 'pending';
 if found then return a; end if;
 insert into public.approval_requests(organization_id, kind, target_type, target_id, target_revision, question, summary, requested_by_job)
 values (j.organization_id, 'question', j.target_type, j.target_id, j.target_revision, p_question, left(p_question->>'title', 2000), j.id)
 returning * into a;
 update public.agent_jobs set status = 'blocked_needs_human', error = '等待人工回答', error_code = 'needs_answer' where id = j.id;
 return a;
end; $$;
revoke all on function public.ask_question(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.ask_question(uuid,jsonb) to service_role;

-- Human answer. Not executable by service_role. Re-queues the asking job when it is still parked.
create function public.answer_question(p_request_id uuid, p_answer jsonb)
returns public.approval_requests language plpgsql security definer set search_path='' as $$
declare a public.approval_requests;
begin
 if auth.uid() is null or coalesce(auth.role(),'') <> 'authenticated' then
  raise exception '只有登录的人类成员可以回答' using errcode='42501';
 end if;
 if jsonb_typeof(p_answer) is distinct from 'object' or coalesce(char_length(btrim(p_answer->>'text')),0) not between 1 and 4000 then
  raise exception '回答不能为空' using errcode='check_violation';
 end if;
 select * into a from public.approval_requests where id = p_request_id for update;
 if not found or a.kind <> 'question' or not private.has_organization_permission(a.organization_id, 'content.manage') then
  raise exception '问题不存在或没有权限' using errcode='42501';
 end if;
 if a.status <> 'pending' then raise exception '该问题已处理（%）', a.status using errcode='check_violation'; end if;
 update public.approval_requests set status = 'answered', answer = p_answer, decided_by = auth.uid() where id = a.id returning * into a;
 update public.agent_jobs set status = 'queued', run_after = now(), error = null, error_code = null
 where id = a.requested_by_job and status = 'blocked_needs_human' and error_code = 'needs_answer';
 insert into public.audit_events(organization_id, actor_user_id, action, target_type, target_id, metadata)
 values (a.organization_id, auth.uid(), 'question.answered', 'approval_request', a.id::text, jsonb_build_object('job_id', a.requested_by_job));
 return a;
end; $$;
revoke all on function public.answer_question(uuid,jsonb) from public, anon, service_role;
grant execute on function public.answer_question(uuid,jsonb) to authenticated;

-- Revision bump => earlier approvals for that document expire immediately.
create function private.expire_stale_document_approvals() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.revision <> old.revision then
  update public.approval_requests set status = 'expired'
  where organization_id = new.organization_id and kind = 'approval' and status in ('pending','approved')
   and ((target_type = 'content_document' and target_id = new.id::text)
     or (target_type = 'content_publication' and target_id in (select p.id::text from public.content_publications p where p.document_id = new.id)))
   and coalesce(target_revision, 0) < new.revision;
 end if;
 return new;
end; $$;
revoke all on function private.expire_stale_document_approvals() from public, anon, authenticated;
create trigger document_expire_approvals after update on public.content_documents
 for each row execute function private.expire_stale_document_approvals();

-- Mandate on the job queue: gated job types need a valid approval to be queued / run / succeed.
create function private.enforce_job_mandate() returns trigger language plpgsql security definer set search_path='' as $$
declare mandate_action text := private.job_type_mandate_action(new.job_type);
begin
 if mandate_action is null or new.status not in ('queued','running','succeeded') then return new; end if;
 if tg_op = 'UPDATE' and new.status = old.status and new.approval_request_id is not distinct from old.approval_request_id then
  -- heartbeats on an already-validated running job
  return new;
 end if;
 if new.approval_request_id is null or new.target_type is null or new.target_id is null
  or not private.approval_is_valid(new.approval_request_id, new.organization_id, mandate_action, new.target_type, new.target_id) then
  if tg_op = 'INSERT' or new.status = 'succeeded' then
   raise exception '任务 [%] 需要针对同一对象与版本的有效人工批准 (Mandate)', new.job_type using errcode='42501';
  end if;
  -- Approval expired / revision changed while queued: park the job for a human instead of
  -- aborting the worker's claim transaction.
  new.status := 'blocked_needs_human'; new.locked_by := null; new.locked_until := null;
  new.error := '人工批准已失效（版本变化或过期），请重新批准'; new.error_code := 'mandate_invalid';
 end if;
 return new;
end; $$;
revoke all on function private.enforce_job_mandate() from public, anon, authenticated;
create trigger agent_job_mandate before insert or update on public.agent_jobs
 for each row execute function private.enforce_job_mandate();
