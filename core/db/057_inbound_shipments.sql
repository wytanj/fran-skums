-- ============================================================
-- SKUMS — Inbound ASN lifecycle (KR/HK → Loft)
-- TODO-LOFT Phase D
-- Run AFTER: 056_store_ops_waves_inbox.sql
-- ============================================================

create table if not exists public.inbound_shipments (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  connection_id         uuid references public.integration_connections(id) on delete set null,

  shipment_number       text not null,
  status                text not null default 'draft'
    check (status in (
      'draft',
      'asn_sent',
      'in_transit',
      'loft_receiving',
      'partial_received',
      'fully_received',
      'lise_confirmed',
      'available',
      'cancelled',
      'exception'
    )),

  reference_no          text,
  tracking_number       text not null,
  date_estimate         date,
  arrived_at            timestamptz,
  received_at           timestamptz,
  confirmed_at          timestamptz,
  confirmed_by          uuid references public.profiles(id) on delete set null,

  -- M&P / offshore forwarder (ops metadata)
  local_forwarder       text default 'M&P',
  offshore_forwarder    text,
  palletization         text
    check (palletization is null or palletization in (
      'full_pallet', 'partial_pallet', 'loose', 'mixed'
    )),
  carton_count          integer check (carton_count is null or carton_count >= 0),
  pallet_count          integer check (pallet_count is null or pallet_count >= 0),

  destination_location_id uuid references public.inventory_locations(id) on delete set null,

  external_stock_incoming_main_id text,
  external_stock_incoming_ids text[] not null default '{}',
  external_status       text,

  notes                 text,
  metadata              jsonb not null default '{}',

  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, shipment_number)
);

create unique index if not exists idx_inbound_shipments_tracking
  on public.inbound_shipments(workspace_id, tracking_number)
  where tracking_number is not null and status <> 'cancelled';

create index if not exists idx_inbound_shipments_workspace_status
  on public.inbound_shipments(workspace_id, status, created_at desc);

create index if not exists idx_inbound_shipments_connection
  on public.inbound_shipments(connection_id)
  where connection_id is not null;

alter table public.inbound_shipments enable row level security;

drop policy if exists "Members can view inbound shipments"
  on public.inbound_shipments;
create policy "Members can view inbound shipments"
  on public.inbound_shipments for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Writers can manage inbound shipments"
  on public.inbound_shipments;
create policy "Writers can manage inbound shipments"
  on public.inbound_shipments for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.inbound_shipments
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.inbound_shipments;
create trigger set_updated_at before update on public.inbound_shipments
  for each row execute function public.update_updated_at();


create table if not exists public.inbound_shipment_lines (
  id                    uuid primary key default uuid_generate_v4(),
  shipment_id           uuid not null references public.inbound_shipments(id) on delete cascade,
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  product_id            uuid references public.products(id) on delete set null,
  variant_id            uuid references public.product_variants(id) on delete set null,
  product_identity_id   uuid references public.product_identities(id) on delete set null,

  sku                   text not null,
  product_name          text,
  quantity              integer not null check (quantity > 0),
  quantity_received     integer not null default 0 check (quantity_received >= 0),
  quantity_spoil        integer not null default 0 check (quantity_spoil >= 0),
  external_product_id   text,
  product_price         text,
  product_weight        text,
  product_dimension     text,
  product_description   text,

  -- Optional expiry capture at LISE confirm (SOW parity when OFS lacks fields)
  expiry_year           int,
  expiry_month          int check (expiry_month is null or expiry_month between 1 and 12),
  expiry_day            int check (expiry_day is null or expiry_day between 1 and 31),

  status                text not null default 'declared'
    check (status in ('declared', 'partial', 'received', 'spoil', 'exception', 'cancelled')),
  metadata              jsonb not null default '{}',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_inbound_shipment_lines_shipment
  on public.inbound_shipment_lines(shipment_id);

create index if not exists idx_inbound_shipment_lines_product
  on public.inbound_shipment_lines(workspace_id, product_id)
  where product_id is not null;

alter table public.inbound_shipment_lines enable row level security;

drop policy if exists "Members can view inbound shipment lines"
  on public.inbound_shipment_lines;
create policy "Members can view inbound shipment lines"
  on public.inbound_shipment_lines for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Writers can manage inbound shipment lines"
  on public.inbound_shipment_lines;
create policy "Writers can manage inbound shipment lines"
  on public.inbound_shipment_lines for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.inbound_shipment_lines
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.inbound_shipment_lines;
create trigger set_updated_at before update on public.inbound_shipment_lines
  for each row execute function public.update_updated_at();

comment on table public.inbound_shipments is
  'KR/HK → Loft ASN lifecycle. Promote to LOFT-SG inventory only after lise_confirmed/available.';
