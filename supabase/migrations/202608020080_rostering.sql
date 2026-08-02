-- Mirror of core/db/080_rostering.sql
-- Store rostering: employees (manual/rippling), zones, hourly shifts

create table if not exists public.roster_zones (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  pos_location_id       uuid references public.pos_locations(id) on delete set null,

  code                  text not null,
  name                  text not null,
  sort_order            integer not null default 100,
  is_active             boolean not null default true,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, code)
);

create index if not exists idx_roster_zones_workspace
  on public.roster_zones(workspace_id, sort_order);

alter table public.roster_zones enable row level security;

drop policy if exists "Members can view roster zones" on public.roster_zones;
create policy "Members can view roster zones"
  on public.roster_zones for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage roster zones" on public.roster_zones;
create policy "Members can manage roster zones"
  on public.roster_zones for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.roster_zones
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.roster_zones;
create trigger set_updated_at before update on public.roster_zones
  for each row execute function public.update_updated_at();


create table if not exists public.roster_employees (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  display_name          text not null,
  email                 text,
  phone                 text,
  role_label            text not null default 'associate'
    check (role_label ~ '^[a-z0-9][a-z0-9_-]*$'),
  employment_status     text not null default 'active'
    check (employment_status in ('active', 'inactive', 'terminated', 'leave')),

  source_provider       text not null default 'manual'
    check (source_provider in ('manual', 'rippling', 'import', 'other')),
  external_id           text,
  pos_staff_ref         text,
  profile_id            uuid references public.profiles(id) on delete set null,

  default_zone_id       uuid references public.roster_zones(id) on delete set null,
  is_active             boolean not null default true,
  synced_at             timestamptz,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists idx_roster_employees_external
  on public.roster_employees(workspace_id, source_provider, external_id)
  where external_id is not null;

create unique index if not exists idx_roster_employees_pos_staff_ref
  on public.roster_employees(workspace_id, pos_staff_ref)
  where pos_staff_ref is not null;

create index if not exists idx_roster_employees_workspace
  on public.roster_employees(workspace_id, employment_status, display_name);

alter table public.roster_employees enable row level security;

drop policy if exists "Members can view roster employees" on public.roster_employees;
create policy "Members can view roster employees"
  on public.roster_employees for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage roster employees" on public.roster_employees;
create policy "Members can manage roster employees"
  on public.roster_employees for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.roster_employees
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.roster_employees;
create trigger set_updated_at before update on public.roster_employees
  for each row execute function public.update_updated_at();


create table if not exists public.roster_shifts (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  employee_id           uuid not null references public.roster_employees(id) on delete cascade,
  zone_id               uuid not null references public.roster_zones(id) on delete restrict,
  pos_location_id       uuid references public.pos_locations(id) on delete set null,

  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  status                text not null default 'scheduled'
    check (status in ('draft', 'scheduled', 'published', 'cancelled', 'completed')),
  notes                 text,
  created_by            uuid references public.profiles(id) on delete set null,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  check (ends_at > starts_at)
);

create index if not exists idx_roster_shifts_workspace_time
  on public.roster_shifts(workspace_id, starts_at, ends_at);

create index if not exists idx_roster_shifts_employee
  on public.roster_shifts(employee_id, starts_at);

create index if not exists idx_roster_shifts_zone
  on public.roster_shifts(zone_id, starts_at);

create index if not exists idx_roster_shifts_status
  on public.roster_shifts(workspace_id, status, starts_at);

alter table public.roster_shifts enable row level security;

drop policy if exists "Members can view roster shifts" on public.roster_shifts;
create policy "Members can view roster shifts"
  on public.roster_shifts for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage roster shifts" on public.roster_shifts;
create policy "Members can manage roster shifts"
  on public.roster_shifts for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.roster_shifts
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.roster_shifts;
create trigger set_updated_at before update on public.roster_shifts
  for each row execute function public.update_updated_at();


create or replace function public.seed_default_roster_zones(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.roster_zones (workspace_id, code, name, sort_order)
  values
    (p_workspace_id, 'zone_1', 'Zone 1', 10),
    (p_workspace_id, 'zone_2', 'Zone 2', 20),
    (p_workspace_id, 'zone_3', 'Zone 3', 30),
    (p_workspace_id, 'cashier', 'Cashier', 40),
    (p_workspace_id, 'back_of_house', 'Back of House', 50)
  on conflict (workspace_id, code) do update
    set name = excluded.name,
        sort_order = excluded.sort_order,
        is_active = true;
end;
$$;

comment on function public.seed_default_roster_zones is
  'Idempotent default store floor zones: Zone 1/2/3, Cashier, Back of House.';

grant execute on function public.seed_default_roster_zones(uuid) to authenticated, service_role;
