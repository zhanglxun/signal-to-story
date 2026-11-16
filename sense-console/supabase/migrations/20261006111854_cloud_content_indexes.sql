-- Reuse the original assets composite unique key, and cover tenant-scoped FKs.
alter table public.content_project_assets drop constraint content_project_assets_organization_id_asset_id_fkey;
alter table public.assets drop constraint assets_org_id_cloud_key;
alter table public.content_project_assets add constraint content_project_assets_organization_id_asset_id_fkey foreign key(organization_id,asset_id) references public.assets(organization_id,id);
create index on public.content_projects(organization_id,selection_id);
create index on public.content_documents(organization_id,project_id);
create index on public.content_review_events(organization_id,document_id,revision);
create index on public.content_publications(organization_id,document_id,revision);
create index on public.content_publications(organization_id,channel_id);
create index on public.publication_metrics(organization_id,publication_id);
create index on public.content_project_assets(organization_id,project_id);
create index on public.content_project_assets(organization_id,asset_id);
create index on public.content_ai_proposals(organization_id,document_id,input_revision);
do $$ declare t text; begin
 foreach t in array array['content_projects','content_documents','content_revisions','content_review_events','publishing_channels','content_publications','publication_metrics','content_project_assets','content_ai_proposals'] loop
  execute format('create index on public.%I(created_by)',t);
 end loop;
end $$;
