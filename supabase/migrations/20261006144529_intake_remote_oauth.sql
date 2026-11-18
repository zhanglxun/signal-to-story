-- Capture-only OAuth. Secrets never reach the model, browser, or local JSON files.
-- All state is accessed by the Edge Function's service role; no new user CRUD API.
create table public.intake_oauth_requests (
 id uuid primary key default gen_random_uuid(),
 parameters jsonb not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now() + interval '10 minutes',
 decided_at timestamptz
);
create index intake_oauth_requests_created_idx on public.intake_oauth_requests(created_at);
create table public.intake_oauth_grants (
 id uuid primary key default gen_random_uuid(),
 connection_id uuid not null unique references public.intake_connections(id),
 client_id text not null,
 resource text not null,
 code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
 challenge text not null,
 redirect_uri text not null,
 code_expires_at timestamptz not null default now() + interval '5 minutes',
 code_used_at timestamptz
);
create table public.intake_oauth_tokens (
 hash text primary key check (hash ~ '^[a-f0-9]{64}$'),
 grant_id uuid not null references public.intake_oauth_grants(id),
 kind text not null check (kind in ('access','refresh')),
 expires_at timestamptz not null,
 used_at timestamptz
);
create index intake_oauth_tokens_grant_idx on public.intake_oauth_tokens(grant_id);
alter table public.intake_oauth_requests enable row level security;
alter table public.intake_oauth_grants enable row level security;
alter table public.intake_oauth_tokens enable row level security;
revoke all on public.intake_oauth_requests,public.intake_oauth_grants,public.intake_oauth_tokens from public,anon,authenticated;
grant all on public.intake_oauth_requests,public.intake_oauth_grants,public.intake_oauth_tokens to service_role;

-- The Edge Function validates the Supabase user on consent, the exact OAuth
-- client/redirect/resource, and the HTTP input schema before invoking this RPC.
-- Locks serialize code exchange, refresh rotation and capture/revocation.
create function public.intake_oauth(p_action text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 q public.intake_oauth_requests;
 g public.intake_oauth_grants;
 t public.intake_oauth_tokens;
 c public.intake_connections;
 identity_id uuid;
 tenant_id uuid;
 request_id uuid;
begin
 if p_action='request' then
  perform pg_advisory_xact_lock(hashtextextended('intake_oauth_requests',0));
  delete from public.intake_oauth_requests where expires_at<now()-interval '1 day';
  if (select count(*) from public.intake_oauth_requests where created_at>now()-interval '1 hour')>=1000 then
   return jsonb_build_object('error','rate_limited');
  end if;
  insert into public.intake_oauth_requests(parameters) values(p_data) returning id into request_id;
  return jsonb_build_object('request_id',request_id);
 elsif p_action in ('details','decide') then
  select * into q from public.intake_oauth_requests where id=(p_data->>'request_id')::uuid for update;
  if not found or q.expires_at<=now() or q.decided_at is not null then
   return jsonb_build_object('error','invalid_request');
  end if;
  if p_action='details' then
   return jsonb_build_object('client_name','ChatGPT / Dot','scope','capture','redirect_uri',q.parameters->>'redirect_uri');
  end if;
  identity_id:=(p_data->>'user_id')::uuid;
  if identity_id is null then return jsonb_build_object('error','unauthorized'); end if;
  if p_data->>'decision'='deny' then
   update public.intake_oauth_requests set decided_at=now() where id=q.id;
   return q.parameters || jsonb_build_object('denied',true);
  end if;
  if p_data->>'decision' is distinct from 'approve' then return jsonb_build_object('error','invalid_request'); end if;
  tenant_id:=(p_data->>'organization_id')::uuid;
  if not exists(select 1 from public.organization_members m join public.organization_roles role
    on role.organization_id=m.organization_id and role.role_key=m.role
    where m.organization_id=tenant_id and m.user_id=identity_id and 'content.manage'=any(role.permissions)) then
   return jsonb_build_object('error','forbidden');
  end if;
  insert into public.intake_connections(organization_id,created_by,name,adapter,token_hash)
   values(tenant_id,identity_id,'Dot 云端授权','dot',encode(extensions.gen_random_bytes(32),'hex')) returning * into c;
  insert into public.intake_oauth_grants(connection_id,client_id,resource,code_hash,challenge,redirect_uri)
   values(c.id,q.parameters->>'client_id',q.parameters->>'resource',p_data->>'code_hash',q.parameters->>'code_challenge',q.parameters->>'redirect_uri');
  update public.intake_oauth_requests set decided_at=now() where id=q.id;
  return q.parameters || jsonb_build_object('denied',false);
 elsif p_action='exchange' then
  select * into g from public.intake_oauth_grants where code_hash=p_data->>'code_hash' for update;
  if not found or g.code_expires_at<=now() or g.code_used_at is not null
    or g.client_id is distinct from p_data->>'client_id'
    or g.resource is distinct from p_data->>'resource'
    or g.redirect_uri is distinct from p_data->>'redirect_uri'
    or g.challenge is distinct from p_data->>'challenge' then
   return jsonb_build_object('error','invalid_grant');
  end if;
 elsif p_action in ('refresh','authenticate','capture','revoke') then
  -- Read the grant reference, then always lock grant before token/connection.
  select * into t from public.intake_oauth_tokens where hash=p_data->>'token_hash';
  if not found then return jsonb_build_object('error','invalid_token'); end if;
  select * into g from public.intake_oauth_grants where id=t.grant_id for update;
  select * into t from public.intake_oauth_tokens where hash=p_data->>'token_hash' for update;
  if g.resource is distinct from p_data->>'resource' then return jsonb_build_object('error','invalid_token'); end if;
  if p_action in ('refresh','revoke') and g.client_id is distinct from p_data->>'client_id' then
   return jsonb_build_object('error','invalid_grant');
  end if;
  if p_action='revoke' then
   update public.intake_connections set revoked_at=coalesce(revoked_at,now()) where id=g.connection_id;
   return jsonb_build_object('ok',true);
  end if;
  if p_action='refresh' and t.kind='refresh' and t.used_at is not null then
   -- Return, do not raise: revocation must commit on refresh-token replay.
   update public.intake_connections set revoked_at=coalesce(revoked_at,now()) where id=g.connection_id;
   return jsonb_build_object('error','invalid_grant');
  end if;
  if t.expires_at<=now() or t.used_at is not null
   or (p_action='refresh' and t.kind<>'refresh')
   or (p_action in ('authenticate','capture') and t.kind<>'access') then
   return jsonb_build_object('error','invalid_token');
  end if;
 else return jsonb_build_object('error','invalid_request');
 end if;
 select * into c from public.intake_connections where id=g.connection_id for update;
 if not found or c.revoked_at is not null or c.expires_at<=now()
   or not exists(select 1 from public.organization_members m join public.organization_roles role
     on role.organization_id=m.organization_id and role.role_key=m.role
     where m.organization_id=c.organization_id and m.user_id=c.created_by and 'content.manage'=any(role.permissions)) then
  return jsonb_build_object('error','invalid_token');
 end if;
 if p_action='authenticate' then return jsonb_build_object('ok',true); end if;
 if p_action='capture' then
  return public.accept_intake(c.token_hash,p_data->'input');
 end if;
 if p_action='exchange' then
  update public.intake_oauth_grants set code_used_at=now() where id=g.id;
 else
  update public.intake_oauth_tokens set used_at=now() where hash=t.hash;
 end if;
 insert into public.intake_oauth_tokens(hash,grant_id,kind,expires_at) values
  (p_data->>'access_hash',g.id,'access',least(now()+interval '1 hour',c.expires_at)),
  (p_data->>'refresh_hash',g.id,'refresh',c.expires_at);
 return jsonb_build_object('ok',true,'expires_in',greatest(0,floor(extract(epoch from least(now()+interval '1 hour',c.expires_at)-now()))));
end;
$$;
revoke all on function public.intake_oauth(text,jsonb) from public,anon,authenticated;
grant execute on function public.intake_oauth(text,jsonb) to service_role;
