-- DB3b (docs/tasks/db3b-chat-runtime-catalog.md, docs/modules/chat.md §2.3–2.6, §3.4): chat turns become correct
-- and structured, and nodes publish a runtime catalog.
--   0. Turn correctness: chat_messages.reply_to_message_id, one assistant message per job (idempotent append),
--      one active turn per session, chat_turn max_attempts = 1, max_rounds default 8 (≤ 20),
--      budget_cents default 50 clamped to 1–500, node_append_chat_message(p_finish) appends and completes atomically.
--   1. chat_messages.parts (structured fragments) and status (completed / cancelled / error).
--   2. chat_sessions.runtime_config (browser-updatable column).
--   3. send_chat_message(p_parts, p_runtime, p_target_node_id) and regenerate_chat_turn.
--   4. node_chat_context; node_append_chat_message(p_parts, p_status, p_finish, p_title).
--   5. runner_nodes.capabilities + node_report_capabilities; node_claim honours payload.target_node_id;
--      node_claim_job (HTTP entry claims one chat_turn by id); unclaimed chat turns expire after 10 minutes.
--   6. chat_messages joins the supabase_realtime publication (when it exists).
-- Functions whose signature changes are dropped first, so PostgREST never sees two overloads.

-- ── 0. Signatures that change ──
drop function public.send_chat_message(uuid, text, boolean);
drop function public.node_append_chat_message(text, uuid, bigint, text, jsonb);
drop function private.append_chat_message(public.chat_sessions, text, text, uuid);

-- ── 1. chat_messages: parts, status, reply_to_message_id ──
alter table public.chat_messages
 add column parts jsonb not null default '[]'::jsonb,
 add column status text not null default 'completed',
 add column reply_to_message_id uuid;
alter table public.chat_messages
 add constraint chat_messages_parts_check check (jsonb_typeof(parts) = 'array' and pg_column_size(parts) <= 262144),
 add constraint chat_messages_status_check check (status in ('completed','cancelled','error')),
 add constraint chat_messages_reply_to_role_check check (reply_to_message_id is null or role = 'assistant'),
 add constraint chat_messages_reply_to_fkey foreign key (organization_id, reply_to_message_id)
  references public.chat_messages(organization_id, id) on delete set null (reply_to_message_id);
-- A job writes at most one assistant message; a retried append returns that row instead of adding another.
create unique index chat_messages_one_reply_per_job on public.chat_messages (agent_job_id)
 where role = 'assistant' and agent_job_id is not null;
create index chat_messages_reply_to_idx on public.chat_messages (session_id, reply_to_message_id)
 where reply_to_message_id is not null;
comment on column public.chat_messages.parts is '结构化片段（reasoning / plan / tool_call / permission / error / context_ref），界面还原用；模型上下文只用 content。';
comment on column public.chat_messages.reply_to_message_id is '助手消息回复的 user 消息；重新生成的多个版本指向同一条。';

-- ── 2. chat_sessions.runtime_config (the browser may change it, like title) ──
alter table public.chat_sessions
 add column runtime_config jsonb not null default '{}'::jsonb
  check (jsonb_typeof(runtime_config) = 'object' and pg_column_size(runtime_config) <= 8192);
grant insert (runtime_config), update (runtime_config) on public.chat_sessions to authenticated;
comment on column public.chat_sessions.runtime_config is '上次选用的节点 / 运行时 / 模型 / 推理强度，例如 {node_id, runtime_id, driver_kind, model, thinking_effort}。';

-- ── 3. agent_jobs: chat_turn limits, target node, one active turn per session ──
alter table public.agent_jobs drop constraint agent_jobs_payload_limits_check;
alter table public.agent_jobs
 add constraint agent_jobs_payload_limits_check check (
  jsonb_typeof(payload->'limits') = 'object'
  and case when jsonb_typeof(payload->'limits'->'max_rounds') = 'number' and (payload->'limits'->>'max_rounds') ~ '^[0-9]{1,2}$'
       then (payload->'limits'->>'max_rounds')::integer between 1 and (case when kind = 'chat_turn' then 20 else 5 end) else false end
  and case when jsonb_typeof(payload->'limits'->'max_hops') = 'number' and (payload->'limits'->>'max_hops') ~ '^[0-9]{1,2}$'
       then (payload->'limits'->>'max_hops')::integer between 2 and 32 else false end
  and case when jsonb_typeof(payload->'limits'->'budget_cents') = 'number' and (payload->'limits'->>'budget_cents') ~ '^[0-9]{1,7}$'
       then (payload->'limits'->>'budget_cents')::integer between 0 and 1000000 else false end
  and case when not (payload->'limits' ? 'token_budget') then true
       else jsonb_typeof(payload->'limits'->'token_budget') = 'number' and (payload->'limits'->>'token_budget') ~ '^[1-9][0-9]{0,8}$' end
 ),
 add constraint agent_jobs_payload_target_node_check check (
  not (payload ? 'target_node_id') or (jsonb_typeof(payload->'target_node_id') = 'string'
   and (payload->>'target_node_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
-- Backstop for the session-lock check in send_chat_message / regenerate_chat_turn.
create unique index agent_jobs_one_active_chat_turn on public.agent_jobs (organization_id, (payload->'target'->>'id'))
 where kind = 'chat_turn' and status in ('queued','running') and payload ? 'target';

-- Every chat_turn, however it is enqueued: no automatic retry (the user regenerates instead), budget within 1–500.
create function private.chat_turn_job_defaults() returns trigger language plpgsql set search_path='' as $$
declare v_budget integer;
begin
 new.max_attempts := 1;
 if jsonb_typeof(new.payload->'limits'->'budget_cents') = 'number' and (new.payload->'limits'->>'budget_cents') ~ '^[0-9]{1,7}$' then
  v_budget := least(greatest((new.payload->'limits'->>'budget_cents')::integer, 1), 500);
  new.payload := jsonb_set(new.payload, '{limits,budget_cents}', to_jsonb(v_budget));
 end if;
 return new;
end; $$;
revoke all on function private.chat_turn_job_defaults() from public, anon, authenticated;
create trigger agent_job_chat_turn_defaults before insert on public.agent_jobs
 for each row when (new.kind = 'chat_turn') execute function private.chat_turn_job_defaults();

-- Limits of one turn from the caller's runtime: max_rounds default 8 (1–20), budget_cents default 50 (1–500).
create function private.chat_turn_limit(p_runtime jsonb, p_key text, p_default integer, p_min integer, p_max integer) returns integer
language sql immutable set search_path='' as $$
 select least(greatest(case when jsonb_typeof(p_runtime->p_key) = 'number' and (p_runtime->>p_key) ~ '^[0-9]{1,7}$'
  then (p_runtime->>p_key)::integer else p_default end, p_min), p_max)
$$;
revoke all on function private.chat_turn_limit(jsonb, text, integer, integer, integer) from public, anon, authenticated;

-- A turn nobody claimed within 10 minutes (page closed, node offline) fails, so the session is not stuck behind it.
-- With p_session_id the expired leases of that session's turns are released too (a node crashed mid-turn).
create function private.expire_chat_turns(p_organization_id uuid, p_session_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.agent_jobs set status = 'failed', error = '回合超过 10 分钟无节点认领，已作废', error_code = 'chat_turn_unclaimed',
  notified_at = now()  -- shown in the chat, not sent as an IM notice
 where organization_id = p_organization_id and kind = 'chat_turn' and status = 'queued'
  and created_at < now() - interval '10 minutes'
  and (p_session_id is null or payload->'target'->>'id' = p_session_id::text);
 if p_session_id is not null then
  update public.agent_jobs set
   status = case when cancel_requested_at is not null then 'cancelled' when attempts >= max_attempts then 'failed' else 'queued' end,
   error = case when cancel_requested_at is not null then '人工取消' when attempts >= max_attempts then '执行租约过期且已无剩余重试次数' else '执行租约过期，已重新排队' end,
   error_code = 'lease_expired'
  where organization_id = p_organization_id and kind = 'chat_turn' and status = 'running' and locked_until < now()
   and payload->'target'->>'id' = p_session_id::text;
 end if;
end; $$;
revoke all on function private.expire_chat_turns(uuid, uuid) from public, anon, authenticated;

-- ── 4. Append (server only): seq under the session lock, parts / status / reply_to ──
create function private.append_chat_message(
 p_session public.chat_sessions, p_role text, p_content text, p_job uuid,
 p_parts jsonb default '[]'::jsonb, p_status text default 'completed', p_reply_to uuid default null
) returns public.chat_messages language plpgsql security definer set search_path='' as $$
declare m public.chat_messages; v_seq integer := p_session.last_seq + 1; v_parts jsonb := coalesce(p_parts, '[]'::jsonb);
begin
 if jsonb_typeof(v_parts) <> 'array' or pg_column_size(v_parts) > 262144 then
  raise exception '消息片段 parts 必须是不超过 256KB 的数组' using errcode='check_violation';
 end if;
 if coalesce(p_status, '') not in ('completed','cancelled','error') then
  raise exception '无效的消息状态 %', p_status using errcode='check_violation';
 end if;
 -- An interrupted or failed reply, or one carried by its parts, may have empty text; otherwise 1–200000 characters.
 if char_length(coalesce(p_content, '')) > 200000
  or (char_length(coalesce(p_content, '')) = 0
      and not (p_role = 'assistant' and (p_status <> 'completed' or jsonb_array_length(v_parts) > 0))) then
  raise exception '消息内容需为 1–200000 字' using errcode='check_violation';
 end if;
 if p_reply_to is not null and not exists (
  select 1 from public.chat_messages u where u.id = p_reply_to and u.session_id = p_session.id and u.role = 'user') then
  raise exception '回复必须指向本会话的用户消息' using errcode='check_violation';
 end if;
 perform set_config('app.chat_write', 'on', true);
 update public.chat_sessions set last_seq = v_seq where id = p_session.id;
 perform set_config('app.chat_write', 'off', true);
 insert into public.chat_messages(organization_id, session_id, seq, role, content, agent_job_id, parts, status, reply_to_message_id)
 values (p_session.organization_id, p_session.id, v_seq, p_role, coalesce(p_content, ''), p_job, v_parts, p_status, p_reply_to)
 returning * into m;
 return m;
end; $$;
revoke all on function private.append_chat_message(public.chat_sessions, text, text, uuid, jsonb, text, uuid) from public, anon, authenticated;

-- Session the caller may chat in, locked. Shared by send_chat_message and regenerate_chat_turn.
create function private.lock_own_chat_session(p_session_id uuid) returns public.chat_sessions
language plpgsql security definer set search_path='' as $$
declare s public.chat_sessions;
begin
 if auth.uid() is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
  raise exception '需要登录' using errcode='42501';
 end if;
 select * into s from public.chat_sessions where id = p_session_id for update;
 if not found or s.owner_id <> auth.uid() or not private.has_organization_permission(s.organization_id, 'content.view') then
  raise exception '会话不存在或没有权限' using errcode='42501';
 end if;
 if s.archived_at is not null then raise exception '会话已归档' using errcode='check_violation'; end if;
 return s;
end; $$;
revoke all on function private.lock_own_chat_session(uuid) from public, anon, authenticated;

-- Queue one chat_turn for a user message (caller holds the session lock and passed lock_own_chat_session).
-- p_target_node_id is filled in by the node that received the HTTP request (its own id), never by the browser.
create function private.enqueue_chat_turn(
 s public.chat_sessions, p_message public.chat_messages, p_key text, p_runtime jsonb, p_target_node_id uuid, p_regenerate boolean
) returns public.agent_jobs language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs; v_payload jsonb;
begin
 if p_runtime is not null and (jsonb_typeof(p_runtime) <> 'object' or pg_column_size(p_runtime) > 8192) then
  raise exception '运行时参数 runtime 必须是不超过 8KB 的 JSON 对象' using errcode='check_violation';
 end if;
 if p_target_node_id is not null and not exists (
  select 1 from public.runner_nodes n where n.id = p_target_node_id and n.organization_id = s.organization_id and n.revoked_at is null) then
  raise exception '目标节点不存在、已吊销或不属于该组织' using errcode='check_violation';
 end if;
 perform private.expire_chat_turns(s.organization_id, s.id);
 if exists (select 1 from public.agent_jobs a where a.organization_id = s.organization_id and a.kind = 'chat_turn'
   and a.payload->'target'->>'id' = s.id::text and a.status in ('queued','running')) then
  raise exception '上一轮还在生成，请等它结束或先停止' using errcode='unique_violation', hint='turn_in_progress';
 end if;
 v_payload := jsonb_build_object('schema_version', 1, 'session_id', s.id, 'message_id', p_message.id, 'seq', p_message.seq)
  || case when p_runtime is not null then jsonb_build_object('runtime', p_runtime) else '{}'::jsonb end
  || case when p_target_node_id is not null then jsonb_build_object('target_node_id', p_target_node_id) else '{}'::jsonb end
  || case when p_regenerate then jsonb_build_object('regenerate', true) else '{}'::jsonb end;
 -- enqueue_agent_job checks agent.dispatch and the card.
 j := public.enqueue_agent_job(s.organization_id, 'chat_turn', p_key, v_payload, 'chat_session', s.id::text, null,
  private.chat_turn_limit(p_runtime, 'budget_cents', 50, 1, 500), private.chat_turn_limit(p_runtime, 'max_rounds', 8, 1, 20),
  null, s.work_item_id);
 if p_runtime is not null then
  update public.chat_sessions set runtime_config = (p_runtime - 'budget_cents' - 'max_rounds')
   || case when p_target_node_id is not null then jsonb_build_object('node_id', p_target_node_id) else '{}'::jsonb end
  where id = s.id;
 end if;
 return j;
end; $$;
revoke all on function private.enqueue_chat_turn(public.chat_sessions, public.chat_messages, text, jsonb, uuid, boolean) from public, anon, authenticated;

-- ── 5. Human RPCs ──
-- A human sends a message; with p_run_agent the matching chat_turn job is queued in the same transaction.
create function public.send_chat_message(
 p_session_id uuid, p_content text, p_run_agent boolean default false,
 p_parts jsonb default '[]'::jsonb, p_runtime jsonb default null, p_target_node_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.chat_sessions := private.lock_own_chat_session(p_session_id); m public.chat_messages; j public.agent_jobs;
begin
 m := private.append_chat_message(s, 'user', p_content, null, p_parts, 'completed', null);
 if p_run_agent then
  j := private.enqueue_chat_turn(s, m, 'chat_turn:' || m.id::text, p_runtime, p_target_node_id, false);
  update public.chat_messages set agent_job_id = j.id where id = m.id;
  m.agent_job_id := j.id;
 end if;
 return jsonb_build_object('message_id', m.id, 'seq', m.seq, 'agent_job_id', m.agent_job_id);
end; $$;
revoke all on function public.send_chat_message(uuid, text, boolean, jsonb, jsonb, uuid) from public, anon, service_role;
grant execute on function public.send_chat_message(uuid, text, boolean, jsonb, jsonb, uuid) to authenticated;

-- Retry / regenerate the answer to an existing user message: no new user message, a new chat_turn job.
-- The user message keeps its first agent_job_id; turns are tied to replies by agent_job_id + reply_to_message_id.
create function public.regenerate_chat_turn(
 p_session_id uuid, p_user_message_id uuid, p_runtime jsonb default null, p_target_node_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.chat_sessions := private.lock_own_chat_session(p_session_id); m public.chat_messages; j public.agent_jobs;
begin
 select * into m from public.chat_messages where id = p_user_message_id and session_id = s.id and role = 'user';
 if not found then raise exception '要重新生成的用户消息不存在或不属于该会话' using errcode='check_violation'; end if;
 j := private.enqueue_chat_turn(s, m, 'chat_turn:regen:' || gen_random_uuid()::text, p_runtime, p_target_node_id, true);
 return jsonb_build_object('message_id', m.id, 'seq', m.seq, 'agent_job_id', j.id);
end; $$;
revoke all on function public.regenerate_chat_turn(uuid, uuid, jsonb, uuid) from public, anon, service_role;
grant execute on function public.regenerate_chat_turn(uuid, uuid, jsonb, uuid) to authenticated;

-- ── 6. Node side of a chat turn ──
-- The session and user message a chat_turn job answers. The session must belong to the job's creator, so a job
-- enqueued by hand cannot point a node at someone else's conversation.
create function private.chat_turn_target(j public.agent_jobs, p_lock boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.chat_sessions; u public.chat_messages;
begin
 if j.kind <> 'chat_turn' then raise exception '只有 Chat 回合任务可以访问会话' using errcode='42501'; end if;
 if p_lock then
  select * into s from public.chat_sessions
  where id::text = j.payload->>'session_id' and organization_id = j.organization_id and owner_id = j.created_by for update;
 else
  select * into s from public.chat_sessions
  where id::text = j.payload->>'session_id' and organization_id = j.organization_id and owner_id = j.created_by;
 end if;
 if not found then raise exception '会话不存在' using errcode='P0002'; end if;
 select * into u from public.chat_messages where id::text = j.payload->>'message_id' and session_id = s.id and role = 'user';
 if not found then raise exception '回合对应的用户消息不存在' using errcode='P0002'; end if;
 return jsonb_build_object('session', to_jsonb(s), 'message', to_jsonb(u));
end; $$;
revoke all on function private.chat_turn_target(public.agent_jobs, boolean) from public, anon, authenticated;

-- History for the turn the node holds: messages up to the turn's user message (a regenerated turn never sees the
-- reply it replaces or anything after it); for each earlier user message only its latest completed reply.
-- parts are returned for display only — the model context uses content. Token trimming happens in workers/agent/loop.
create function public.node_chat_context(p_token text, p_job_id uuid, p_limit integer default 40) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.agent_jobs := private.node_job(p_token, p_job_id); t jsonb; s public.chat_sessions; u public.chat_messages;
 v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100); w jsonb; docs jsonb;
begin
 t := private.chat_turn_target(j, false);
 s := jsonb_populate_record(null::public.chat_sessions, t->'session');
 u := jsonb_populate_record(null::public.chat_messages, t->'message');
 if s.work_item_id is not null then
  select jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'brief', x.brief, 'status', x.status) into w
  from public.work_items x where x.id = s.work_item_id and x.organization_id = s.organization_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'platform', d.platform, 'title', d.title, 'status', d.status,
    'revision', d.revision, 'excerpt', left(d.body, 500), 'updated_at', d.updated_at) order by d.updated_at desc), '[]'::jsonb) into docs
  from (select * from public.content_documents where organization_id = s.organization_id and work_item_id = s.work_item_id
        order by updated_at desc limit 20) d;
 end if;
 return jsonb_build_object(
  'turn', jsonb_build_object('job_id', j.id, 'user_message_id', u.id, 'seq', u.seq, 'runtime', j.payload->'runtime',
    'limits', j.payload->'limits', 'target_node_id', j.payload->'target_node_id', 'regenerate', coalesce((j.payload->>'regenerate')::boolean, false)),
  'session', jsonb_build_object('id', s.id, 'title', s.title, 'work_item_id', s.work_item_id, 'exec_session', s.exec_session,
    'runtime_config', s.runtime_config, 'last_seq', s.last_seq),
  'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'seq', v.seq, 'role', v.role, 'content', v.content,
      'parts', v.parts, 'status', v.status, 'reply_to_message_id', v.reply_to_message_id, 'created_at', v.created_at)
      order by v.anchor, v.seq), '[]'::jsonb)
    from (
     select h.* from (
      select m.*, coalesce(p.seq, m.seq) as anchor
      from public.chat_messages m
      left join public.chat_messages p on p.id = m.reply_to_message_id
      where m.session_id = s.id
       and case
        when m.reply_to_message_id is null then m.seq <= u.seq
        -- replies to earlier user messages: only the latest completed version of each
        else p.seq < u.seq and m.status = 'completed' and m.id = (
         select a.id from public.chat_messages a
         where a.session_id = s.id and a.reply_to_message_id = m.reply_to_message_id and a.role = 'assistant' and a.status = 'completed'
         order by a.seq desc limit 1)
       end
      order by coalesce(p.seq, m.seq) desc, m.seq desc
      limit v_limit) h) v),
  'work_item', w,
  'documents', coalesce(docs, '[]'::jsonb));
end; $$;

-- The node answers the turn it holds. Idempotent per job: a retried call (lost response, crash before the
-- reply was confirmed) returns the existing reply. With p_finish (default) the job completes in the same
-- transaction: completed → succeeded, cancelled → cancelled, error → failed.
-- p_title names the session only while its title is still empty (a title the user set is never overwritten).
create function public.node_append_chat_message(
 p_token text, p_job_id uuid, p_lease_epoch bigint, p_content text, p_exec_session jsonb default null,
 p_parts jsonb default '[]'::jsonb, p_status text default 'completed', p_finish boolean default true, p_title text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.runner_nodes := private.node_from_token(p_token); j public.agent_jobs; t jsonb; s public.chat_sessions;
 m public.chat_messages; v_err jsonb; v_title text := left(btrim(coalesce(p_title, '')), 200);
begin
 -- Same job, same lease: the reply is already there (possibly finished) — return it.
 select * into j from public.agent_jobs where id = p_job_id and organization_id = n.organization_id;
 if found and j.kind = 'chat_turn' and j.lease_epoch = p_lease_epoch then
  select * into m from public.chat_messages where agent_job_id = j.id and role = 'assistant';
  if found then
   return jsonb_build_object('message_id', m.id, 'seq', m.seq, 'status', m.status, 'job_status', j.status, 'existing', true);
  end if;
 end if;
 j := private.node_job(p_token, p_job_id);
 if j.lease_epoch is distinct from p_lease_epoch then raise exception '任务租约已失效（lease_epoch 不匹配），拒绝写入' using errcode='P0002'; end if;
 if j.kind <> 'chat_turn' then raise exception '只有 Chat 回合任务可以写入回复' using errcode='42501'; end if;
 if coalesce(p_status, '') not in ('completed','cancelled','error') then
  raise exception '无效的回复状态 %（应为 completed / cancelled / error）', p_status using errcode='check_violation';
 end if;
 if p_exec_session is not null and (jsonb_typeof(p_exec_session) <> 'object' or pg_column_size(p_exec_session) > 16384) then
  raise exception '会话执行信息格式无效' using errcode='check_violation';
 end if;
 t := private.chat_turn_target(j, true);
 s := jsonb_populate_record(null::public.chat_sessions, t->'session');
 -- A concurrent call for the same job won the session lock first.
 select * into m from public.chat_messages where agent_job_id = j.id and role = 'assistant';
 if found then
  return jsonb_build_object('message_id', m.id, 'seq', m.seq, 'status', m.status, 'job_status', j.status, 'existing', true);
 end if;
 m := private.append_chat_message(s, 'assistant', p_content, j.id, p_parts, p_status, (t->'message'->>'id')::uuid);
 if p_exec_session is not null or (v_title <> '' and s.title = '') then
  perform set_config('app.chat_write', 'on', true);
  update public.chat_sessions set
   exec_session = coalesce(p_exec_session, exec_session),
   title = case when title = '' and v_title <> '' then v_title else title end
  where id = s.id;
  perform set_config('app.chat_write', 'off', true);
 end if;
 if coalesce(p_finish, true) then
  if p_status = 'error' then
   select e.value into v_err from jsonb_array_elements(m.parts) with ordinality e(value, i)
   where jsonb_typeof(e.value) = 'object' and e.value->>'type' = 'error' order by e.i desc limit 1;
  end if;
  j := public.complete_agent_job(j.id, p_lease_epoch,
   case p_status when 'completed' then 'succeeded' when 'cancelled' then 'cancelled' else 'failed' end,
   jsonb_build_object('assistant_message_id', m.id, 'seq', m.seq),
   case p_status when 'cancelled' then '回合已中断'
    when 'error' then left(coalesce(nullif(v_err->>'message', ''), nullif(m.content, ''), '回合出错'), 4000) end,
   case p_status when 'error' then left(coalesce(nullif(v_err->>'code', ''), 'chat_turn_error'), 64) end);
 end if;
 return jsonb_build_object('message_id', m.id, 'seq', m.seq, 'status', m.status, 'job_status', j.status, 'existing', false);
end; $$;

-- ── 7. Runtime catalog on runner_nodes ──
alter table public.runner_nodes
 add column capabilities jsonb not null default '{}'::jsonb
  check (jsonb_typeof(capabilities) = 'object' and pg_column_size(capabilities) <= 32768),
 add column capabilities_updated_at timestamptz;
-- token_hash stays unreadable; the catalog is readable by members like the rest of the row.
grant select (capabilities, capabilities_updated_at) on public.runner_nodes to authenticated;
comment on column public.runner_nodes.capabilities is '节点上报的脱敏能力目录：protocol_version、supports_http_sse、http_endpoint_hint、runtimes[]；不含密钥。';

-- Defensive secret check for the catalog: an object key equal to a credential name (exact match, case-insensitive,
-- '-' = '_'; never a substring, so max_tokens / inputTokens pass) or a string value that looks like a key or token.
create function private.jsonb_has_secret(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 with recursive walk(k, v) as (
  select null::text, p_value
  union all
  select e.k, e.v from walk w, lateral (
   select o.key as k, o.value as v from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v end) o
   union all
   select null::text, a.value from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v end) a
  ) e
 )
 select exists (
  select 1 from walk
  where replace(lower(k), '-', '_') in ('api_key','apikey','secret','password','authorization','access_token','refresh_token')
   or (jsonb_typeof(v) = 'string' and (v #>> '{}') ~* '^\s*(sk-[a-z0-9_-]{8,}|stn_[a-f0-9]{16,}|bearer\s+\S+)'))
$$;
revoke all on function private.jsonb_has_secret(jsonb) from public, anon, authenticated;

create function public.node_report_capabilities(p_token text, p_capabilities jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.runner_nodes := private.node_from_token(p_token); v_at timestamptz;
begin
 if p_capabilities is null or jsonb_typeof(p_capabilities) <> 'object' or pg_column_size(p_capabilities) > 32768 then
  raise exception '能力目录必须是不超过 32KB 的 JSON 对象' using errcode='check_violation';
 end if;
 if jsonb_typeof(p_capabilities->'runtimes') is distinct from 'array' or jsonb_array_length(p_capabilities->'runtimes') > 64 then
  raise exception '能力目录的 runtimes 必须是不超过 64 项的数组' using errcode='check_violation';
 end if;
 if exists (select 1 from jsonb_array_elements(p_capabilities->'runtimes') r
   where jsonb_typeof(r.value) <> 'object' or jsonb_typeof(r.value->'id') is distinct from 'string'
    or (r.value->>'id') !~ '^(api|acp|exec):[a-z0-9._:-]{1,120}$') then
  raise exception '运行时 id 无效（应为 api|acp|exec:小写字母数字与 ._:-）' using errcode='check_violation';
 end if;
 if private.jsonb_has_secret(p_capabilities) then
  raise exception '能力目录疑似包含密钥或令牌，已拒绝' using errcode='check_violation';
 end if;
 update public.runner_nodes set capabilities = p_capabilities, capabilities_updated_at = now(), last_seen_at = now()
 where id = n.id returning capabilities_updated_at into v_at;
 return jsonb_build_object('capabilities_updated_at', v_at);
end; $$;

-- ── 8. Claiming: node_claim honours target_node_id and sweeps unclaimed chat turns; node_claim_job for HTTP ──
create or replace function public.node_claim(p_token text, p_job_types text[], p_lease_seconds integer default 120) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.runner_nodes := private.node_from_token(p_token); j public.agent_jobs; cand uuid; tried uuid[] := '{}';
begin
 if p_lease_seconds is null or p_lease_seconds not between 15 and 3600 then raise exception 'lease_seconds 需在 15–3600 之间'; end if;
 update public.agent_jobs set
  status = case when cancel_requested_at is not null then 'cancelled' when attempts >= max_attempts then 'failed' else 'queued' end,
  error = case when cancel_requested_at is not null then '人工取消' when attempts >= max_attempts then '执行租约过期且已无剩余重试次数' else '执行租约过期，已重新排队' end,
  error_code = 'lease_expired'
 where status = 'running' and locked_until < now() and organization_id = n.organization_id;
 perform private.expire_chat_turns(n.organization_id);

 for i in 1..20 loop
  select q.id into cand from public.agent_jobs q
  where q.organization_id = n.organization_id and q.status = 'queued' and q.kind = any(p_job_types)
   and q.run_after <= now() and not (q.id = any(tried))
   and (not (q.payload ? 'target_node_id') or q.payload->>'target_node_id' = n.id::text)
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

-- The HTTP entry claims the chat_turn it just queued, by id. null = already taken, cancelled, expired, or
-- targeted at another node; the caller answers 409 claim_failed.
create function public.node_claim_job(p_token text, p_job_id uuid, p_lease_seconds integer default 120) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.runner_nodes := private.node_from_token(p_token); j public.agent_jobs;
begin
 if p_lease_seconds is null or p_lease_seconds not between 15 and 3600 then raise exception 'lease_seconds 需在 15–3600 之间'; end if;
 perform private.expire_chat_turns(n.organization_id);
 update public.agent_jobs set status = 'running', lease_epoch = lease_epoch + 1, node_id = n.id,
  locked_until = now() + make_interval(secs => p_lease_seconds), attempts = attempts + 1
 where id = p_job_id and organization_id = n.organization_id and status = 'queued' and kind = 'chat_turn'
  and (not (payload ? 'target_node_id') or payload->>'target_node_id' = n.id::text)
 returning * into j;
 if not found or j.status <> 'running' then return null; end if;
 return to_jsonb(j);
end; $$;

-- ── 9. Grants for the new and recreated node RPCs (publishable key + node token, like DB2c-2) ──
do $grants$
declare f text;
begin
 foreach f in array array[
  'public.node_chat_context(text,uuid,integer)',
  'public.node_append_chat_message(text,uuid,bigint,text,jsonb,jsonb,text,boolean,text)',
  'public.node_report_capabilities(text,jsonb)',
  'public.node_claim_job(text,uuid,integer)'] loop
  execute format('revoke all on function %s from public', f);
  execute format('grant execute on function %s to anon, authenticated, service_role', f);
 end loop;
end $grants$;

-- ── 10. Realtime: the console subscribes to chat_messages inserts (still filtered by chat_messages_read RLS) ──
do $realtime$
begin
 if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables)
  and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
  alter publication supabase_realtime add table public.chat_messages;
 end if;
end $realtime$;
