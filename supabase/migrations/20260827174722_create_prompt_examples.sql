-- Prompt and image-reference intake library. A prompt can keep an external
-- example-image URL now and optionally link to a managed image asset later.

alter table public.assets
  add constraint assets_organization_id_id_key unique (organization_id, id);

create table public.prompt_examples (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  prompt_text text not null,
  negative_prompt text,
  example_image_url text,
  example_asset_id bigint,
  source_url text,
  source_author text,
  origin_type text not null default 'collected',
  tags text[] not null default '{}'::text[],
  status text not null default 'inbox',
  visibility text not null default 'private',
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint prompt_examples_title_length
    check (char_length(btrim(title)) between 1 and 120),
  constraint prompt_examples_prompt_text_length
    check (char_length(btrim(prompt_text)) between 1 and 8000),
  constraint prompt_examples_negative_prompt_length
    check (negative_prompt is null or char_length(negative_prompt) <= 4000),
  constraint prompt_examples_example_image_url_length
    check (example_image_url is null or char_length(example_image_url) <= 2048),
  constraint prompt_examples_source_url_length
    check (source_url is null or char_length(source_url) <= 2048),
  constraint prompt_examples_source_author_length
    check (source_author is null or char_length(source_author) <= 120),
  constraint prompt_examples_origin_type_check
    check (origin_type in ('collected', 'self_created')),
  constraint prompt_examples_tags_limit
    check (cardinality(tags) <= 12),
  constraint prompt_examples_status_check
    check (status in ('inbox', 'curated', 'archived')),
  constraint prompt_examples_visibility_check
    check (visibility in ('private', 'shared')),
  constraint prompt_examples_notes_length
    check (notes is null or char_length(notes) <= 4000),
  constraint prompt_examples_asset_fkey
    foreign key (organization_id, example_asset_id)
    references public.assets (organization_id, id)
    on delete restrict
);

comment on table public.prompt_examples is
  '提示词与图例收集库：网络收集或自主创作的提示词，可关联外部图例或资产库图片。';
comment on column public.prompt_examples.visibility is
  '私有或可共享标记；shared 目前不提供匿名公开读取。';
comment on column public.prompt_examples.example_asset_id is
  '可选关联资产库中的图片资产；与 organization_id 组成跨组织保护外键。';

create index prompt_examples_organization_updated_at_idx
  on public.prompt_examples (organization_id, updated_at desc);

create index prompt_examples_organization_status_updated_at_idx
  on public.prompt_examples (organization_id, status, updated_at desc);

create index prompt_examples_organization_asset_idx
  on public.prompt_examples (organization_id, example_asset_id)
  where example_asset_id is not null;

create index prompt_examples_created_by_idx
  on public.prompt_examples (created_by);

create index prompt_examples_updated_by_idx
  on public.prompt_examples (updated_by);

create trigger prompt_examples_set_audit_fields
before insert or update on public.prompt_examples
for each row execute function private.set_audit_fields();

alter table public.prompt_examples enable row level security;

create policy prompt_examples_select_viewer
  on public.prompt_examples
  for select
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.view')));

create policy prompt_examples_insert_manager
  on public.prompt_examples
  for insert
  to authenticated
  with check (
    (select private.has_organization_permission(organization_id, 'content.manage'))
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
  );

create policy prompt_examples_update_manager
  on public.prompt_examples
  for update
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.manage')))
  with check (
    (select private.has_organization_permission(organization_id, 'content.manage'))
    and updated_by = (select auth.uid())
  );

create policy prompt_examples_delete_manager
  on public.prompt_examples
  for delete
  to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.manage')));

revoke all on public.prompt_examples from anon, authenticated;
revoke all on sequence public.prompt_examples_id_seq from anon, authenticated;

grant select (
  id, organization_id, title, prompt_text, negative_prompt, example_image_url,
  example_asset_id, source_url, source_author, origin_type, tags, status,
  visibility, notes, created_by, created_at, updated_by, updated_at
) on public.prompt_examples to authenticated;

grant insert (
  organization_id, title, prompt_text, negative_prompt, example_image_url,
  example_asset_id, source_url, source_author, origin_type, tags, status,
  visibility, notes, created_by, updated_by
) on public.prompt_examples to authenticated;

grant update (
  title, prompt_text, negative_prompt, example_image_url, example_asset_id,
  source_url, source_author, origin_type, tags, status, visibility, notes
) on public.prompt_examples to authenticated;

grant delete on public.prompt_examples to authenticated;
grant usage, select on sequence public.prompt_examples_id_seq to authenticated;
