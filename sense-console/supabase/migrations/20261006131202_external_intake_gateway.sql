-- Provider-neutral, capture-only credentials. Browser never receives privileged keys.
create table public.intake_connections (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
 name text not null check (char_length(btrim(name)) between 1 and 64),
 adapter text not null check (adapter in ('dot','generic')),
 token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now() + interval '30 days',
 revoked_at timestamptz,
 unique (organization_id,id)
);
alter table public.intake_connections enable row level security;
create policy intake_connections_read on public.intake_connections for select to authenticated
 using ((select private.has_organization_permission(organization_id,'content.manage')));
create policy intake_connections_create on public.intake_connections for insert to authenticated
 with check (created_by=(select auth.uid()) and (select private.has_organization_permission(organization_id,'content.manage')));
create policy intake_connections_revoke on public.intake_connections for update to authenticated
 using ((select private.has_organization_permission(organization_id,'content.manage')))
 with check ((select private.has_organization_permission(organization_id,'content.manage')));
revoke all on public.intake_connections from anon,authenticated;
grant select(id,organization_id,created_by,name,adapter,created_at,expires_at,revoked_at),
 insert(organization_id,name,adapter,token_hash),update(revoked_at) on public.intake_connections to authenticated;
grant all on public.intake_connections to service_role;
create index intake_connections_creator_idx on public.intake_connections(created_by);

create table public.intake_receipts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null,
 external_id text not null check (char_length(external_id) between 1 and 128),
 payload jsonb not null,
 signal_id bigint not null,
 selection_id bigint not null,
 created_at timestamptz not null default now(),
 unique(connection_id,external_id),
 foreign key(organization_id,connection_id) references public.intake_connections(organization_id,id),
 foreign key(organization_id,signal_id) references public.signals(organization_id,id),
 foreign key(organization_id,selection_id) references public.selections(organization_id,id)
);
alter table public.intake_receipts enable row level security;
create policy intake_receipts_read on public.intake_receipts for select to authenticated
 using ((select private.has_organization_permission(organization_id,'content.view')));
revoke all on public.intake_receipts from anon,authenticated;
grant select on public.intake_receipts to authenticated;
grant all on public.intake_receipts to service_role;
create index intake_receipts_org_signal_idx on public.intake_receipts(organization_id,signal_id);
create index intake_receipts_org_selection_idx on public.intake_receipts(organization_id,selection_id);
create index intake_receipts_org_connection_idx on public.intake_receipts(organization_id,connection_id);
create index intake_receipts_connection_time_idx on public.intake_receipts(connection_id,created_at);

-- Called only by the Edge Function service role. No definer / no user-supplied tenant.
-- Locking the credential serializes concurrent retries; all inserts commit atomically.
create function public.accept_intake(p_token_hash text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 c public.intake_connections; r public.intake_receipts; cat bigint; sig bigint; sel bigint;
begin
 select * into c from public.intake_connections where token_hash=p_token_hash for update;
 if not found or c.revoked_at is not null or c.expires_at<=now() then
  raise exception 'invalid_connection' using errcode='28000';
 end if;
 if not exists(select 1 from public.organization_members m join public.organization_roles role
   on role.organization_id=m.organization_id and role.role_key=m.role
   where m.organization_id=c.organization_id and m.user_id=c.created_by and 'content.manage'=any(role.permissions)) then
  raise exception 'invalid_connection' using errcode='28000';
 end if;
 if jsonb_typeof(p_input) is distinct from 'object'
 or (p_input->>'version') is distinct from '1'
 or (p_input->>'intent') is distinct from 'capture'
 or coalesce(char_length(btrim(p_input->>'external_id')),0) not between 1 and 128
 or coalesce(char_length(btrim(p_input->>'text')),0) not between 1 and 4000
 or coalesce(char_length(btrim(p_input->>'title')),0) not between 1 and 64
 or coalesce(char_length(p_input->>'url'),0)>512
 or coalesce(char_length(p_input->>'angle'),0)>512 then
  raise exception 'invalid_input' using errcode='22023';
 end if;
 select * into r from public.intake_receipts where connection_id=c.id and external_id=p_input->>'external_id';
 if found then
  if r.payload<>p_input then raise exception 'idempotency_conflict' using errcode='23505'; end if;
  return jsonb_build_object('receipt_id',r.id,'signal_id',r.signal_id,'selection_id',r.selection_id,'duplicate',true,'status','captured','topic_path','/topics/'||r.selection_id);
 end if;
 if (select count(*) from public.intake_receipts where connection_id=c.id and created_at>now()-interval '1 hour')>=100 then
  raise exception 'rate_limited' using errcode='P0001';
 end if;
 -- Serialize category creation across credentials belonging to the same tenant.
 perform pg_advisory_xact_lock(hashtextextended(c.organization_id::text,0));
 select id into cat from public.source_categories where organization_id=c.organization_id and name='外部灵感收集' and parent_id is null order by id limit 1;
 if cat is null then
  insert into public.source_categories(organization_id,name,description,created_by,updated_by)
  values(c.organization_id,'外部灵感收集','外部助手输入，原文及链接尚待核实',c.created_by,c.created_by) returning id into cat;
 end if;
 insert into public.signals(organization_id,category_id,name,site_url,summary,description,is_organized,created_by,updated_by)
 values(c.organization_id,cat,p_input->>'title',nullif(p_input->>'url',''),
 '外部输入 · 待核实；未自动抓取来源正文。',p_input->>'text',true,c.created_by,c.created_by) returning id into sig;
 insert into public.selections(organization_id,signal_id,name,core_thesis,description,created_by,updated_by)
 values(c.organization_id,sig,p_input->>'title',nullif(p_input->>'angle',''),
 '外部输入形成的候选选题，等待选定及资料核查；尚未启动创作。',c.created_by,c.created_by) returning id into sel;
 insert into public.intake_receipts(organization_id,connection_id,external_id,payload,signal_id,selection_id)
 values(c.organization_id,c.id,p_input->>'external_id',p_input,sig,sel) returning * into r;
 return jsonb_build_object('receipt_id',r.id,'signal_id',sig,'selection_id',sel,'duplicate',false,'status','captured','topic_path','/topics/'||sel);
end;
$$;
revoke all on function public.accept_intake(text,jsonb) from public,anon,authenticated;
grant execute on function public.accept_intake(text,jsonb) to service_role;
