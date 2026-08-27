-- Images are private objects. The browser receives short-lived signed URLs only
-- after Storage RLS confirms the current member can view the organization.

alter table public.prompt_examples
  add column example_storage_path text;

alter table public.prompt_examples
  add constraint prompt_examples_example_storage_path_length
  check (example_storage_path is null or char_length(example_storage_path) <= 1024);

comment on column public.prompt_examples.example_storage_path is
  '私有 Supabase Storage 对象路径；路径第一段为 organization_id。';

grant select (example_storage_path) on public.prompt_examples to authenticated;
grant insert (example_storage_path) on public.prompt_examples to authenticated;
grant update (example_storage_path) on public.prompt_examples to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'prompt-examples',
  'prompt-examples',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy prompt_examples_storage_select_viewer
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'prompt-examples'
    and (select private.has_organization_permission(
      (storage.foldername(name))[1]::uuid,
      'content.view'
    ))
  );

create policy prompt_examples_storage_insert_manager
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'prompt-examples'
    and (select private.has_organization_permission(
      (storage.foldername(name))[1]::uuid,
      'content.manage'
    ))
  );

create policy prompt_examples_storage_update_manager
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'prompt-examples'
    and (select private.has_organization_permission(
      (storage.foldername(name))[1]::uuid,
      'content.manage'
    ))
  )
  with check (
    bucket_id = 'prompt-examples'
    and (select private.has_organization_permission(
      (storage.foldername(name))[1]::uuid,
      'content.manage'
    ))
  );

create policy prompt_examples_storage_delete_manager
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'prompt-examples'
    and (select private.has_organization_permission(
      (storage.foldername(name))[1]::uuid,
      'content.manage'
    ))
  );
