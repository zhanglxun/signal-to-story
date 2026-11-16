-- Knowledge-base content intake: source categories, raw signals and selections
-- (see docs-site/spec/SignalToStory项目数据库文档.md for the original c_category /
-- c_signal / c_selection draft, and docs/supabase-data-model.md for the mapping
-- notes on every deviation made here).

create or replace function private.set_audit_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.updated_by := new.created_by;
  else
    new.updated_at := now();
    if (select auth.uid()) is not null then
      new.updated_by := (select auth.uid());
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.set_audit_fields() from public, anon, authenticated;

-- source_categories --------------------------------------------------------

create table public.source_categories (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id bigint,
  name text not null,
  icon_url text,
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  description text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint source_categories_name_length
    check (char_length(btrim(name)) between 1 and 36),
  constraint source_categories_icon_url_length
    check (icon_url is null or char_length(icon_url) <= 128),
  constraint source_categories_description_length
    check (description is null or char_length(description) <= 256),
  constraint source_categories_sort_order_range
    check (sort_order between 0 and 32767),
  constraint source_categories_not_self_parent
    check (parent_id is distinct from id),
  constraint source_categories_organization_id_id_key
    unique (organization_id, id),
  constraint source_categories_parent_fkey
    foreign key (organization_id, parent_id)
    references public.source_categories (organization_id, id)
    on delete restrict
);

comment on table public.source_categories is
  '信源分类，两层结构（parent_id 自关联），对应草案 c_category。';
comment on column public.source_categories.sort_order is
  '显示排序号；原始草案字段名 sort_id，字段说明疑似笔误，按实际用途改名。';
comment on column public.source_categories.parent_id is
  '父级分类 ID；仅支持两层，深度校验见 private.enforce_source_category_depth()。';

create index source_categories_organization_parent_sort_idx
  on public.source_categories (organization_id, parent_id, sort_order);

create or replace function private.enforce_source_category_depth()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_parent_id bigint;
  child_count bigint;
begin
  if new.parent_id is not null then
    -- The target parent must itself be a top-level category.
    select parent_id into parent_parent_id
    from public.source_categories
    where id = new.parent_id;

    if parent_parent_id is not null then
      raise exception 'source_categories 最多支持两层，% 本身已经是子分类', new.parent_id
        using errcode = '23514';
    end if;

    -- This row must not already have children of its own (would otherwise
    -- create a third level once it becomes a child itself).
    select count(*) into child_count
    from public.source_categories
    where parent_id = new.id;

    if child_count > 0 then
      raise exception 'source_categories 最多支持两层，% 下面已经有子分类，不能再设为子分类', new.id
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_source_category_depth() from public, anon, authenticated;

create trigger source_categories_enforce_depth
before insert or update of parent_id on public.source_categories
for each row execute function private.enforce_source_category_depth();

create trigger source_categories_set_audit_fields
before insert or update on public.source_categories
for each row execute function private.set_audit_fields();

alter table public.source_categories enable row level security;

create policy source_categories_select_viewer
  on public.source_categories
  for select
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.view')));

create policy source_categories_insert_manager
  on public.source_categories
  for insert
  to authenticated
  with check (
    (select private.has_organization_permission(organization_id, 'content.manage'))
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
  );

create policy source_categories_update_manager
  on public.source_categories
  for update
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.manage')))
  with check (
    (select private.has_organization_permission(organization_id, 'content.manage'))
    and updated_by = (select auth.uid())
  );

create policy source_categories_delete_manager
  on public.source_categories
  for delete
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.manage')));

revoke all on public.source_categories from anon, authenticated;
revoke all on sequence public.source_categories_id_seq from anon, authenticated;

grant select (
  id, organization_id, parent_id, name, icon_url, sort_order, is_active,
  description, created_by, created_at, updated_by, updated_at
) on public.source_categories to authenticated;

grant insert (
  organization_id, parent_id, name, icon_url, sort_order, is_active,
  description, created_by, updated_by
) on public.source_categories to authenticated;

grant update (
  parent_id, name, icon_url, sort_order, is_active, description
) on public.source_categories to authenticated;

grant delete on public.source_categories to authenticated;
grant usage, select on sequence public.source_categories_id_seq to authenticated;

-- signals --------------------------------------------------------------------

create table public.signals (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id bigint not null,
  name text not null,
  icon_url text,
  site_url text,
  summary text,
  description text,
  is_organized boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint signals_name_length
    check (char_length(btrim(name)) between 1 and 120),
  constraint signals_icon_url_length
    check (icon_url is null or char_length(icon_url) <= 128),
  constraint signals_site_url_length
    check (site_url is null or char_length(site_url) <= 512),
  constraint signals_summary_length
    check (summary is null or char_length(summary) <= 1024),
  constraint signals_description_length
    check (description is null or char_length(description) <= 4000),
  constraint signals_organization_id_id_key
    unique (organization_id, id),
  constraint signals_category_fkey
    foreign key (organization_id, category_id)
    references public.source_categories (organization_id, id)
    on delete restrict
);

comment on table public.signals is
  '待处理信息（信息源采集队列），对应草案 c_signal。';
comment on column public.signals.is_organized is
  '原始草案 status：1 未整理 / 0 已整理，改为布尔更直接。';

create index signals_organization_created_at_idx
  on public.signals (organization_id, created_at desc);

create index signals_organization_category_idx
  on public.signals (organization_id, category_id);

create trigger signals_set_audit_fields
before insert or update on public.signals
for each row execute function private.set_audit_fields();

alter table public.signals enable row level security;

create policy signals_select_viewer
  on public.signals
  for select
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.view')));

create policy signals_insert_manager
  on public.signals
  for insert
  to authenticated
  with check (
    (select private.has_organization_permission(organization_id, 'content.manage'))
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
  );

create policy signals_update_manager
  on public.signals
  for update
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.manage')))
  with check (
    (select private.has_organization_permission(organization_id, 'content.manage'))
    and updated_by = (select auth.uid())
  );

create policy signals_delete_manager
  on public.signals
  for delete
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.manage')));

revoke all on public.signals from anon, authenticated;
revoke all on sequence public.signals_id_seq from anon, authenticated;

grant select (
  id, organization_id, category_id, name, icon_url, site_url, summary,
  description, is_organized, created_by, created_at, updated_by, updated_at
) on public.signals to authenticated;

grant insert (
  organization_id, category_id, name, icon_url, site_url, summary,
  description, is_organized, created_by, updated_by
) on public.signals to authenticated;

grant update (
  category_id, name, icon_url, site_url, summary, description, is_organized
) on public.signals to authenticated;

grant delete on public.signals to authenticated;
grant usage, select on sequence public.signals_id_seq to authenticated;

-- selections -------------------------------------------------------------

create table public.selections (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  signal_id bigint not null,
  name text not null,
  core_thesis text,
  angle_type text,
  content_format text,
  negative_prompts text,
  outline_template jsonb not null default '[]'::jsonb,
  priority smallint not null default 2,
  is_completed boolean not null default false,
  description text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint selections_name_length
    check (char_length(btrim(name)) between 1 and 64),
  constraint selections_core_thesis_length
    check (core_thesis is null or char_length(core_thesis) <= 512),
  constraint selections_angle_type_length
    check (angle_type is null or char_length(angle_type) <= 64),
  constraint selections_content_format_length
    check (content_format is null or char_length(content_format) <= 64),
  constraint selections_negative_prompts_length
    check (negative_prompts is null or char_length(negative_prompts) <= 4000),
  constraint selections_description_length
    check (description is null or char_length(description) <= 256),
  constraint selections_priority_range
    check (priority in (1, 2, 3)),
  constraint selections_outline_template_is_array
    check (jsonb_typeof(outline_template) = 'array'),
  constraint selections_organization_id_id_key
    unique (organization_id, id),
  constraint selections_signal_fkey
    foreign key (organization_id, signal_id)
    references public.signals (organization_id, id)
    on delete restrict
);

comment on table public.selections is
  '选题信息管理表，对应草案 c_selection；signal_id 关联待处理信息的主键。';
comment on column public.selections.priority is
  '优先级：1 高 / 2 中 / 3 低。';
comment on column public.selections.is_completed is
  '原始草案 status：1 未完成 / 0 已完成，改为布尔更直接。';
comment on column public.selections.outline_template is
  '预设结构大纲/章节模板，形如 [{"title": "..."}]。';

create index selections_organization_created_at_idx
  on public.selections (organization_id, created_at desc);

create index selections_organization_signal_idx
  on public.selections (organization_id, signal_id);

create trigger selections_set_audit_fields
before insert or update on public.selections
for each row execute function private.set_audit_fields();

alter table public.selections enable row level security;

create policy selections_select_viewer
  on public.selections
  for select
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.view')));

create policy selections_insert_manager
  on public.selections
  for insert
  to authenticated
  with check (
    (select private.has_organization_permission(organization_id, 'content.manage'))
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
  );

create policy selections_update_manager
  on public.selections
  for update
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.manage')))
  with check (
    (select private.has_organization_permission(organization_id, 'content.manage'))
    and updated_by = (select auth.uid())
  );

create policy selections_delete_manager
  on public.selections
  for delete
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.manage')));

revoke all on public.selections from anon, authenticated;
revoke all on sequence public.selections_id_seq from anon, authenticated;

grant select (
  id, organization_id, signal_id, name, core_thesis, angle_type, content_format,
  negative_prompts, outline_template, priority, is_completed, description,
  created_by, created_at, updated_by, updated_at
) on public.selections to authenticated;

grant insert (
  organization_id, signal_id, name, core_thesis, angle_type, content_format,
  negative_prompts, outline_template, priority, is_completed, description,
  created_by, updated_by
) on public.selections to authenticated;

grant update (
  signal_id, name, core_thesis, angle_type, content_format, negative_prompts,
  outline_template, priority, is_completed, description
) on public.selections to authenticated;

grant delete on public.selections to authenticated;
grant usage, select on sequence public.selections_id_seq to authenticated;
