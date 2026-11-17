create table public.storage_provider_configs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  bucket text not null,
  object_prefix text not null default '',
  endpoint text,
  public_base_url text,
  status text not null default 'ready',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint storage_provider_configs_provider_check check (provider in ('supabase', 'qiniu_kodo', 'aliyun_oss', 'tencent_cos', 'cloudflare_r2')),
  constraint storage_provider_configs_status_check check (status in ('ready', 'pending_secret', 'disabled')),
  constraint storage_provider_configs_bucket_length check (char_length(btrim(bucket)) between 1 and 120),
  constraint storage_provider_configs_prefix_length check (char_length(object_prefix) <= 512),
  constraint storage_provider_configs_endpoint_length check (endpoint is null or char_length(endpoint) <= 1024),
  constraint storage_provider_configs_public_base_url_length check (public_base_url is null or char_length(public_base_url) <= 2048),
  unique (organization_id, provider)
);

create unique index storage_provider_configs_one_default_per_organization
  on public.storage_provider_configs (organization_id)
  where is_default;

alter table public.storage_provider_configs enable row level security;

create policy storage_provider_configs_select_viewer on public.storage_provider_configs for select to authenticated
using ((select private.has_organization_permission(organization_id, 'content.view')));
create policy storage_provider_configs_insert_owner on public.storage_provider_configs for insert to authenticated
with check ((select private.has_organization_permission(organization_id, 'organization.manage')));
create policy storage_provider_configs_update_owner on public.storage_provider_configs for update to authenticated
using ((select private.has_organization_permission(organization_id, 'organization.manage')))
with check ((select private.has_organization_permission(organization_id, 'organization.manage')));

revoke all on public.storage_provider_configs from anon, authenticated;
revoke all on sequence public.storage_provider_configs_id_seq from anon, authenticated;
grant select on public.storage_provider_configs to authenticated;
grant insert (organization_id, provider, bucket, object_prefix, endpoint, public_base_url, status, is_default) on public.storage_provider_configs to authenticated;
grant update (bucket, object_prefix, endpoint, public_base_url, status, is_default) on public.storage_provider_configs to authenticated;
grant usage, select on sequence public.storage_provider_configs_id_seq to authenticated;

insert into public.storage_provider_configs (organization_id, provider, bucket, object_prefix, status, is_default)
select id, 'supabase', 'prompt-examples', '', 'ready', true from public.organizations
on conflict (organization_id, provider) do nothing;

insert into public.storage_provider_configs (organization_id, provider, bucket, object_prefix, endpoint, status, is_default)
select id, 'qiniu_kodo', 'digital-loom', 'signal-story', 'https://up-z2.qiniup.com', 'ready', false from public.organizations
on conflict (organization_id, provider) do nothing;
