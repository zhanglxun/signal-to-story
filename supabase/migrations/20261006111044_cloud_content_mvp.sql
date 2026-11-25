-- Cloud-authored content; Obsidian is an optional export destination.
create table public.content_projects (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 selection_id bigint, title text not null check(char_length(btrim(title)) between 1 and 160),
 brief text not null default '' check(char_length(brief)<=20000),
 content_kind text not null default 'explainer' check(content_kind in ('explainer','knowledge','story')),
 target_seconds integer not null default 300 check(target_seconds between 1 and 3600), aspect_ratio text not null default '9:16' check(aspect_ratio in ('9:16','16:9','1:1')),
 archived boolean not null default false,
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id), foreign key(organization_id,selection_id) references public.selections(organization_id,id)
);
create table public.content_documents (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null,
 platform text not null default 'master' check(platform in ('master','wechat_channels','wechat_official','xiaohongshu','douyin','x','youtube','reddit')),
 title text not null check(char_length(btrim(title)) between 1 and 200), body text not null default '' check(char_length(body)<=100000),
 status text not null default 'draft' check(status in ('draft','in_review','approved','changes_requested')),
 revision integer not null default 1, review_note text not null default '' check(char_length(review_note)<=4000),
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id), unique(project_id,platform), foreign key(organization_id,project_id) references public.content_projects(organization_id,id)
);
create table public.content_revisions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, document_id uuid not null, revision integer not null,
 title text not null, body text not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(organization_id,document_id,revision), foreign key(organization_id,document_id) references public.content_documents(organization_id,id)
);
create table public.content_review_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, document_id uuid not null, revision integer not null,
 status text not null, note text not null default '', created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(organization_id,document_id,revision) references public.content_revisions(organization_id,document_id,revision)
);
create table public.publishing_channels (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 platform text not null check(platform in ('wechat_channels','wechat_official','xiaohongshu','douyin','x','youtube','reddit')),
 name text not null check(char_length(btrim(name)) between 1 and 100), profile_url text not null default '' check(profile_url='' or profile_url ~ '^https?://[^[:space:]]+$'),
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,platform,name)
);
create table public.content_publications (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, document_id uuid not null, revision integer not null, channel_id uuid not null,
 scheduled_at timestamptz not null, status text not null default 'planned' check(status in ('planned','published','cancelled')),
 published_at timestamptz, published_url text not null default '',
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id), unique(document_id,revision,channel_id),
 foreign key(organization_id,document_id,revision) references public.content_revisions(organization_id,document_id,revision),
 foreign key(organization_id,channel_id) references public.publishing_channels(organization_id,id),
 check(status<>'published' or (published_at is not null and published_url ~ '^https?://[^[:space:]]+$'))
);
create table public.publication_metrics (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, publication_id uuid not null,
 observed_at timestamptz not null, views bigint check(views>=0), likes bigint check(likes>=0), saves bigint check(saves>=0), comments bigint check(comments>=0),
 retrospective text not null default '' check(char_length(retrospective)<=10000),
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
 foreign key(organization_id,publication_id) references public.content_publications(organization_id,id), unique(publication_id,observed_at)
);
-- Existing assets are bigint; composite key prevents cross-organization links.
alter table public.assets add constraint assets_org_id_cloud_key unique(organization_id,id);
create table public.content_project_assets (
 organization_id uuid not null, project_id uuid not null, asset_id bigint not null,
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
 primary key(project_id,asset_id), foreign key(organization_id,project_id) references public.content_projects(organization_id,id),
 foreign key(organization_id,asset_id) references public.assets(organization_id,id)
);
-- Existing owner/admin roles can self-review. Other editors submit for review.
update public.organization_roles set permissions = array(select distinct unnest(permissions || array['content.review','content.publish'])) where role_key in ('owner','admin');

create function private.guard_cloud_content() returns trigger language plpgsql set search_path='' as $$
begin
 if auth.uid() is null then raise exception '需要登录' using errcode='42501'; end if;
 if tg_op='INSERT' then
  new.created_by:=auth.uid(); new.created_at:=now();
 else
  if new.organization_id is distinct from old.organization_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
   raise exception '不能修改所属组织或创建记录';
  end if;
 end if;
 if tg_table_name in ('content_projects','content_documents','content_publications') then new.updated_at:=now(); end if;
 if tg_table_name='content_documents' then
  if tg_op='INSERT' then
   if new.status<>'draft' then raise exception '新稿件必须为草稿'; end if;
   new.revision:=1;
  else
   if new.project_id<>old.project_id or new.platform<>old.platform or new.revision<>old.revision then raise exception '不能修改稿件归属或版本号'; end if;
   if new.title is distinct from old.title or new.body is distinct from old.body then
    if not private.has_organization_permission(new.organization_id,'content.manage') then raise exception '没有编辑权限' using errcode='42501'; end if;
    new.revision:=old.revision+1; new.status:='draft'; new.review_note:='';
   elsif new.status<>old.status then
    if new.status='in_review' then
     if old.status not in ('draft','changes_requested') or btrim(new.body)='' or not private.has_organization_permission(new.organization_id,'content.manage') then raise exception '稿件不能提交审核'; end if;
    elsif new.status in ('approved','changes_requested') then
     if old.status<>'in_review' or not private.has_organization_permission(new.organization_id,'content.review') then raise exception '需要审核权限及待审核稿件' using errcode='42501'; end if;
     if new.status='changes_requested' and btrim(new.review_note)='' then raise exception '请填写退回原因'; end if;
    else raise exception '无效的审核状态变化'; end if;
   elsif new.review_note is distinct from old.review_note then raise exception '审核意见必须随审核决定提交';
   end if;
  end if;
 elsif tg_table_name='content_publications' then
  if tg_op='UPDATE' then
   if new.document_id<>old.document_id or new.revision<>old.revision or new.channel_id<>old.channel_id then raise exception '请取消旧计划后重新安排版本'; end if;
   if old.status<>'planned' then raise exception '已完成或取消的发布记录不可修改'; end if;
  elsif new.status<>'planned' then raise exception '请先创建发布计划'; end if;
  if new.status<>'cancelled' and not exists(
    select 1 from public.content_documents d join public.publishing_channels c on c.id=new.channel_id
    where d.id=new.document_id and d.organization_id=new.organization_id and c.organization_id=new.organization_id
    and d.platform=c.platform and d.status='approved' and d.revision=new.revision
  ) then raise exception '仅可发布已审核的最新版本，且账号平台必须匹配'; end if;
  if new.status='published' and new.published_at>now()+interval '5 minutes' then raise exception '实际发布时间不能晚于现在'; end if;
 elsif tg_table_name='publication_metrics' then
  if not exists(select 1 from public.content_publications p where p.id=new.publication_id and p.status='published' and new.observed_at>=p.published_at) then raise exception '只能回填已发布内容，观察时间不能早于发布时间'; end if;
  if new.observed_at>now()+interval '5 minutes' then raise exception '观察时间不能晚于现在'; end if;
 end if;
 return new;
end; $$;
revoke all on function private.guard_cloud_content() from public,anon,authenticated;
-- Private trigger is the only writer of immutable revisions and review audit.
create function private.snapshot_cloud_document() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception '需要登录'; end if;
 if tg_op='INSERT' or new.revision<>old.revision then
  insert into public.content_revisions(organization_id,document_id,revision,title,body,created_by) values(new.organization_id,new.id,new.revision,new.title,new.body,auth.uid());
 end if;
 if tg_op='INSERT' or new.status<>old.status or new.revision<>old.revision then
  insert into public.content_review_events(organization_id,document_id,revision,status,note,created_by) values(new.organization_id,new.id,new.revision,new.status,new.review_note,auth.uid());
 end if;
 return new;
end; $$;
revoke all on function private.snapshot_cloud_document() from public,anon,authenticated;
create trigger document_snapshot after insert or update on public.content_documents for each row execute function private.snapshot_cloud_document();

-- Read access follows content.view; writes use narrowly scoped permissions.
do $$ declare t text; perm text; begin
 foreach t in array array['content_projects','content_documents','content_revisions','content_review_events','publishing_channels','content_publications','publication_metrics','content_project_assets'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy cloud_read on public.%I for select to authenticated using ((select private.has_organization_permission(organization_id,''content.view'')))',t);
  execute format('create index on public.%I (organization_id)',t);
  if t not in ('content_revisions','content_review_events') then
   perm:=case when t in ('publishing_channels','content_publications','publication_metrics') then 'content.publish' else 'content.manage' end;
   execute format('grant insert on public.%I to authenticated',t);
   execute format('create policy cloud_insert on public.%I for insert to authenticated with check ((select private.has_organization_permission(organization_id,%L)) and created_by=(select auth.uid()))',t,perm);
   execute format('create trigger cloud_guard before insert or update on public.%I for each row execute function private.guard_cloud_content()',t);
   if t in ('content_projects','content_documents','content_publications') then
    execute format('grant update on public.%I to authenticated',t);
    if t='content_documents' then
     execute 'create policy cloud_update on public.content_documents for update to authenticated using (private.has_organization_permission(organization_id,''content.manage'') or private.has_organization_permission(organization_id,''content.review'')) with check (private.has_organization_permission(organization_id,''content.manage'') or private.has_organization_permission(organization_id,''content.review''))';
    else
     execute format('create policy cloud_update on public.%I for update to authenticated using ((select private.has_organization_permission(organization_id,%L))) with check ((select private.has_organization_permission(organization_id,%L)))',t,perm,perm);
    end if;
   end if;
  end if;
 end loop;
end $$;
create index on public.content_projects(organization_id,updated_at desc);
create index on public.content_documents(organization_id,status,updated_at desc);
create index on public.content_revisions(document_id,revision desc);
create index on public.content_review_events(document_id,created_at desc);
create index on public.content_publications(organization_id,scheduled_at);
create index on public.content_publications(channel_id);
create index on public.content_project_assets(asset_id);

create table public.content_ai_proposals (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, document_id uuid not null, input_revision integer not null,
 model text not null, prompt_version text not null default 'draft-v1', instruction text not null, input_brief text not null,
 status text not null check(status in ('running','succeeded','failed')), body text, error text, usage jsonb,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), finished_at timestamptz,
 foreign key(organization_id,document_id,input_revision) references public.content_revisions(organization_id,document_id,revision)
);
alter table public.content_ai_proposals enable row level security;
revoke all on public.content_ai_proposals from anon,authenticated;
grant select on public.content_ai_proposals to authenticated;
grant all on public.content_ai_proposals to service_role;
create policy ai_proposals_read on public.content_ai_proposals for select to authenticated using ((select private.has_organization_permission(organization_id,'content.view')));
create index on public.content_ai_proposals(organization_id,document_id,created_at desc);
create unique index ai_one_active_document on public.content_ai_proposals(document_id) where status='running';
