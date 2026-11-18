-- IM capture (Feishu bot / WeCom bot), MVP: an IM bot is just an intake connection whose adapter is
-- 'feishu' or 'wecom'. No channel registry table: the conversation to reply to travels with each input
-- (intake_events.payload.reply_to), so a notification goes back where the request came from.
-- * The Edge Function im-webhook authenticates the *platform* (signature), then calls
--   im_quick_capture(connection_id, reply_target, input) with the service role.
-- * No approval path exists here: IM identities are not bound to console accounts in this phase.
alter table public.intake_connections drop constraint intake_connections_adapter_check;
alter table public.intake_connections add constraint intake_connections_adapter_check
 check (adapter in ('dot','generic','feishu','wecom'));

create function public.im_quick_capture(p_connection_id uuid, p_reply_target text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.intake_connections;
begin
 select * into c from public.intake_connections where id = p_connection_id for update;
 if not found or c.adapter not in ('feishu','wecom') then
  raise exception 'invalid_connection' using errcode='28000';
 end if;
 if p_reply_target is not null and char_length(p_reply_target) not between 1 and 200 then
  raise exception 'invalid_input' using errcode='22023';
 end if;
 return private.capture_for_connection(c, 'im', p_input,
  case when p_reply_target is null then '{}'::jsonb
   else jsonb_build_object('reply_to', jsonb_build_object('channel', c.adapter, 'target', p_reply_target)) end);
end; $$;
revoke all on function public.im_quick_capture(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.im_quick_capture(uuid, text, jsonb) to service_role;

-- Where should a review notification for this job go? NULL when the job did not come from an IM input
-- (or that connection was revoked/expired). DB2c replaces this with notified_at scanning.
create function public.im_notify_target(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare j public.agent_jobs; e public.intake_events; c public.intake_connections; doc record;
begin
 select * into j from public.agent_jobs where id = p_job_id;
 if not found or (j.payload->>'intake_event_id') is null then return null; end if;
 select * into e from public.intake_events where id = (j.payload->>'intake_event_id')::uuid and organization_id = j.organization_id;
 if not found or e.source <> 'im' or e.payload->'reply_to' is null then return null; end if;
 select * into c from public.intake_connections where id = e.connection_id;
 if not found or c.revoked_at is not null or c.expires_at <= now() then return null; end if;
 select d.platform, d.title into doc from public.content_documents d
  where d.organization_id = j.organization_id and j.target_type = 'content_document' and d.id::text = j.target_id;
 return jsonb_build_object('channel', e.payload->'reply_to'->>'channel', 'reply_target', e.payload->'reply_to'->>'target',
  'connection_id', c.id, 'job_id', j.id, 'status', j.status, 'rounds', j.rounds, 'max_rounds', j.max_rounds,
  'work_item_id', e.work_item_id, 'document_id', case when j.target_type = 'content_document' then j.target_id end,
  'platform', doc.platform, 'title', doc.title);
end; $$;
revoke all on function public.im_notify_target(uuid) from public, anon, authenticated;
grant execute on function public.im_notify_target(uuid) to service_role;
