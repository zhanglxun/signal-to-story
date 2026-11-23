-- DB3 (0.5): Chat storage (docs/database.md §4.5, invariant 8). The loop and the HTTP/SSE entry come with R3.
--   * chat_sessions: one conversation, owned by one member, optionally on a work item card.
--   * chat_messages: append-only. A human writes only `user` messages via send_chat_message; `assistant`
--     messages come only from a runner node holding a running chat_turn job for that session
--     (node_append_chat_message). seq and created_at are assigned by the server under the session row lock.

create table public.chat_sessions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 work_item_id uuid,
 title text not null default '' check (char_length(title) <= 200),
 exec_session jsonb not null default '{}'::jsonb check (jsonb_typeof(exec_session) = 'object' and pg_column_size(exec_session) <= 16384),
 last_seq integer not null default 0 check (last_seq >= 0),
 archived_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (organization_id, id),
 foreign key (organization_id, work_item_id) references public.work_items(organization_id, id) on delete set null (work_item_id)
);
comment on table public.chat_sessions is 'Chat 会话。可挂在某张事项卡上；exec_session 存 CLI / 模型会话信息（由节点写）。';
create index chat_sessions_owner_idx on public.chat_sessions (organization_id, owner_id, updated_at desc);
create index chat_sessions_work_item_idx on public.chat_sessions (organization_id, work_item_id) where work_item_id is not null;

create table public.chat_messages (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 session_id uuid not null,
 seq integer not null check (seq >= 1),
 role text not null check (role in ('user','assistant','system','tool')),
 content text not null check (char_length(content) <= 200000),
 agent_job_id uuid,
 created_at timestamptz not null default now(),
 unique (organization_id, id),
 unique (session_id, seq),
 foreign key (organization_id, session_id) references public.chat_sessions(organization_id, id) on delete cascade,
 foreign key (organization_id, agent_job_id) references public.agent_jobs(organization_id, id) on delete set null (agent_job_id)
);
comment on table public.chat_messages is 'Chat 消息，只追加。user 消息只能经 send_chat_message 写入；assistant 消息只能由执行节点写入。';
create index chat_messages_job_idx on public.chat_messages (organization_id, agent_job_id) where agent_job_id is not null;

-- Session guard: owner and organization are fixed; only title / work item / archive state change from the browser.
create function private.guard_chat_session() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op = 'INSERT' then
  if auth.uid() is not null then new.owner_id := auth.uid(); end if;
  new.last_seq := 0; new.created_at := now(); new.updated_at := now();
  if new.work_item_id is not null and not exists (select 1 from public.work_items w where w.id = new.work_item_id and w.organization_id = new.organization_id) then
   raise exception '事项不存在或不属于该组织' using errcode='check_violation';
  end if;
  return new;
 end if;
 if new.organization_id is distinct from old.organization_id or new.owner_id is distinct from old.owner_id
  or new.created_at is distinct from old.created_at then
  raise exception '会话归属不可修改' using errcode='check_violation';
 end if;
 if coalesce(current_setting('app.chat_write', true), '') <> 'on'
  and (new.last_seq is distinct from old.last_seq or new.exec_session is distinct from old.exec_session) then
  raise exception '会话序号与执行信息只能由服务端写入' using errcode='42501';
 end if;
 new.updated_at := now();
 return new;
end; $$;
revoke all on function private.guard_chat_session() from public, anon, authenticated;
create trigger chat_session_guard before insert or update on public.chat_sessions
 for each row execute function private.guard_chat_session();

alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_sessions, public.chat_messages from anon, authenticated, service_role;
grant select, delete on public.chat_sessions to authenticated;
grant insert (organization_id, work_item_id, title) on public.chat_sessions to authenticated;
grant update (work_item_id, title, archived_at) on public.chat_sessions to authenticated;
grant select on public.chat_messages to authenticated;
grant select on public.chat_sessions, public.chat_messages to service_role;

create policy chat_sessions_read on public.chat_sessions for select to authenticated
 using (owner_id = (select auth.uid()) and (select private.has_organization_permission(organization_id, 'content.view')));
create policy chat_sessions_insert on public.chat_sessions for insert to authenticated
 with check ((select private.has_organization_permission(organization_id, 'content.view')));
create policy chat_sessions_update on public.chat_sessions for update to authenticated
 using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy chat_sessions_delete on public.chat_sessions for delete to authenticated
 using (owner_id = (select auth.uid()));
create policy chat_messages_read on public.chat_messages for select to authenticated
 using (exists (select 1 from public.chat_sessions s where s.id = session_id and s.owner_id = (select auth.uid())));

create function private.append_chat_message(p_session public.chat_sessions, p_role text, p_content text, p_job uuid)
returns public.chat_messages language plpgsql security definer set search_path='' as $$
declare m public.chat_messages; v_seq integer := p_session.last_seq + 1;
begin
 if char_length(coalesce(p_content, '')) not between 1 and 200000 then
  raise exception '消息内容需为 1–200000 字' using errcode='check_violation';
 end if;
 perform set_config('app.chat_write', 'on', true);
 update public.chat_sessions set last_seq = v_seq where id = p_session.id;
 perform set_config('app.chat_write', 'off', true);
 insert into public.chat_messages(organization_id, session_id, seq, role, content, agent_job_id)
 values (p_session.organization_id, p_session.id, v_seq, p_role, p_content, p_job)
 returning * into m;
 return m;
end; $$;
revoke all on function private.append_chat_message(public.chat_sessions, text, text, uuid) from public, anon, authenticated;

-- A human sends a message; with p_run_agent the matching chat_turn job is queued in the same transaction.
create function public.send_chat_message(p_session_id uuid, p_content text, p_run_agent boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.chat_sessions; m public.chat_messages; j public.agent_jobs;
begin
 if auth.uid() is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
  raise exception '需要登录' using errcode='42501';
 end if;
 select * into s from public.chat_sessions where id = p_session_id for update;
 if not found or s.owner_id <> auth.uid() or not private.has_organization_permission(s.organization_id, 'content.view') then
  raise exception '会话不存在或没有权限' using errcode='42501';
 end if;
 if s.archived_at is not null then raise exception '会话已归档' using errcode='check_violation'; end if;
 m := private.append_chat_message(s, 'user', p_content, null);
 if p_run_agent then
  j := public.enqueue_agent_job(s.organization_id, 'chat_turn', 'chat_turn:' || m.id::text,
   jsonb_build_object('schema_version', 1, 'session_id', s.id, 'message_id', m.id, 'seq', m.seq),
   'chat_session', s.id::text, null, null, 1, null, s.work_item_id);
  update public.chat_messages set agent_job_id = j.id where id = m.id;
  m.agent_job_id := j.id;
 end if;
 return jsonb_build_object('message_id', m.id, 'seq', m.seq, 'agent_job_id', m.agent_job_id);
end; $$;
revoke all on function public.send_chat_message(uuid, text, boolean) from public, anon, service_role;
grant execute on function public.send_chat_message(uuid, text, boolean) to authenticated;

-- The node answers: only for a running chat_turn job it holds, bound to this session.
create function public.node_append_chat_message(p_token text, p_job_id uuid, p_lease_epoch bigint, p_content text, p_exec_session jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs := private.node_job(p_token, p_job_id); s public.chat_sessions; m public.chat_messages;
begin
 if j.lease_epoch is distinct from p_lease_epoch then raise exception '任务租约已失效（lease_epoch 不匹配），拒绝写入' using errcode='P0002'; end if;
 if j.kind <> 'chat_turn' then raise exception '只有 Chat 回合任务可以写入回复' using errcode='42501'; end if;
 select * into s from public.chat_sessions
 where id::text = j.payload->>'session_id' and organization_id = j.organization_id for update;
 if not found then raise exception '会话不存在' using errcode='P0002'; end if;
 m := private.append_chat_message(s, 'assistant', p_content, j.id);
 if p_exec_session is not null then
  if jsonb_typeof(p_exec_session) <> 'object' or pg_column_size(p_exec_session) > 16384 then
   raise exception '会话执行信息格式无效' using errcode='check_violation';
  end if;
  perform set_config('app.chat_write', 'on', true);
  update public.chat_sessions set exec_session = p_exec_session where id = s.id;
  perform set_config('app.chat_write', 'off', true);
 end if;
 return jsonb_build_object('message_id', m.id, 'seq', m.seq);
end; $$;
revoke all on function public.node_append_chat_message(text, uuid, bigint, text, jsonb) from public;
grant execute on function public.node_append_chat_message(text, uuid, bigint, text, jsonb) to anon, authenticated, service_role;
