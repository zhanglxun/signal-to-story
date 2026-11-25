create table if not exists public.organization_roles (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_key text not null,
  name text not null,
  description text not null,
  permissions text[] not null default '{}'::text[],
  assignment_permission text not null,
  is_system boolean not null default false,
  is_assignable boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, role_key),
  constraint organization_roles_key_format
    check (role_key ~ '^[a-z][a-z0-9_]*$'),
  constraint organization_roles_name_length
    check (char_length(name) between 1 and 80),
  constraint organization_roles_description_length
    check (char_length(description) between 1 and 500),
  constraint organization_roles_permissions_not_empty
    check (cardinality(permissions) > 0),
  constraint organization_roles_assignment_permission_format
    check (assignment_permission ~ '^[a-z][a-z0-9_.]*$'),
  constraint organization_roles_sort_order_nonnegative
    check (sort_order >= 0)
);

insert into public.organization_roles (
  organization_id,
  role_key,
  name,
  description,
  permissions,
  assignment_permission,
  is_system,
  is_assignable,
  sort_order
)
select
  organizations.id,
  defaults.role_key,
  defaults.name,
  defaults.description,
  defaults.permissions,
  defaults.assignment_permission,
  true,
  true,
  defaults.sort_order
from public.organizations
cross join (
  values
    (
      'owner',
      'Owner',
      '管理组织、账号与管理员，并保留最终控制权。',
      array['organization.manage', 'account.manage', 'role.manage', 'content.manage', 'agent.dispatch', 'content.view', 'owner.grant']::text[],
      'owner.grant',
      10::smallint
    ),
    (
      'admin',
      'Admin',
      '创建普通账号、管理内容和任务，但不能授予 Owner。',
      array['account.manage', 'content.manage', 'agent.dispatch', 'content.view']::text[],
      'account.manage',
      20::smallint
    ),
    (
      'member',
      'Member',
      '创建和维护内容、任务及资产，不管理账号。',
      array['content.manage', 'agent.dispatch', 'content.view']::text[],
      'account.manage',
      30::smallint
    ),
    (
      'viewer',
      'Viewer',
      '只读查看驾驶舱、内容状态和资产关系。',
      array['content.view']::text[],
      'account.manage',
      40::smallint
    )
) as defaults(role_key, name, description, permissions, assignment_permission, sort_order)
on conflict (organization_id, role_key) do update
set name = excluded.name,
    description = excluded.description,
    permissions = excluded.permissions,
    assignment_permission = excluded.assignment_permission,
    is_system = excluded.is_system,
    is_assignable = excluded.is_assignable,
    sort_order = excluded.sort_order,
    updated_at = now();

alter table public.organization_members
  drop constraint if exists organization_members_role_check;

alter table public.organization_members
  add constraint organization_members_role_fkey
  foreign key (organization_id, role)
  references public.organization_roles (organization_id, role_key)
  on update cascade
  on delete restrict;

create index if not exists organization_members_organization_role_idx
  on public.organization_members (organization_id, role);

alter table public.organization_roles enable row level security;

create or replace function private.has_organization_permission(
  target_organization_id uuid,
  required_permission text
)
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
      join public.organization_roles role_definition
        on role_definition.organization_id = membership.organization_id
       and role_definition.role_key = membership.role
      where membership.organization_id = target_organization_id
        and membership.user_id = (select auth.uid())
        and required_permission = any(role_definition.permissions)
    );
$$;

revoke all on function private.has_organization_permission(uuid, text) from public;
grant execute on function private.has_organization_permission(uuid, text) to authenticated;

drop policy if exists organization_roles_select_member on public.organization_roles;
create policy organization_roles_select_member
  on public.organization_roles
  for select
  to authenticated
  using ((select private.is_organization_member(organization_id)));

drop policy if exists audit_events_select_admin on public.audit_events;
create policy audit_events_select_account_manager
  on public.audit_events
  for select
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'account.manage')));

drop function if exists private.is_organization_admin(uuid);

revoke all on public.organization_roles from anon, authenticated;
grant select on public.organization_roles to authenticated;

