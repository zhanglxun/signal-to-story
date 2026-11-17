-- Video studio -> publish plan link (minimal): a planned publication may reference the composed video asset.
-- The guard trigger (private.guard_cloud_content) is unchanged: approved-revision and platform checks still apply.
-- The composite FK keeps the asset inside the same organization; NULL (ordinary text publications) is unconstrained.
alter table public.content_publications add column video_asset_id bigint;
alter table public.content_publications
  add constraint content_publications_video_asset_fkey
  foreign key (organization_id, video_asset_id) references public.assets (organization_id, id) on delete set null (video_asset_id);
create index content_publications_video_asset_idx on public.content_publications (organization_id, video_asset_id) where video_asset_id is not null;
comment on column public.content_publications.video_asset_id is '可选：视频工坊合成成片的 assets.id（加入发布计划时写入）。';
