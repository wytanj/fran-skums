-- ============================================================
-- SKUMS — Shipping visualizer (Fran ops observation)
-- App: apps/shipping
--
-- Tables: shipping_shipments, shipping_events, shipping_notes,
--         shipping_files, shipping_lines
--
-- Status FSM (main):
--   intake → quote → booked → pickup_scheduled → in_transit
--   → arrived_sg → delivered → closed
-- Side states: on_hold, exception
-- Every status transition should insert a shipping_events row.
--
-- RLS mirrors internal_purchase_orders (staff/workspace).
-- Service role used by ingest API.
-- ============================================================

create table if not exists public.shipping_shipments (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  title                 text not null,
  status                text not null default 'intake'
    check (status in (
      'intake', 'quote', 'booked', 'pickup_scheduled', 'in_transit',
      'arrived_sg', 'delivered', 'closed', 'on_hold', 'exception'
    )),
  mode                  text not null default 'air'
    check (mode in ('air', 'sea', 'road', 'rail', 'other')),

  forwarder_name        text,
  origin_name           text,
  destination_name      text,
  shipper_name          text,
  consignee_name        text,
  contact_email         text,

  quote_number          text,
  batch_number          text,
  mawb                  text,
  hawb                  text,
  flight_number         text,
  flight_date           date,
  pickup_eta            timestamptz,
  pickup_confirmed_at   timestamptz,
  driver_name           text,

  package_count         integer,
  weight_kg             numeric(12, 3),
  carrier_shipment_ids  text[] not null default '{}',

  drive_folder_url      text,
  drive_folder_id       text,

  -- Badge / risk flags (also recomputed in app layer)
  storage_risk          boolean not null default false,
  exception_open        boolean not null default false,
  package_mismatch      boolean not null default false,
  missing_fields        text[] not null default '{}',
  badges                jsonb not null default '[]'::jsonb,

  current_location_label text,
  status_changed_at     timestamptz not null default now(),

  idempotency_key       text,
  metadata              jsonb not null default '{}'::jsonb,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists idx_shipping_shipments_idempotency
  on public.shipping_shipments(workspace_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_shipping_shipments_workspace_status
  on public.shipping_shipments(workspace_id, status, updated_at desc);

create index if not exists idx_shipping_shipments_quote
  on public.shipping_shipments(workspace_id, quote_number)
  where quote_number is not null;

create index if not exists idx_shipping_shipments_batch
  on public.shipping_shipments(workspace_id, batch_number)
  where batch_number is not null;

alter table public.shipping_shipments enable row level security;

drop policy if exists "Members can view shipping shipments"
  on public.shipping_shipments;
create policy "Members can view shipping shipments"
  on public.shipping_shipments for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage shipping shipments"
  on public.shipping_shipments;
create policy "Members can manage shipping shipments"
  on public.shipping_shipments for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.shipping_shipments
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.shipping_shipments;
create trigger set_updated_at before update on public.shipping_shipments
  for each row execute function public.update_updated_at();


create table if not exists public.shipping_events (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  shipment_id           uuid not null references public.shipping_shipments(id) on delete cascade,

  event_type            text not null default 'status_transition'
    check (event_type in (
      'status_transition', 'note', 'ingest', 'exception', 'file',
      'badge', 'system', 'whatsapp', 'recon'
    )),
  from_status           text,
  to_status             text,
  title                 text not null,
  body                  text,
  source                text not null default 'system',
  occurred_at           timestamptz not null default now(),
  metadata              jsonb not null default '{}'::jsonb,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now()
);

create index if not exists idx_shipping_events_shipment
  on public.shipping_events(shipment_id, occurred_at desc);

create index if not exists idx_shipping_events_workspace
  on public.shipping_events(workspace_id, occurred_at desc);

alter table public.shipping_events enable row level security;

drop policy if exists "Members can view shipping events"
  on public.shipping_events;
create policy "Members can view shipping events"
  on public.shipping_events for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage shipping events"
  on public.shipping_events;
create policy "Members can manage shipping events"
  on public.shipping_events for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.shipping_events
  to authenticated, service_role;


create table if not exists public.shipping_notes (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  shipment_id           uuid not null references public.shipping_shipments(id) on delete cascade,

  note_type             text not null default 'staff'
    check (note_type in ('staff', 'whatsapp_excerpt', 'system')),
  body                  text not null,
  author_label          text,
  is_curated            boolean not null default true,
  occurred_at           timestamptz not null default now(),
  metadata              jsonb not null default '{}'::jsonb,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_shipping_notes_shipment
  on public.shipping_notes(shipment_id, occurred_at desc);

alter table public.shipping_notes enable row level security;

drop policy if exists "Members can view shipping notes"
  on public.shipping_notes;
create policy "Members can view shipping notes"
  on public.shipping_notes for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage shipping notes"
  on public.shipping_notes;
create policy "Members can manage shipping notes"
  on public.shipping_notes for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.shipping_notes
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.shipping_notes;
create trigger set_updated_at before update on public.shipping_notes
  for each row execute function public.update_updated_at();


create table if not exists public.shipping_files (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  shipment_id           uuid not null references public.shipping_shipments(id) on delete cascade,

  label                 text not null,
  file_kind             text not null default 'other'
    check (file_kind in (
      'ci', 'waybill', 'freight_quote', 'packing_list', 'photo',
      'hawb', 'mawb', 'other'
    )),
  drive_url             text,
  drive_file_id         text,
  is_missing            boolean not null default false,
  sort_order            integer not null default 0,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_shipping_files_shipment
  on public.shipping_files(shipment_id, sort_order, created_at);

alter table public.shipping_files enable row level security;

drop policy if exists "Members can view shipping files"
  on public.shipping_files;
create policy "Members can view shipping files"
  on public.shipping_files for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage shipping files"
  on public.shipping_files;
create policy "Members can manage shipping files"
  on public.shipping_files for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.shipping_files
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.shipping_files;
create trigger set_updated_at before update on public.shipping_files
  for each row execute function public.update_updated_at();


create table if not exists public.shipping_lines (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  shipment_id           uuid not null references public.shipping_shipments(id) on delete cascade,

  line_number           integer not null default 1,
  package_ref           text,
  description           text,
  sku                   text,
  quantity              numeric(14, 4),
  weight_kg             numeric(12, 3),
  expected_qty          numeric(14, 4),
  received_qty          numeric(14, 4),
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_shipping_lines_shipment
  on public.shipping_lines(shipment_id, line_number);

alter table public.shipping_lines enable row level security;

drop policy if exists "Members can view shipping lines"
  on public.shipping_lines;
create policy "Members can view shipping lines"
  on public.shipping_lines for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage shipping lines"
  on public.shipping_lines;
create policy "Members can manage shipping lines"
  on public.shipping_lines for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.shipping_lines
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.shipping_lines;
create trigger set_updated_at before update on public.shipping_lines
  for each row execute function public.update_updated_at();
