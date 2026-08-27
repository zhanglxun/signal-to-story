-- Cover auth.users foreign keys so user lifecycle checks do not scan content tables.

create index source_categories_created_by_idx
  on public.source_categories (created_by);

create index source_categories_updated_by_idx
  on public.source_categories (updated_by);

create index signals_created_by_idx
  on public.signals (created_by);

create index signals_updated_by_idx
  on public.signals (updated_by);

create index selections_created_by_idx
  on public.selections (created_by);

create index selections_updated_by_idx
  on public.selections (updated_by);
