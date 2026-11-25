create extension if not exists pg_trgm with schema extensions;

create table public.assets (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_type text not null,
  category text not null default 'general',
  media_type text not null default 'image',
  name text not null,
  cloud_url text,
  local_path text,
  thumbnail_url text,
  is_active boolean not null default true,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  search_text text generated always as (
    name || ' ' || category || ' ' || coalesce(description, '')
  ) stored,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint assets_asset_type_check
    check (asset_type in ('character', 'scene', 'prop', 'sound', 'style')),
  constraint assets_category_length
    check (char_length(btrim(category)) between 1 and 80),
  constraint assets_media_type_check
    check (media_type in ('image', 'audio', 'video', 'model', 'document', 'other')),
  constraint assets_name_length
    check (char_length(btrim(name)) between 1 and 120),
  constraint assets_cloud_url_length
    check (cloud_url is null or char_length(cloud_url) <= 2048),
  constraint assets_local_path_length
    check (local_path is null or char_length(local_path) <= 2048),
  constraint assets_thumbnail_url_length
    check (thumbnail_url is null or char_length(thumbnail_url) <= 2048),
  constraint assets_description_length
    check (description is null or char_length(description) <= 2000),
  constraint assets_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.assets is
  'Signal to Story 资产元数据账本；媒体二进制保存在对象存储或受控本机目录。';
comment on column public.assets.organization_id is '所属组织 ID。';
comment on column public.assets.asset_type is '业务分类：character/scene/prop/sound/style。';
comment on column public.assets.category is '可扩展的二级分类，例如 food。';
comment on column public.assets.media_type is '预览媒介类型：image/audio/video/model/document/other。';
comment on column public.assets.cloud_url is '对象存储或受控外部地址。';
comment on column public.assets.local_path is '仅供受控执行端使用的本机路径，不向普通 Web 查询开放。';
comment on column public.assets.thumbnail_url is '列表与网格视图使用的预览图地址。';
comment on column public.assets.is_active is '启用状态；停用代替浏览器端物理删除。';

create index assets_organization_updated_at_idx
  on public.assets (organization_id, updated_at desc);

create index assets_organization_type_category_updated_at_idx
  on public.assets (organization_id, asset_type, category, updated_at desc);

create index assets_created_by_idx
  on public.assets (created_by);

create index assets_updated_by_idx
  on public.assets (updated_by);

create index assets_search_text_trgm_idx
  on public.assets using gin (search_text extensions.gin_trgm_ops);

create or replace function private.set_asset_audit_fields()
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

revoke all on function private.set_asset_audit_fields() from public, anon, authenticated;

create trigger assets_set_audit_fields
before insert or update on public.assets
for each row execute function private.set_asset_audit_fields();

alter table public.assets enable row level security;

create policy assets_select_viewer
  on public.assets
  for select
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.view')));

create policy assets_insert_manager
  on public.assets
  for insert
  to authenticated
  with check (
    (select private.has_organization_permission(organization_id, 'content.manage'))
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
  );

create policy assets_update_manager
  on public.assets
  for update
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.manage')))
  with check (
    (select private.has_organization_permission(organization_id, 'content.manage'))
    and updated_by = (select auth.uid())
  );

revoke all on public.assets from anon, authenticated;
revoke all on sequence public.assets_id_seq from anon, authenticated;

grant select (
  id,
  organization_id,
  asset_type,
  category,
  media_type,
  name,
  cloud_url,
  thumbnail_url,
  is_active,
  description,
  metadata,
  search_text,
  created_by,
  created_at,
  updated_by,
  updated_at
) on public.assets to authenticated;

grant insert (
  organization_id,
  asset_type,
  category,
  media_type,
  name,
  cloud_url,
  local_path,
  thumbnail_url,
  is_active,
  description,
  metadata,
  created_by,
  updated_by
) on public.assets to authenticated;

grant update (
  asset_type,
  category,
  media_type,
  name,
  cloud_url,
  local_path,
  thumbnail_url,
  is_active,
  description,
  metadata
) on public.assets to authenticated;

grant usage, select on sequence public.assets_id_seq to authenticated;
