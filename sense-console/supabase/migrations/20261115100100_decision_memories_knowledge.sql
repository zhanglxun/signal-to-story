-- P1.5: Decision Memory (human decisions the agent must respect) and the cloud knowledge base.
-- Only trusted knowledge and active memories enter the system zone of a Context Pack;
-- unreviewed knowledge is reference material in the untrusted zone.

create table public.decision_memories (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 kind text not null check (kind in ('approved_preference','rejected_pattern','style_rule','taboo_topic')),
 summary text not null check (char_length(btrim(summary)) between 1 and 500),
 human_quote text not null default '' check (char_length(human_quote) <= 2000),
 platform text check (platform is null or platform in ('master','wechat_channels','wechat_official','xiaohongshu','douyin','x','youtube','reddit','site')),
 content_kind text check (content_kind is null or content_kind in ('explainer','knowledge','story','video')),
 active boolean not null default true,
 expires_at timestamptz,
 source text not null default 'manual' check (source in ('review_event','retrospective','manual')),
 source_ref text check (source_ref is null or char_length(source_ref) <= 128),
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (organization_id, id)
);
comment on table public.decision_memories is '人工决定记忆：platform/content_kind 为空表示全局适用。Agent 只读。';

create table public.knowledge_entries (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 slug text not null check (slug ~ '^[a-z0-9][a-z0-9_-]{0,119}$'),
 title text not null check (char_length(btrim(title)) between 1 and 200),
 category text not null default 'domain_fact' check (category in ('sop','brand_voice','domain_fact','decision_memory')),
 tags text[] not null default '{}'::text[] check (cardinality(tags) <= 32),
 content text not null check (char_length(content) between 1 and 200000),
 source_url text check (source_url is null or source_url ~ '^https?://[^[:space:]]+$'),
 source_path text check (source_path is null or (char_length(source_path) <= 512 and source_path !~ '(^/|\.\.)')),
 trust_level text not null default 'unreviewed' check (trust_level in ('trusted','unreviewed','archived')),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (organization_id, slug),
 unique (organization_id, id)
);
comment on column public.knowledge_entries.content is '原文 Markdown，不做正则清洗；渲染时由 markdown-it(html:false) 负责安全。';
comment on column public.knowledge_entries.trust_level is 'trusted 才能进入 system prompt；导入默认 unreviewed，只能作为不可信参考资料。';

create function private.guard_knowledge_memory() returns trigger language plpgsql set search_path='' as $$
declare seeding boolean := auth.uid() is null and current_user not in ('authenticated','anon','service_role');
begin
 if tg_op = 'UPDATE' and (new.organization_id is distinct from old.organization_id or new.created_by is distinct from old.created_by
  or new.created_at is distinct from old.created_at) then
  raise exception '不能修改所属组织或创建记录' using errcode='check_violation';
 end if;
 if tg_op = 'INSERT' and not seeding then
  new.created_by := auth.uid(); new.created_at := now();
 end if;
 new.updated_at := now();
 if tg_table_name = 'knowledge_entries' then
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then raise exception 'slug 不可修改' using errcode='check_violation'; end if;
  if seeding then
   if new.trust_level = 'trusted' then new.reviewed_at := coalesce(new.reviewed_at, now()); end if;
   return new;
  end if;
  -- Content edits invalidate trust unless a reviewer re-trusts in the same write.
  if tg_op = 'UPDATE' and old.trust_level = 'trusted' and new.trust_level = 'trusted'
   and (new.content is distinct from old.content or new.title is distinct from old.title)
   and not private.has_organization_permission(new.organization_id, 'content.review') then
   new.trust_level := 'unreviewed';
  end if;
  if new.trust_level = 'trusted' and (tg_op = 'INSERT' or old.trust_level <> 'trusted'
   or new.content is distinct from old.content or new.title is distinct from old.title) then
   if not private.has_organization_permission(new.organization_id, 'content.review') then
    raise exception '只有审核者可以把知识标记为可信' using errcode='42501';
   end if;
   new.reviewed_by := auth.uid(); new.reviewed_at := now();
  elsif new.trust_level <> 'trusted' then
   new.reviewed_by := null; new.reviewed_at := null;
  else
   new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
  end if;
 end if;
 return new;
end; $$;
revoke all on function private.guard_knowledge_memory() from public, anon, authenticated;
create trigger decision_memory_guard before insert or update on public.decision_memories
 for each row execute function private.guard_knowledge_memory();
create trigger knowledge_entry_guard before insert or update on public.knowledge_entries
 for each row execute function private.guard_knowledge_memory();

alter table public.decision_memories enable row level security;
alter table public.knowledge_entries enable row level security;
revoke all on public.decision_memories, public.knowledge_entries from anon, authenticated, service_role;
grant select, insert, update on public.decision_memories, public.knowledge_entries to authenticated;
-- Agents and workers are read-only on governance data.
grant select on public.decision_memories, public.knowledge_entries to service_role;

create policy decision_memories_read on public.decision_memories for select to authenticated
 using ((select private.has_organization_permission(organization_id,'content.view')));
create policy decision_memories_insert on public.decision_memories for insert to authenticated
 with check ((select private.has_organization_permission(organization_id,'content.manage')) and created_by = (select auth.uid()));
create policy decision_memories_update on public.decision_memories for update to authenticated
 using ((select private.has_organization_permission(organization_id,'content.manage')))
 with check ((select private.has_organization_permission(organization_id,'content.manage')));

create policy knowledge_entries_read on public.knowledge_entries for select to authenticated
 using ((select private.has_organization_permission(organization_id,'content.view')));
create policy knowledge_entries_insert on public.knowledge_entries for insert to authenticated
 with check ((select private.has_organization_permission(organization_id,'content.manage')) and created_by = (select auth.uid()));
create policy knowledge_entries_update on public.knowledge_entries for update to authenticated
 using ((select private.has_organization_permission(organization_id,'content.manage')))
 with check ((select private.has_organization_permission(organization_id,'content.manage')));

create index decision_memories_scope_idx on public.decision_memories (organization_id, active, created_at desc);
create index decision_memories_platform_idx on public.decision_memories (organization_id, platform, content_kind);
create index decision_memories_created_by_idx on public.decision_memories (created_by);
create index knowledge_entries_trust_idx on public.knowledge_entries (organization_id, trust_level, category);
create index knowledge_entries_tags_idx on public.knowledge_entries using gin (tags);
create index knowledge_entries_created_by_idx on public.knowledge_entries (created_by);
create index knowledge_entries_reviewed_by_idx on public.knowledge_entries (reviewed_by);
