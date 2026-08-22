create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint organizations_name_length check (char_length(name) between 1 and 120),
  constraint organizations_domain_length check (domain is null or char_length(domain) <= 253)
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_normalized check (email = lower(btrim(email))),
  constraint profiles_display_name_length check (char_length(display_name) between 1 and 80),
  constraint profiles_status_check check (status in ('active', 'suspended'))
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint organization_members_role_check check (role in ('owner', 'admin', 'member', 'viewer'))
);

create index if not exists organization_members_user_id_idx
  on public.organization_members (user_id, organization_id);

create index if not exists organization_members_created_by_idx
  on public.organization_members (created_by)
  where created_by is not null;

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_action_length check (char_length(action) between 1 and 120),
  constraint audit_events_target_type_length check (char_length(target_type) between 1 and 80),
  constraint audit_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists audit_events_organization_created_at_idx
  on public.audit_events (organization_id, created_at desc);

create index if not exists audit_events_actor_user_id_idx
  on public.audit_events (actor_user_id)
  where actor_user_id is not null;

create or replace function private.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_members membership
      where membership.organization_id = target_organization_id
        and membership.user_id = (select auth.uid())
    );
$$;

create or replace function private.is_organization_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_members membership
      where membership.organization_id = target_organization_id
        and membership.user_id = (select auth.uid())
        and membership.role in ('owner', 'admin')
    );
$$;

create or replace function private.can_view_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id = (select auth.uid())
    or exists (
      select 1
      from public.organization_members viewer
      join public.organization_members target
        on target.organization_id = viewer.organization_id
      where viewer.user_id = (select auth.uid())
        and target.user_id = target_user_id
    );
$$;

revoke all on function private.is_organization_member(uuid) from public;
revoke all on function private.is_organization_admin(uuid) from public;
revoke all on function private.can_view_profile(uuid) from public;
grant execute on function private.is_organization_member(uuid) to authenticated;
grant execute on function private.is_organization_admin(uuid) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member
  on public.organizations
  for select
  to authenticated
  using ((select private.is_organization_member(id)));

drop policy if exists profiles_select_shared_organization on public.profiles;
create policy profiles_select_shared_organization
  on public.profiles
  for select
  to authenticated
  using ((select private.can_view_profile(user_id)));

drop policy if exists organization_members_select_member on public.organization_members;
create policy organization_members_select_member
  on public.organization_members
  for select
  to authenticated
  using ((select private.is_organization_member(organization_id)));

drop policy if exists audit_events_select_admin on public.audit_events;
create policy audit_events_select_admin
  on public.audit_events
  for select
  to authenticated
  using ((select private.is_organization_admin(organization_id)));

revoke all on public.organizations from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
revoke all on public.organization_members from anon, authenticated;
revoke all on public.audit_events from anon, authenticated;

grant select on public.organizations to authenticated;
grant select on public.profiles to authenticated;
grant select on public.organization_members to authenticated;
grant select on public.audit_events to authenticated;

insert into public.organizations (slug, name, domain)
values ('signal-to-story', 'Signal to Story', 'susesne.cn')
on conflict (slug) do update
set name = excluded.name,
    domain = excluded.domain,
    updated_at = now();
