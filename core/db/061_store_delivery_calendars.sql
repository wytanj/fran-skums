-- ============================================================
-- 061 — Phase F: store delivery calendars + wave cutoffs
-- Extends store_ops_settings; per-store receive windows
-- ============================================================

-- Workspace defaults
alter table public.store_ops_settings
  add column if not exists default_receive_by_local time not null default '10:00';

alter table public.store_ops_settings
  add column if not exists wave_include_cutoff_hours int not null default 24
    check (wave_include_cutoff_hours between 0 and 168);

comment on column public.store_ops_settings.default_receive_by_local is
  'Preferred store door receive-by local time (e.g. 10:00) for delivery mode';
comment on column public.store_ops_settings.wave_include_cutoff_hours is
  'Hours before wave_date 00:00 local when deferred requests lock into that wave (default 24)';

-- Per-store / location delivery calendar
create table if not exists public.store_delivery_calendars (
  id                      uuid primary key default uuid_generate_v4(),
  workspace_id            uuid not null references public.workspaces(id) on delete cascade,
  inventory_location_id   uuid not null references public.inventory_locations(id) on delete cascade,
  pos_location_id         uuid references public.pos_locations(id) on delete set null,
  -- Preferred receive days as ISO DOW (1=Mon…7=Sun); empty = follow wave weekdays
  receive_weekdays        int[] not null default '{}',
  receive_window_start    time,
  receive_window_end      time,
  preferred_delivery_mode text not null default 'delivery'
    check (preferred_delivery_mode in ('delivery', 'self_collect')),
  notes                   text,
  is_active               boolean not null default true,
  metadata                jsonb not null default '{}',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (workspace_id, inventory_location_id)
);

create index if not exists idx_store_delivery_calendars_workspace
  on public.store_delivery_calendars(workspace_id)
  where is_active = true;

alter table public.store_delivery_calendars enable row level security;

drop policy if exists "Members can view store delivery calendars"
  on public.store_delivery_calendars;
create policy "Members can view store delivery calendars"
  on public.store_delivery_calendars for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Writers can manage store delivery calendars"
  on public.store_delivery_calendars;
create policy "Writers can manage store delivery calendars"
  on public.store_delivery_calendars for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.store_delivery_calendars
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.store_delivery_calendars;
create trigger set_updated_at before update on public.store_delivery_calendars
  for each row execute function public.update_updated_at();

-- Wave allocation lines (multi-store from Loft ATS planning)
create table if not exists public.store_wave_allocations (
  id                      uuid primary key default uuid_generate_v4(),
  workspace_id            uuid not null references public.workspaces(id) on delete cascade,
  wave_id                 uuid not null references public.store_replenishment_waves(id) on delete cascade,
  product_id              uuid references public.products(id) on delete set null,
  sku                     text not null,
  loft_available_qty      int not null default 0,
  total_requested_qty     int not null default 0,
  total_allocated_qty     int not null default 0,
  status                  text not null default 'draft'
    check (status in ('draft', 'approved', 'released', 'cancelled')),
  lines                   jsonb not null default '[]',
  -- lines: [{ store_location_id, pos_location_id?, requested_qty, allocated_qty, request_id? }]
  notes                   text,
  metadata                jsonb not null default '{}',
  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (wave_id, sku)
);

create index if not exists idx_store_wave_allocations_wave
  on public.store_wave_allocations(wave_id);

alter table public.store_wave_allocations enable row level security;

drop policy if exists "Members can view wave allocations"
  on public.store_wave_allocations;
create policy "Members can view wave allocations"
  on public.store_wave_allocations for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Writers can manage wave allocations"
  on public.store_wave_allocations;
create policy "Writers can manage wave allocations"
  on public.store_wave_allocations for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.store_wave_allocations
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.store_wave_allocations;
create trigger set_updated_at before update on public.store_wave_allocations
  for each row execute function public.update_updated_at();
