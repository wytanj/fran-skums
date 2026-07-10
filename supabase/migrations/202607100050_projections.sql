-- ============================================================
-- SKUMS — Financial projection runs (study / PO scenarios)
--
-- Code computes numbers; Grok may add commentary only.
-- Run AFTER: 049_internal_purchase_orders.sql
-- ============================================================

create table if not exists public.projection_assumption_defaults (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  payment_fees_pct      numeric(8, 4) not null default 0.03,
  shipping_per_unit     numeric(14, 4) not null default 0,
  returns_pct           numeric(8, 4) not null default 0.05,
  default_horizon_weeks integer not null default 12,
  currency              text not null default 'SGD',
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (workspace_id)
);

alter table public.projection_assumption_defaults enable row level security;

drop policy if exists "Members can view projection defaults"
  on public.projection_assumption_defaults;
create policy "Members can view projection defaults"
  on public.projection_assumption_defaults for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage projection defaults"
  on public.projection_assumption_defaults;
create policy "Members can manage projection defaults"
  on public.projection_assumption_defaults for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.projection_assumption_defaults
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.projection_assumption_defaults;
create trigger set_updated_at before update on public.projection_assumption_defaults
  for each row execute function public.update_updated_at();


create table if not exists public.projection_runs (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  title                 text not null,
  source_type           text not null default 'manual'
    check (source_type in ('manual', 'internal_po', 'study', 'pipeline')),
  status                text not null default 'completed'
    check (status in ('draft', 'completed', 'failed')),

  horizon_weeks         integer not null default 12 check (horizon_weeks > 0 and horizon_weeks <= 104),
  currency              text not null default 'SGD',

  assumptions           jsonb not null default '{}',
  results               jsonb not null default '{}',
  grok_commentary       jsonb not null default '{}',
  evidence_refs         text[] not null default '{}',

  linked_po_id          uuid references public.internal_purchase_orders(id) on delete set null,
  linked_study_id       uuid references public.study_sessions(id) on delete set null,
  linked_product_id     uuid references public.products(id) on delete set null,

  model_id              text,
  error                 text,
  created_by            uuid references public.profiles(id) on delete set null,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_projection_runs_workspace
  on public.projection_runs(workspace_id, created_at desc);

create index if not exists idx_projection_runs_po
  on public.projection_runs(linked_po_id)
  where linked_po_id is not null;

create index if not exists idx_projection_runs_study
  on public.projection_runs(linked_study_id)
  where linked_study_id is not null;

alter table public.projection_runs enable row level security;

drop policy if exists "Members can view projection runs"
  on public.projection_runs;
create policy "Members can view projection runs"
  on public.projection_runs for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage projection runs"
  on public.projection_runs;
create policy "Members can manage projection runs"
  on public.projection_runs for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.projection_runs
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.projection_runs;
create trigger set_updated_at before update on public.projection_runs
  for each row execute function public.update_updated_at();
