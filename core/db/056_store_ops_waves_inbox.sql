-- ============================================================
-- SKUMS — Store ops waves, HQ inbox, request decisions
-- TODO-LOFT Phase B (B.0 / B.1 / B.1b)
-- Run AFTER: 055_loft_permissions_topology.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Request status: deferred_to_wave + decision columns
-- ------------------------------------------------------------
alter table public.store_replenishment_requests
  drop constraint if exists store_replenishment_requests_status_check;

alter table public.store_replenishment_requests
  add constraint store_replenishment_requests_status_check
  check (status in (
    'draft',
    'submitted',
    'in_review',
    'approved',
    'rejected',
    'deferred_to_wave',
    'converted',
    'cancelled'
  ));

alter table public.store_replenishment_requests
  add column if not exists decision text
    check (decision is null or decision in ('approve_now', 'reject', 'defer_to_wave'));

alter table public.store_replenishment_requests
  add column if not exists decision_reason text;

alter table public.store_replenishment_requests
  add column if not exists decided_by uuid references public.profiles(id) on delete set null;

alter table public.store_replenishment_requests
  add column if not exists decided_at timestamptz;

alter table public.store_replenishment_requests
  add column if not exists wave_id uuid;

alter table public.store_replenishment_requests
  add column if not exists wave_date date;

alter table public.store_replenishment_requests
  add column if not exists mcp_context jsonb not null default '{}';

create index if not exists idx_store_replenishment_requests_decision
  on public.store_replenishment_requests(workspace_id, status, decided_at desc nulls last);

-- ------------------------------------------------------------
-- 2. Weekly replenishment waves (default Mon + Thu)
-- ------------------------------------------------------------
create table if not exists public.store_replenishment_waves (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  wave_number           text not null,
  wave_date             date not null,
  status                text not null default 'planned'
    check (status in ('planned', 'open', 'locked', 'releasing', 'released', 'cancelled')),
  cutoff_at             timestamptz,
  notes                 text,
  metadata              jsonb not null default '{}',
  created_by            uuid references public.profiles(id) on delete set null,
  released_by           uuid references public.profiles(id) on delete set null,
  released_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (workspace_id, wave_number),
  unique (workspace_id, wave_date)
);

create index if not exists idx_store_replenishment_waves_workspace_date
  on public.store_replenishment_waves(workspace_id, wave_date desc);

alter table public.store_replenishment_waves enable row level security;

drop policy if exists "Members can view store replenishment waves"
  on public.store_replenishment_waves;
create policy "Members can view store replenishment waves"
  on public.store_replenishment_waves for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Writers can manage store replenishment waves"
  on public.store_replenishment_waves;
create policy "Writers can manage store replenishment waves"
  on public.store_replenishment_waves for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.store_replenishment_waves
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.store_replenishment_waves;
create trigger set_updated_at before update on public.store_replenishment_waves
  for each row execute function public.update_updated_at();

-- FK from requests.wave_id (added after waves table exists)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'store_replenishment_requests_wave_id_fkey'
  ) then
    alter table public.store_replenishment_requests
      add constraint store_replenishment_requests_wave_id_fkey
      foreign key (wave_id) references public.store_replenishment_waves(id) on delete set null;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. Order delivery mode + wave link
-- ------------------------------------------------------------
alter table public.store_replenishment_orders
  add column if not exists delivery_mode text
    check (delivery_mode is null or delivery_mode in ('delivery', 'self_collect'));

alter table public.store_replenishment_orders
  add column if not exists delivery_method_id text;

alter table public.store_replenishment_orders
  add column if not exists wave_id uuid references public.store_replenishment_waves(id) on delete set null;

alter table public.store_replenishment_orders
  add column if not exists pickup_ready_at timestamptz;

create index if not exists idx_store_replenishment_orders_wave
  on public.store_replenishment_orders(wave_id)
  where wave_id is not null;

-- ------------------------------------------------------------
-- 4. HQ notification inbox (request signals → store_ops:approve)
-- ------------------------------------------------------------
create table if not exists public.store_ops_notifications (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  notification_type     text not null default 'replenishment_request_submitted'
    check (notification_type ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  title                 text not null,
  body                  text,
  priority              text not null default 'normal'
    check (priority in ('low', 'normal', 'urgent', 'critical')),
  status                text not null default 'unread'
    check (status in ('unread', 'read', 'archived')),
  target_scope          text not null default 'store_ops:approve',
  entity_type           text,
  entity_id             uuid,
  deep_link             text,
  payload               jsonb not null default '{}',
  read_by               uuid references public.profiles(id) on delete set null,
  read_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_store_ops_notifications_workspace_status
  on public.store_ops_notifications(workspace_id, status, created_at desc);

create index if not exists idx_store_ops_notifications_entity
  on public.store_ops_notifications(workspace_id, entity_type, entity_id)
  where entity_id is not null;

alter table public.store_ops_notifications enable row level security;

drop policy if exists "Members can view store ops notifications"
  on public.store_ops_notifications;
create policy "Members can view store ops notifications"
  on public.store_ops_notifications for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Writers can manage store ops notifications"
  on public.store_ops_notifications;
create policy "Writers can manage store ops notifications"
  on public.store_ops_notifications for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.store_ops_notifications
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.store_ops_notifications;
create trigger set_updated_at before update on public.store_ops_notifications
  for each row execute function public.update_updated_at();

-- ------------------------------------------------------------
-- 5. Workspace store-ops settings (wave weekdays default Mon/Thu)
-- ------------------------------------------------------------
create table if not exists public.store_ops_settings (
  workspace_id          uuid primary key references public.workspaces(id) on delete cascade,
  wave_weekdays         int[] not null default '{1,4}',
  -- ISO: 1=Mon … 7=Sun. Default Monday + Thursday.
  default_delivery_mode text not null default 'delivery'
    check (default_delivery_mode in ('delivery', 'self_collect')),
  wave_cutoff_hour_local int not null default 14
    check (wave_cutoff_hour_local between 0 and 23),
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.store_ops_settings enable row level security;

drop policy if exists "Members can view store ops settings"
  on public.store_ops_settings;
create policy "Members can view store ops settings"
  on public.store_ops_settings for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Admins can manage store ops settings"
  on public.store_ops_settings;
create policy "Admins can manage store ops settings"
  on public.store_ops_settings for all
  to authenticated
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

grant select, insert, update, delete on table public.store_ops_settings
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.store_ops_settings;
create trigger set_updated_at before update on public.store_ops_settings
  for each row execute function public.update_updated_at();

-- ------------------------------------------------------------
-- 6. Helpers: next wave dates (Mon/Thu-style from settings)
-- ------------------------------------------------------------
create or replace function public.next_replenishment_wave_dates(
  p_workspace_id uuid,
  p_from date default current_date,
  p_count int default 4
)
returns table (wave_date date, weekday int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days int[];
  v_from date := coalesce(p_from, current_date);
  v_count int := greatest(1, least(coalesce(p_count, 4), 20));
  v_cursor date;
  v_found int := 0;
  v_dow int;
begin
  select wave_weekdays into v_days
  from public.store_ops_settings
  where workspace_id = p_workspace_id;

  if v_days is null or cardinality(v_days) = 0 then
    v_days := array[1, 4]; -- Mon, Thu
  end if;

  v_cursor := v_from;
  while v_found < v_count loop
    -- ISO DOW: extract(isodow) 1=Mon … 7=Sun
    v_dow := extract(isodow from v_cursor)::int;
    if v_dow = any (v_days) then
      wave_date := v_cursor;
      weekday := v_dow;
      v_found := v_found + 1;
      return next;
    end if;
    v_cursor := v_cursor + 1;
  end loop;
end;
$$;

grant execute on function public.next_replenishment_wave_dates(uuid, date, int)
  to authenticated, service_role;

comment on function public.next_replenishment_wave_dates is
  'Return upcoming replenishment wave dates from store_ops_settings.wave_weekdays (default Mon+Thu).';

-- View: open HQ inbox items
create or replace view public.v_store_ops_inbox as
select
  n.*,
  r.request_number,
  r.status as request_status,
  r.priority as request_priority,
  r.pos_location_id,
  r.store_location_id,
  r.needed_by,
  r.reason as request_reason
from public.store_ops_notifications n
left join public.store_replenishment_requests r
  on r.id = n.entity_id
 and n.entity_type = 'store_replenishment_request';

grant select on public.v_store_ops_inbox to authenticated, service_role;
