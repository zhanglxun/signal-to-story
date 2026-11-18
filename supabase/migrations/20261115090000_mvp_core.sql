-- 0.5 MVP core (docs/database.md §4.1–4.3, DB2a): every input is one immutable intake_events row;
-- every board card is one work_items row whose status is the board column. Content documents gain
-- work_item_id. V1 tables (signals / selections / content_projects / intake_receipts /
-- content_review_events) stay until the retire migration, which calls private.backfill_v1() and
-- then drops them; this migration only adds structure and the backfill function.

-- ── work_items ──────────────────────────────────────────────────────────────
create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null default 'article' check (kind in ('article', 'video')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  brief jsonb not null default '{}'::jsonb check (jsonb_typeof(brief) = 'object' and pg_column_size(brief) <= 65536),
  category_id bigint,
  status text not null default 'todo' check (status in ('todo', 'doing', 'waiting', 'review', 'done', 'dropped')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, category_id) references public.source_categories(organization_id, id)
);
comment on table public.work_items is '看板上的一张卡；status 直接决定看板列（todo/doing/waiting/review/done/dropped）。';
comment on column public.work_items.brief is 'Brief：角度、平台、content_kind、target_seconds、aspect_ratio、旧 Brief 文本，回填来源在 brief.legacy。';
create index work_items_board_idx on public.work_items (organization_id, status, updated_at desc);
create index work_items_category_idx on public.work_items (organization_id, category_id) where category_id is not null;

create function private.guard_work_item() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Signed-in humans cannot forge authorship; RPCs and the V1 backfill (no auth.uid) keep what they pass.
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.created_at := now();
      new.updated_at := now();
    end if;
    return new;
  elsif new.organization_id is distinct from old.organization_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception '不能修改所属组织或创建记录';
  end if;
  new.updated_at := now();
  return new;
end; $$;
revoke all on function private.guard_work_item() from public, anon, authenticated;
create trigger work_items_guard before insert or update on public.work_items
  for each row execute function private.guard_work_item();

alter table public.work_items enable row level security;
revoke all on public.work_items from anon, authenticated;
grant select, insert, update on public.work_items to authenticated;
create policy work_items_read on public.work_items for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.view')));
create policy work_items_insert on public.work_items for insert to authenticated
  with check ((select private.has_organization_permission(organization_id, 'content.manage')));
create policy work_items_update on public.work_items for update to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.manage')))
  with check ((select private.has_organization_permission(organization_id, 'content.manage')));

-- ── intake_events ───────────────────────────────────────────────────────────
create table public.intake_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source text not null check (source in ('web', 'im', 'api', 'chat')),
  connection_id uuid,
  external_id text not null check (char_length(external_id) between 1 and 200),
  text text not null default '' check (char_length(text) <= 100000),
  url text check (url is null or (char_length(url) <= 2048 and url ~ '^https?://[^[:space:]]+$')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 262144),
  work_item_id uuid,
  ignored_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint intake_events_dedupe unique nulls not distinct (organization_id, source, connection_id, external_id),
  foreign key (organization_id, connection_id) references public.intake_connections(organization_id, id),
  foreign key (organization_id, work_item_id) references public.work_items(organization_id, id),
  check (btrim(text) <> '' or url is not null)
);
comment on table public.intake_events is '一条外部输入，不可变（只有 work_item_id / ignored_at 可改）。只能经 record_intake_event 写入。';
comment on column public.intake_events.payload is '附件引用、发送者、reply_to 回复地址、intent、回填来源 legacy 等。';
create index intake_events_inbox_idx on public.intake_events (organization_id, created_at desc)
  where work_item_id is null and ignored_at is null;
create index intake_events_work_item_idx on public.intake_events (organization_id, work_item_id) where work_item_id is not null;
create index intake_events_connection_idx on public.intake_events (organization_id, connection_id) where connection_id is not null;

create function private.guard_intake_event() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'work_item_id' - 'ignored_at') is distinct from (to_jsonb(old) - 'work_item_id' - 'ignored_at') then
    raise exception '原始输入不可修改，只能归入事项或忽略' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function private.guard_intake_event() from public, anon, authenticated;
create trigger intake_events_immutable before update on public.intake_events
  for each row execute function private.guard_intake_event();

alter table public.intake_events enable row level security;
revoke all on public.intake_events from anon, authenticated;
grant select, update (work_item_id, ignored_at) on public.intake_events to authenticated;
create policy intake_events_read on public.intake_events for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.view')));
create policy intake_events_triage on public.intake_events for update to authenticated
  using ((select private.has_organization_permission(organization_id, 'content.manage')))
  with check ((select private.has_organization_permission(organization_id, 'content.manage')));

-- Single writer for every entrance. Duplicates (same dedupe key) return the existing row.
create function public.record_intake_event(
  p_organization_id uuid,
  p_source text,
  p_external_id text,
  p_text text,
  p_url text default null,
  p_payload jsonb default '{}'::jsonb,
  p_connection_id uuid default null
) returns public.intake_events language plpgsql security definer set search_path = '' as $$
declare
  is_service boolean := coalesce(auth.role(), '') = 'service_role';
  r public.intake_events;
begin
  if is_service then
    if p_connection_id is not null and not exists (
      select 1 from public.intake_connections c
      where c.id = p_connection_id and c.organization_id = p_organization_id
        and c.revoked_at is null and c.expires_at > now()
    ) then
      raise exception '连接不存在、已吊销或已过期' using errcode = '42501';
    end if;
  else
    if not private.has_organization_permission(p_organization_id, 'content.manage') then
      raise exception '没有收录权限' using errcode = '42501';
    end if;
    if p_source not in ('web', 'chat') or p_connection_id is not null then
      raise exception '浏览器只能记录 web / chat 输入' using errcode = '42501';
    end if;
  end if;

  insert into public.intake_events (organization_id, source, connection_id, external_id, text, url, payload, created_by)
  values (p_organization_id, p_source, p_connection_id, p_external_id, coalesce(p_text, ''), nullif(btrim(p_url), ''),
          coalesce(p_payload, '{}'::jsonb), auth.uid())
  on conflict on constraint intake_events_dedupe do nothing
  returning * into r;

  if r.id is null then
    select * into r from public.intake_events e
    where e.organization_id = p_organization_id and e.source = p_source
      and e.connection_id is not distinct from p_connection_id and e.external_id = p_external_id;
  end if;
  return r;
end; $$;
revoke all on function public.record_intake_event(uuid, text, text, text, text, jsonb, uuid) from public, anon;
grant execute on function public.record_intake_event(uuid, text, text, text, text, jsonb, uuid) to authenticated, service_role;

-- ── content_documents → work_items ──────────────────────────────────────────
-- Nullable until the retire migration backfills it, makes it NOT NULL and drops project_id.
alter table public.content_documents add column work_item_id uuid;
alter table public.content_documents
  add constraint content_documents_work_item_fkey foreign key (organization_id, work_item_id)
  references public.work_items(organization_id, id);
create unique index content_documents_work_item_platform_key on public.content_documents (work_item_id, platform)
  where work_item_id is not null;

-- ── V1 → 0.5 backfill (called by the retire migration; idempotent) ────────────
-- Every legacy row is reachable from its new row through payload.legacy / brief.legacy.
create function private.backfill_v1() returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n_receipt int; n_signal int; n_sel int; n_sig_item int; n_proj_merge int; n_proj_new int; n_doc int; n_review int;
begin
  -- 1. External receipts keep their original dedupe key.
  insert into public.intake_events (organization_id, source, connection_id, external_id, text, url, payload, created_by, created_at)
  select r.organization_id, 'api', r.connection_id, r.external_id,
         concat_ws(E'\n\n', s.name, s.summary, s.description), s.site_url,
         jsonb_build_object('legacy', jsonb_build_object('receipt_id', r.id, 'signal_id', s.id, 'selection_id', r.selection_id), 'raw', r.payload),
         s.created_by, r.created_at
  from public.intake_receipts r join public.signals s on s.id = r.signal_id
  on conflict on constraint intake_events_dedupe do nothing;
  get diagnostics n_receipt = row_count;

  -- 2. Every other signal becomes a web input.
  insert into public.intake_events (organization_id, source, external_id, text, url, payload, created_by, created_at)
  select s.organization_id, 'web', 'legacy-signal-' || s.id,
         concat_ws(E'\n\n', s.name, s.summary, s.description), s.site_url,
         jsonb_build_object('legacy', jsonb_build_object('signal_id', s.id), 'category_id', s.category_id,
                            'icon_url', s.icon_url, 'is_organized', s.is_organized),
         s.created_by, s.created_at
  from public.signals s
  where not exists (select 1 from public.intake_receipts r where r.signal_id = s.id)
  on conflict on constraint intake_events_dedupe do nothing;
  get diagnostics n_signal = row_count;

  -- 3. Selections become cards.
  insert into public.work_items (organization_id, kind, title, brief, category_id, status, created_by, created_at, updated_at)
  select sel.organization_id, 'article', sel.name,
         jsonb_strip_nulls(jsonb_build_object(
           'core_thesis', sel.core_thesis, 'angle_type', sel.angle_type, 'content_format', sel.content_format,
           'negative_prompts', sel.negative_prompts, 'outline_template', sel.outline_template,
           'priority', sel.priority, 'description', sel.description,
           'legacy', jsonb_build_object('selection_id', sel.id, 'signal_id', sel.signal_id))),
         sig.category_id, case when sel.is_completed then 'done' else 'todo' end, sel.created_by, sel.created_at, sel.updated_at
  from public.selections sel join public.signals sig on sig.id = sel.signal_id
  where not exists (select 1 from public.work_items w where w.brief -> 'legacy' ->> 'selection_id' = sel.id::text);
  get diagnostics n_sel = row_count;

  -- 4. Organized signals without any selection still become a card.
  insert into public.work_items (organization_id, kind, title, brief, category_id, status, created_by, created_at, updated_at)
  select s.organization_id, 'article', left(s.name, 200),
         jsonb_strip_nulls(jsonb_build_object('summary', s.summary, 'legacy', jsonb_build_object('signal_id', s.id))),
         s.category_id, 'todo', s.created_by, s.created_at, s.updated_at
  from public.signals s
  where s.is_organized
    and not exists (select 1 from public.selections sel where sel.signal_id = s.id)
    and not exists (select 1 from public.work_items w where w.brief -> 'legacy' ->> 'signal_id' = s.id::text and w.brief -> 'legacy' ->> 'selection_id' is null);
  get diagnostics n_sig_item = row_count;

  -- Link each signal's input to its first card.
  update public.intake_events e set work_item_id = w.id
  from public.work_items w
  where e.work_item_id is null
    and w.organization_id = e.organization_id
    and w.brief -> 'legacy' ->> 'signal_id' = e.payload -> 'legacy' ->> 'signal_id'
    and w.id = (select w2.id from public.work_items w2
                where w2.organization_id = e.organization_id and w2.brief -> 'legacy' ->> 'signal_id' = e.payload -> 'legacy' ->> 'signal_id'
                order by (w2.brief -> 'legacy' ->> 'selection_id')::bigint nulls last, w2.created_at limit 1);

  -- 5. Projects: the first project of a selection merges into that card; any other project becomes its own card.
  with ranked as (
    select p.*, row_number() over (partition by p.selection_id order by p.created_at, p.id) as rn
    from public.content_projects p
  )
  update public.work_items w set
    brief = w.brief || jsonb_strip_nulls(jsonb_build_object(
      'text', nullif(r.brief, ''), 'content_kind', r.content_kind, 'target_seconds', r.target_seconds, 'aspect_ratio', r.aspect_ratio))
      || jsonb_build_object('legacy', (w.brief -> 'legacy') || jsonb_build_object('content_project_id', r.id, 'archived', r.archived)),
    status = case when r.archived and w.status not in ('done', 'dropped') then 'done' else w.status end
  from ranked r
  where r.selection_id is not null and r.rn = 1
    and w.organization_id = r.organization_id
    and w.brief -> 'legacy' ->> 'selection_id' = r.selection_id::text
    and w.brief -> 'legacy' ->> 'content_project_id' is null;
  get diagnostics n_proj_merge = row_count;

  insert into public.work_items (organization_id, kind, title, brief, status, created_by, created_at, updated_at)
  select p.organization_id, 'article', left(p.title, 200),
         jsonb_strip_nulls(jsonb_build_object(
           'text', nullif(p.brief, ''), 'content_kind', p.content_kind, 'target_seconds', p.target_seconds, 'aspect_ratio', p.aspect_ratio,
           -- project_selection_id, not selection_id: only the selection's own card carries legacy.selection_id.
           'legacy', jsonb_build_object('content_project_id', p.id, 'project_selection_id', p.selection_id, 'archived', p.archived))),
         case when p.archived then 'done' else 'todo' end, p.created_by, p.created_at, p.updated_at
  from public.content_projects p
  where not exists (select 1 from public.work_items w where w.brief -> 'legacy' ->> 'content_project_id' = p.id::text);
  get diagnostics n_proj_new = row_count;

  -- 6. Documents follow their project's card. The V1 guard/snapshot triggers require a signed-in
  -- user and would record a review event; this is a structural move, so they are off for this statement.
  alter table public.content_documents disable trigger user;
  update public.content_documents d set work_item_id = w.id
  from public.work_items w
  where d.work_item_id is null and w.organization_id = d.organization_id
    and w.brief -> 'legacy' ->> 'content_project_id' = d.project_id::text;
  get diagnostics n_doc = row_count;
  alter table public.content_documents enable trigger user;

  -- 7. Review history becomes generic audit events.
  insert into public.audit_events (organization_id, actor_user_id, action, target_type, target_id, metadata, created_at)
  select v.organization_id, v.created_by, 'content.' || v.status, 'content_document', v.document_id::text,
         jsonb_build_object('revision', v.revision, 'note', v.note, 'legacy', jsonb_build_object('review_event_id', v.id)),
         v.created_at
  from public.content_review_events v
  where not exists (select 1 from public.audit_events a where a.metadata -> 'legacy' ->> 'review_event_id' = v.id::text);
  get diagnostics n_review = row_count;

  return jsonb_build_object(
    'receipts', n_receipt, 'signals', n_signal, 'selections', n_sel, 'organized_signals', n_sig_item,
    'projects_merged', n_proj_merge, 'projects_new', n_proj_new, 'documents', n_doc, 'review_events', n_review);
end; $$;
revoke all on function private.backfill_v1() from public, anon, authenticated, service_role;
