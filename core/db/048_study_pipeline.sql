-- ============================================================
-- SKUMS — Study sessions and pipeline candidates
--
-- Purpose:
--   Interactive study workflow (MCP / UI) and explicit promotion
--   into watchlist, catalog drafts, purchase interest, etc.
--
-- Run AFTER: 047_marketplace_intelligence.sql
-- Related: Major Update.md Phase 0 / 3
-- ============================================================

create table if not exists public.study_sessions (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  status                text not null default 'open'
    check (status in ('open', 'briefed', 'proposed', 'closed', 'cancelled')),
  hypothesis            text not null,
  marketplace           text not null default 'shopee',
  country               text not null default 'sg',
  query                 text,
  linked_product_id     uuid references public.products(id) on delete set null,
  opened_by             uuid references public.profiles(id) on delete set null,
  closed_at             timestamptz,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_study_sessions_workspace
  on public.study_sessions(workspace_id, created_at desc);

create index if not exists idx_study_sessions_status
  on public.study_sessions(workspace_id, status, created_at desc);

alter table public.study_sessions enable row level security;

drop policy if exists "Members can view study sessions"
  on public.study_sessions;
create policy "Members can view study sessions"
  on public.study_sessions for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage study sessions"
  on public.study_sessions;
create policy "Members can manage study sessions"
  on public.study_sessions for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.study_sessions
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.study_sessions;
create trigger set_updated_at before update on public.study_sessions
  for each row execute function public.update_updated_at();


create table if not exists public.study_artifacts (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  session_id            uuid not null references public.study_sessions(id) on delete cascade,

  artifact_type         text not null
    check (artifact_type in (
      'serp_table', 'brief', 'match', 'chart_spec', 'raw_job',
      'export_table', 'note', 'other'
    )),
  title                 text,
  payload               jsonb not null default '{}',
  evidence_refs         text[] not null default '{}',
  grok_model            text,
  crawl_job_id          uuid references public.marketplace_crawl_jobs(id) on delete set null,
  created_at            timestamptz not null default now()
);

create index if not exists idx_study_artifacts_session
  on public.study_artifacts(session_id, created_at desc);

create index if not exists idx_study_artifacts_workspace
  on public.study_artifacts(workspace_id, created_at desc);

alter table public.study_artifacts enable row level security;

drop policy if exists "Members can view study artifacts"
  on public.study_artifacts;
create policy "Members can view study artifacts"
  on public.study_artifacts for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage study artifacts"
  on public.study_artifacts;
create policy "Members can manage study artifacts"
  on public.study_artifacts for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.study_artifacts
  to authenticated, service_role;


create table if not exists public.pipeline_candidates (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  source_study_id       uuid references public.study_sessions(id) on delete set null,

  kind                  text not null
    check (kind in (
      'watchlist_seed',
      'catalog_product',
      'purchase_interest',
      'price_model',
      'forecast_input',
      'supplier_research',
      'channel_listing'
    )),
  status                text not null default 'proposed'
    check (status in (
      'proposed', 'accepted', 'rejected', 'deferred', 'executed', 'failed'
    )),

  title                 text not null,
  summary               text,
  payload               jsonb not null default '{}',
  evidence_refs         text[] not null default '{}',

  listing_id            uuid references public.marketplace_listings(id) on delete set null,
  product_id            uuid references public.products(id) on delete set null,

  proposed_by           uuid references public.profiles(id) on delete set null,
  decided_by            uuid references public.profiles(id) on delete set null,
  decided_at            timestamptz,
  decision_note         text,
  executed_at           timestamptz,
  execution_result      jsonb not null default '{}',
  idempotency_key       text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists idx_pipeline_candidates_idempotency
  on public.pipeline_candidates(workspace_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_pipeline_candidates_workspace_status
  on public.pipeline_candidates(workspace_id, status, created_at desc);

create index if not exists idx_pipeline_candidates_kind
  on public.pipeline_candidates(workspace_id, kind, status);

create index if not exists idx_pipeline_candidates_study
  on public.pipeline_candidates(source_study_id)
  where source_study_id is not null;

alter table public.pipeline_candidates enable row level security;

drop policy if exists "Members can view pipeline candidates"
  on public.pipeline_candidates;
create policy "Members can view pipeline candidates"
  on public.pipeline_candidates for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage pipeline candidates"
  on public.pipeline_candidates;
create policy "Members can manage pipeline candidates"
  on public.pipeline_candidates for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.pipeline_candidates
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.pipeline_candidates;
create trigger set_updated_at before update on public.pipeline_candidates
  for each row execute function public.update_updated_at();
