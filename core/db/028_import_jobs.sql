-- ============================================================
-- SKUMS Import Jobs
--
-- Purpose:
--   Stage imports before committing them into the product graph.
--   This replaces direct browser-to-products CSV writes over time.
--
-- Run AFTER: 027_integration_listing_bridge.sql
-- ============================================================

-- ============================================================
-- 1. IMPORT JOBS
-- ============================================================

create table if not exists public.import_jobs (
  id                uuid primary key default uuid_generate_v4(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,

  source_type       text not null default 'csv'
    check (source_type in ('csv', 'tsv', 'xlsx', 'json', 'api', 'supplier_feed', 'marketplace_export')),
  source_name       text,
  file_name         text,
  file_size_bytes   bigint,

  target_schema_id  uuid references public.product_schemas(id) on delete set null,
  status            text not null default 'draft'
    check (status in ('draft', 'uploaded', 'mapped', 'validated', 'committing', 'completed', 'failed', 'cancelled')),

  column_mapping    jsonb not null default '{}',
  import_options    jsonb not null default '{}',

  total_rows        int not null default 0,
  valid_rows        int not null default 0,
  error_rows        int not null default 0,
  committed_rows    int not null default 0,

  created_by        uuid references public.profiles(id) on delete set null,
  committed_by      uuid references public.profiles(id) on delete set null,
  committed_at      timestamptz,
  error             text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_import_jobs_workspace
  on public.import_jobs(workspace_id, created_at desc);

create index if not exists idx_import_jobs_status
  on public.import_jobs(workspace_id, status);

alter table public.import_jobs enable row level security;

create policy "Members can view import jobs"
  on public.import_jobs for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage import jobs"
  on public.import_jobs for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.import_jobs
  for each row execute function public.update_updated_at();


-- ============================================================
-- 2. IMPORT JOB ROWS
-- ============================================================

create table if not exists public.import_job_rows (
  id                       uuid primary key default uuid_generate_v4(),
  workspace_id             uuid not null references public.workspaces(id) on delete cascade,
  import_job_id            uuid not null references public.import_jobs(id) on delete cascade,

  row_number               int not null,
  raw_data                 jsonb not null default '{}',

  -- Normalized write plan. A commit worker can turn these into
  -- product graph writes atomically.
  normalized_product       jsonb not null default '{}',
  normalized_identity      jsonb not null default '{}',
  normalized_trade_units   jsonb not null default '[]',
  normalized_identifiers   jsonb not null default '[]',
  normalized_sku_assignments jsonb not null default '[]',
  normalized_listings      jsonb not null default '[]',

  status                   text not null default 'pending'
    check (status in ('pending', 'valid', 'warning', 'error', 'committed', 'skipped')),
  errors                   jsonb not null default '[]',
  warnings                 jsonb not null default '[]',

  product_id               uuid references public.products(id) on delete set null,
  product_identity_id      uuid references public.product_identities(id) on delete set null,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  unique (import_job_id, row_number)
);

create index if not exists idx_import_job_rows_job
  on public.import_job_rows(import_job_id, row_number);

create index if not exists idx_import_job_rows_status
  on public.import_job_rows(import_job_id, status);

alter table public.import_job_rows enable row level security;

create policy "Members can view import rows"
  on public.import_job_rows for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage import rows"
  on public.import_job_rows for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.import_job_rows
  for each row execute function public.update_updated_at();


-- ============================================================
-- 3. IMPORT SUMMARY VIEW
-- ============================================================

create or replace view public.v_import_job_summary
with (security_invoker = true)
as
select
  ij.*,
  coalesce(count(ijr.id), 0)::int as staged_rows,
  coalesce(count(ijr.id) filter (where ijr.status = 'valid'), 0)::int as staged_valid_rows,
  coalesce(count(ijr.id) filter (where ijr.status = 'warning'), 0)::int as staged_warning_rows,
  coalesce(count(ijr.id) filter (where ijr.status = 'error'), 0)::int as staged_error_rows,
  coalesce(count(ijr.id) filter (where ijr.status = 'committed'), 0)::int as staged_committed_rows
from public.import_jobs ij
left join public.import_job_rows ijr
  on ijr.import_job_id = ij.id
group by ij.id;
