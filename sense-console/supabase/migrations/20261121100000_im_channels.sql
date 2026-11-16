-- P4 IM channels (Feishu bot / WeCom bot). Each bot conversation entry is one intake connection.
-- * adapter now accepts 'feishu' and 'wecom'. The connection still carries a capture-only token hash
--   (never shown to the IM user); the Edge Function im-webhook authenticates the *platform* (signature)
--   and then calls im_quick_capture(connection_id, ...), which resolves the hash server-side.
-- * im_channels stores the latest conversation id (reply target) so the worker can push review cards.
-- * No approval path exists here: IM identities are not bound to console accounts in this phase.
alter table public.intake_connections drop constraint intake_connections_adapter_check;
alter table public.intake_connections add constraint intake_connections_adapter_check
 check (adapter in ('dot','generic','feishu','wecom'));

create table public.im_channels (
 connection_id uuid primary key,
 organization_id uuid not null,
 channel text not null check (channel in ('feishu','wecom')),
 reply_target text check (reply_target is null or char_length(reply_target) between 1 and 200),
 reply_target_updated_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key (organization_id, connection_id) references public.intake_connections(organization_id, id) on delete cascade
);
comment on table public.im_channels is 'IM 机器人通道登记：连接 ↔ 平台，及最近一次会话（用于推送待审通知）。机器人密钥不存库，见 docs/im-channels.md。';
create index im_channels_org_idx on public.im_channels (organization_id);
alter table public.im_channels enable row level security;
revoke all on public.im_channels from anon, authenticated;
grant select(connection_id, organization_id, channel, reply_target_updated_at, created_at) on public.im_channels to authenticated;
grant insert(connection_id, organization_id, channel) on public.im_channels to authenticated;
grant all on public.im_channels to service_role;
create policy im_channels_read on public.im_channels for select to authenticated
 using ((select private.has_organization_permission(organization_id, 'content.manage')));
create policy im_channels_create on public.im_channels for insert to authenticated
 with check ((select private.has_organization_permission(organization_id, 'content.manage'))
  and exists (select 1 from public.intake_connections c
   where c.id = connection_id and c.organization_id = im_channels.organization_id and c.adapter = im_channels.channel));

-- Trusted server entry for IM webhooks.
create function public.im_quick_capture(p_connection_id uuid, p_reply_target text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.intake_connections; ch public.im_channels;
begin
 select * into ch from public.im_channels where connection_id = p_connection_id;
 if not found then raise exception 'invalid_connection' using errcode='28000'; end if;
 select * into c from public.intake_connections where id = p_connection_id;
 if not found or c.adapter <> ch.channel or c.revoked_at is not null or c.expires_at <= now() then
  raise exception 'invalid_connection' using errcode='28000';
 end if;
 if p_reply_target is not null and char_length(p_reply_target) between 1 and 200 then
  update public.im_channels set reply_target = p_reply_target, reply_target_updated_at = now() where connection_id = p_connection_id;
 end if;
 return public.quick_capture_for_connection(c.token_hash, p_input);
end; $$;
revoke all on function public.im_quick_capture(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.im_quick_capture(uuid, text, jsonb) to service_role;

-- Where should a review notification for this job go? NULL when the job did not originate from an IM connection
-- (or that connection was revoked/expired).
create function public.im_notify_target(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare j public.agent_jobs; qc public.quick_captures; ch public.im_channels; c public.intake_connections; doc record;
begin
 select * into j from public.agent_jobs where id = p_job_id;
 if not found or (j.payload->>'quick_capture_id') is null then return null; end if;
 select * into qc from public.quick_captures where id = (j.payload->>'quick_capture_id')::uuid and organization_id = j.organization_id;
 if not found or qc.connection_id is null then return null; end if;
 select * into ch from public.im_channels where connection_id = qc.connection_id;
 if not found then return null; end if;
 select * into c from public.intake_connections where id = ch.connection_id;
 if c.revoked_at is not null or c.expires_at <= now() then return null; end if;
 select d.platform, d.title into doc from public.content_documents d
  where d.organization_id = j.organization_id and j.target_type = 'content_document' and d.id::text = j.target_id;
 return jsonb_build_object('channel', ch.channel, 'reply_target', ch.reply_target, 'connection_id', ch.connection_id,
  'job_id', j.id, 'status', j.status, 'rounds', j.rounds, 'max_rounds', j.max_rounds,
  'project_id', qc.project_id, 'document_id', case when j.target_type = 'content_document' then j.target_id end,
  'platform', doc.platform, 'title', doc.title);
end; $$;
revoke all on function public.im_notify_target(uuid) from public, anon, authenticated;
grant execute on function public.im_notify_target(uuid) to service_role;
