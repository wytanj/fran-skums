-- ============================================================
-- SKUMS — Full Inventory Management
--
-- Architecture:
--   inventory_locations       — everywhere stock can live
--   inventory_levels          — materialized per (product/variant × location)
--   inventory_ledger          — immutable append-only source of truth
--   purchase_orders           — inbound from suppliers
--   purchase_order_lines
--   inventory_transfers       — stock moving between locations
--   inventory_transfer_lines
--   inventory_adjustments     — stocktakes, corrections, damage write-offs
--   inventory_adjustment_lines
--   inventory_reservations    — stock locked for orders / channels
--
-- Quantity model (per product per location):
--   on_hand      — physically present
--   reserved     — on_hand but locked (orders, channel allocation, hold)
--   available    — on_hand - reserved  (Available To Sell / ATS)
--   on_order     — open PO lines not yet shipped
--   in_transit   — shipped (PO or transfer) but not yet received
--   total_owned  — on_hand + in_transit + on_order
--
-- Run AFTER: schema.sql
-- ============================================================


-- ============================================================
-- 1. INVENTORY LOCATIONS
-- ============================================================
create table public.inventory_locations (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  name            text not null,
  code            text not null,   -- short human code e.g. "WH-SYD", "STORE-01"

  location_type   text not null default 'warehouse'
    check (location_type in (
      'warehouse',    -- physical storage facility
      'store',        -- retail / fulfilment store
      'in_transit',   -- virtual node representing goods moving between locations
      'supplier',     -- at the supplier before shipment
      'fba',          -- Fulfillment by Amazon
      '3pl',          -- third-party logistics
      'damaged',      -- quarantine / damaged goods area
      'returns',      -- returned goods awaiting inspection
      'virtual'       -- catch-all virtual / accounting location
    )),

  -- Physical address (optional)
  address         jsonb default '{}',
  -- e.g. {"line1":"123 Main St","city":"Sydney","state":"NSW","country":"AU","postcode":"2000"}

  is_active       boolean not null default true,
  is_default      boolean not null default false,  -- one default pick location per workspace

  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (workspace_id, code)
);

create index idx_inv_locations_workspace on public.inventory_locations(workspace_id);

alter table public.inventory_locations enable row level security;

create policy "Members can view locations"
  on public.inventory_locations for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage locations"
  on public.inventory_locations for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.inventory_locations
  for each row execute function public.update_updated_at();


-- ============================================================
-- 2. INVENTORY LEVELS
--    Materialized running totals per (product or variant) ×
--    location.  Updated by stored procedures — never written
--    to directly by the application.
--    The inventory_ledger is the source of truth; these are
--    pre-aggregated for fast reads.
-- ============================================================
create table public.inventory_levels (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  -- Track at product level OR variant level (not both for the same row)
  product_id      uuid not null references public.products(id) on delete cascade,
  variant_id      uuid references public.product_variants(id) on delete cascade,

  location_id     uuid not null references public.inventory_locations(id) on delete cascade,

  -- Current stock quantities
  on_hand         int not null default 0,
  reserved        int not null default 0,   -- locked (orders, hold, channel allocation)
  on_order        int not null default 0,   -- open PO lines, not yet shipped
  in_transit      int not null default 0,   -- shipped / en route, not yet received

  -- When was this location last physically counted
  last_counted_at timestamptz,

  updated_at      timestamptz not null default now(),

  unique (product_id, variant_id, location_id),
  -- Ensure variant belongs to the product (enforced by app / trigger)
  check (
    (variant_id is null) or (variant_id is not null)  -- placeholder; real check in RPC
  )
);

-- Computed columns as generated columns aren't available in all PG versions,
-- so we expose them via a view instead (see section 9).

create index idx_inv_levels_product    on public.inventory_levels(product_id);
create index idx_inv_levels_variant    on public.inventory_levels(variant_id) where variant_id is not null;
create index idx_inv_levels_location   on public.inventory_levels(location_id);
create index idx_inv_levels_workspace  on public.inventory_levels(workspace_id);

alter table public.inventory_levels enable row level security;

create policy "Members can view inventory levels"
  on public.inventory_levels for select
  using (workspace_id in (select public.get_my_workspace_ids()));

-- Levels are only written by RPCs/triggers; no direct DML from app layer.
create policy "System can manage inventory levels"
  on public.inventory_levels for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.inventory_levels
  for each row execute function public.update_updated_at();


-- ============================================================
-- 3. INVENTORY LEDGER  (immutable — never UPDATE or DELETE)
--    Every quantity change is one or more ledger entries.
--    Positive quantity = stock coming in.
--    Negative quantity = stock going out.
-- ============================================================
create table public.inventory_ledger (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  product_id      uuid not null references public.products(id) on delete cascade,
  variant_id      uuid references public.product_variants(id) on delete cascade,
  location_id     uuid not null references public.inventory_locations(id) on delete cascade,

  -- What quantity bucket is changing
  quantity_type   text not null
    check (quantity_type in (
      'on_hand',
      'reserved',
      'on_order',
      'in_transit'
    )),

  -- Signed quantity change (+in / -out)
  quantity_change int not null,
  -- Running total of this bucket at this location after the entry
  quantity_after  int not null,

  -- What caused this entry
  movement_type   text not null
    check (movement_type in (
      'po_confirmed',       -- PO line confirmed with supplier → on_order ↑
      'po_shipped',         -- PO marked in transit  → on_order ↓, in_transit ↑
      'po_received',        -- Goods received        → in_transit ↓, on_hand ↑
      'po_cancelled',       -- PO line cancelled     → on_order ↓
      'transfer_created',   -- Transfer initiated    → on_hand ↓ (source), in_transit ↑ (dest)
      'transfer_received',  -- Transfer received     → in_transit ↓, on_hand ↑ (dest)
      'transfer_cancelled', -- Transfer cancelled    → reversal entries
      'reservation',        -- Stock reserved        → reserved ↑
      'unreservation',      -- Reservation released  → reserved ↓
      'sale',               -- Fulfilled / shipped   → on_hand ↓, reserved ↓
      'return',             -- Customer return       → on_hand ↑
      'adjustment',         -- Manual / stocktake    → on_hand ± delta
      'damage',             -- Written off as damaged → on_hand ↓
      'initial'             -- Opening balance entry
    )),

  -- What record triggered this (polymorphic)
  reference_type  text,   -- 'purchase_order'|'inventory_transfer'|'inventory_adjustment'|'reservation'|'order'|null
  reference_id    uuid,
  reference_line_id uuid,

  notes           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
  -- NO updated_at — this table is immutable
);

create index idx_ledger_workspace  on public.inventory_ledger(workspace_id, created_at desc);
create index idx_ledger_product    on public.inventory_ledger(product_id, created_at desc);
create index idx_ledger_location   on public.inventory_ledger(location_id, created_at desc);
create index idx_ledger_reference  on public.inventory_ledger(reference_type, reference_id);
create index idx_ledger_movement   on public.inventory_ledger(movement_type);

alter table public.inventory_ledger enable row level security;

create policy "Members can view ledger"
  on public.inventory_ledger for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can insert ledger entries"
  on public.inventory_ledger for insert
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));
-- No UPDATE or DELETE policies — ledger is write-once.


-- ============================================================
-- 4. PURCHASE ORDERS  (inbound from suppliers)
-- ============================================================
create table public.purchase_orders (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  po_number       text not null,

  -- Supplier info (could reference a suppliers table later)
  supplier_name   text not null,
  supplier_ref    text,           -- supplier's own order/invoice reference

  status          text not null default 'draft'
    check (status in (
      'draft',              -- being built, not yet sent
      'submitted',          -- sent to supplier, awaiting confirmation
      'confirmed',          -- supplier confirmed → on_order quantities set
      'in_transit',         -- supplier shipped → ASN received, tracking added
      'partially_received', -- some lines received
      'received',           -- all lines fully received
      'cancelled'
    )),

  -- Where the goods are heading
  destination_location_id uuid not null
    references public.inventory_locations(id) on delete restrict,

  -- Shipping details (populated when status → in_transit)
  carrier           text,
  tracking_number   text,
  shipping_method   text,    -- 'sea_freight'|'air_freight'|'road'|'courier'|'express'
  shipped_at        timestamptz,
  expected_arrival  date,

  -- Financials
  currency          text not null default 'USD',
  subtotal          numeric(14,2),
  shipping_cost     numeric(14,2),
  tax_amount        numeric(14,2),
  total_amount      numeric(14,2),

  notes             text,
  internal_notes    text,

  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (workspace_id, po_number)
);

create index idx_po_workspace  on public.purchase_orders(workspace_id);
create index idx_po_status     on public.purchase_orders(workspace_id, status);
create index idx_po_location   on public.purchase_orders(destination_location_id);

alter table public.purchase_orders enable row level security;

create policy "Members can view purchase orders"
  on public.purchase_orders for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage purchase orders"
  on public.purchase_orders for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.purchase_orders
  for each row execute function public.update_updated_at();


-- ============================================================
-- 5. PURCHASE ORDER LINES
-- ============================================================
create table public.purchase_order_lines (
  id              uuid primary key default uuid_generate_v4(),
  po_id           uuid not null references public.purchase_orders(id) on delete cascade,

  product_id      uuid not null references public.products(id) on delete restrict,
  variant_id      uuid references public.product_variants(id) on delete restrict,

  -- Quantities
  ordered_qty     int not null check (ordered_qty > 0),
  received_qty    int not null default 0 check (received_qty >= 0),
  -- remaining = ordered_qty - received_qty (computed by app / view)

  unit_cost       numeric(12,4),
  line_total      numeric(14,2),

  -- Expected pack size / case quantity
  case_qty        int default 1,

  notes           text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_po_lines_po      on public.purchase_order_lines(po_id);
create index idx_po_lines_product on public.purchase_order_lines(product_id);

alter table public.purchase_order_lines enable row level security;

create policy "PO lines follow PO access"
  on public.purchase_order_lines for select
  using (
    po_id in (
      select id from public.purchase_orders
      where workspace_id in (select public.get_my_workspace_ids())
    )
  );

create policy "PO lines follow PO management"
  on public.purchase_order_lines for all
  using (
    po_id in (
      select id from public.purchase_orders
      where workspace_id in (select public.get_my_writable_workspace_ids())
    )
  );

create trigger set_updated_at before update on public.purchase_order_lines
  for each row execute function public.update_updated_at();


-- ============================================================
-- 6. INVENTORY TRANSFERS  (between locations)
-- ============================================================
create table public.inventory_transfers (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  transfer_number text not null,

  from_location_id uuid not null references public.inventory_locations(id) on delete restrict,
  to_location_id   uuid not null references public.inventory_locations(id) on delete restrict,

  status          text not null default 'draft'
    check (status in (
      'draft',
      'in_transit',         -- goods physically en route
      'partially_received',
      'received',
      'cancelled'
    )),

  -- Shipping details
  carrier           text,
  tracking_number   text,
  shipping_method   text,
  shipped_at        timestamptz,
  expected_arrival  date,

  notes             text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (workspace_id, transfer_number),
  check (from_location_id <> to_location_id)
);

create index idx_transfer_workspace on public.inventory_transfers(workspace_id);
create index idx_transfer_status    on public.inventory_transfers(workspace_id, status);
create index idx_transfer_from      on public.inventory_transfers(from_location_id);
create index idx_transfer_to        on public.inventory_transfers(to_location_id);

alter table public.inventory_transfers enable row level security;

create policy "Members can view transfers"
  on public.inventory_transfers for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage transfers"
  on public.inventory_transfers for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.inventory_transfers
  for each row execute function public.update_updated_at();


-- ============================================================
-- 7. INVENTORY TRANSFER LINES
-- ============================================================
create table public.inventory_transfer_lines (
  id              uuid primary key default uuid_generate_v4(),
  transfer_id     uuid not null references public.inventory_transfers(id) on delete cascade,

  product_id      uuid not null references public.products(id) on delete restrict,
  variant_id      uuid references public.product_variants(id) on delete restrict,

  requested_qty   int not null check (requested_qty > 0),
  shipped_qty     int not null default 0 check (shipped_qty >= 0),
  received_qty    int not null default 0 check (received_qty >= 0),

  notes           text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_transfer_lines_transfer on public.inventory_transfer_lines(transfer_id);
create index idx_transfer_lines_product  on public.inventory_transfer_lines(product_id);

alter table public.inventory_transfer_lines enable row level security;

create policy "Transfer lines follow transfer access"
  on public.inventory_transfer_lines for select
  using (
    transfer_id in (
      select id from public.inventory_transfers
      where workspace_id in (select public.get_my_workspace_ids())
    )
  );

create policy "Transfer lines follow transfer management"
  on public.inventory_transfer_lines for all
  using (
    transfer_id in (
      select id from public.inventory_transfers
      where workspace_id in (select public.get_my_writable_workspace_ids())
    )
  );

create trigger set_updated_at before update on public.inventory_transfer_lines
  for each row execute function public.update_updated_at();


-- ============================================================
-- 8. INVENTORY ADJUSTMENTS  (stocktakes, corrections, damage)
-- ============================================================
create table public.inventory_adjustments (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  adjustment_number text not null,
  location_id       uuid not null references public.inventory_locations(id) on delete restrict,

  adjustment_type text not null default 'correction'
    check (adjustment_type in (
      'correction',   -- ad-hoc fix
      'stocktake',    -- full or partial physical count
      'damage',       -- write-off damaged goods
      'theft',        -- shrinkage
      'expiry',       -- expired / obsolete
      'found',        -- discovered unrecorded stock
      'return'        -- returned goods added back
    )),

  status          text not null default 'draft'
    check (status in (
      'draft',      -- being built
      'pending',    -- submitted for approval
      'approved',   -- approved, ready to apply
      'applied',    -- inventory levels updated
      'rejected'
    )),

  notes           text,
  approved_by     uuid references public.profiles(id) on delete set null,
  approved_at     timestamptz,

  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (workspace_id, adjustment_number)
);

create index idx_adjustment_workspace on public.inventory_adjustments(workspace_id);
create index idx_adjustment_status    on public.inventory_adjustments(workspace_id, status);

alter table public.inventory_adjustments enable row level security;

create policy "Members can view adjustments"
  on public.inventory_adjustments for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage adjustments"
  on public.inventory_adjustments for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.inventory_adjustments
  for each row execute function public.update_updated_at();


-- ============================================================
-- 9. INVENTORY ADJUSTMENT LINES
-- ============================================================
create table public.inventory_adjustment_lines (
  id              uuid primary key default uuid_generate_v4(),
  adjustment_id   uuid not null references public.inventory_adjustments(id) on delete cascade,

  product_id      uuid not null references public.products(id) on delete restrict,
  variant_id      uuid references public.product_variants(id) on delete restrict,

  -- For stocktake: what system says vs what was physically counted
  system_qty      int,           -- snapshot of on_hand at time of count (null for non-stocktake)
  counted_qty     int not null,  -- actual physical count
  -- difference = counted_qty - system_qty  (computed in view / app)

  reason          text,          -- brief note per line
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_adj_lines_adjustment on public.inventory_adjustment_lines(adjustment_id);
create index idx_adj_lines_product    on public.inventory_adjustment_lines(product_id);

alter table public.inventory_adjustment_lines enable row level security;

create policy "Adjustment lines follow adjustment access"
  on public.inventory_adjustment_lines for select
  using (
    adjustment_id in (
      select id from public.inventory_adjustments
      where workspace_id in (select public.get_my_workspace_ids())
    )
  );

create policy "Adjustment lines follow adjustment management"
  on public.inventory_adjustment_lines for all
  using (
    adjustment_id in (
      select id from public.inventory_adjustments
      where workspace_id in (select public.get_my_writable_workspace_ids())
    )
  );

create trigger set_updated_at before update on public.inventory_adjustment_lines
  for each row execute function public.update_updated_at();


-- ============================================================
-- 10. INVENTORY RESERVATIONS
--     Locks a quantity of on_hand stock at a location.
--     Common reasons:
--       order        — stock held for a customer order
--       channel      — allocated to a sales channel (e.g. Amazon FBA buffer)
--       manual       — user-placed hold
--       safety_stock — never drop below this level
-- ============================================================
create table public.inventory_reservations (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  product_id      uuid not null references public.products(id) on delete cascade,
  variant_id      uuid references public.product_variants(id) on delete cascade,
  location_id     uuid not null references public.inventory_locations(id) on delete cascade,

  reserved_qty    int not null check (reserved_qty > 0),

  reason_type     text not null default 'manual'
    check (reason_type in (
      'order',        -- customer order
      'channel',      -- channel allocation (Shopify, Amazon, etc.)
      'manual',       -- user-placed hold
      'safety_stock', -- min-stock buffer
      'transfer'      -- goods allocated to an outbound transfer
    )),

  -- Optional reference to the thing that created the reservation
  reason_id       uuid,             -- e.g. order ID, connection ID
  reason_label    text,             -- human description, e.g. "Shopify Order #1042"

  -- Auto-release when this timestamp is passed (null = never auto-release)
  expires_at      timestamptz,

  notes           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_reservations_product  on public.inventory_reservations(product_id);
create index idx_reservations_location on public.inventory_reservations(location_id);
create index idx_reservations_reason   on public.inventory_reservations(reason_type, reason_id);
create index idx_reservations_expiry   on public.inventory_reservations(expires_at) where expires_at is not null;

alter table public.inventory_reservations enable row level security;

create policy "Members can view reservations"
  on public.inventory_reservations for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage reservations"
  on public.inventory_reservations for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.inventory_reservations
  for each row execute function public.update_updated_at();


-- ============================================================
-- 11. VIEWS
-- ============================================================

-- Full inventory picture per product × location
create or replace view public.v_inventory as
select
  il.id,
  il.workspace_id,
  il.product_id,
  il.variant_id,
  il.location_id,
  loc.name                          as location_name,
  loc.code                          as location_code,
  loc.location_type,
  p.title                           as product_title,
  p.sku                             as product_sku,
  pv.title                          as variant_title,
  pv.sku                            as variant_sku,
  il.on_hand,
  il.reserved,
  greatest(0, il.on_hand - il.reserved) as available,  -- ATS
  il.on_order,
  il.in_transit,
  il.on_hand + il.in_transit + il.on_order as total_owned,
  il.last_counted_at,
  il.updated_at
from      public.inventory_levels il
join      public.inventory_locations loc on loc.id = il.location_id
join      public.products p              on p.id   = il.product_id
left join public.product_variants pv    on pv.id  = il.variant_id;

-- Workspace-level summary (across all locations)
create or replace view public.v_inventory_summary as
select
  il.workspace_id,
  il.product_id,
  il.variant_id,
  p.title                                       as product_title,
  p.sku                                         as product_sku,
  sum(il.on_hand)                               as total_on_hand,
  sum(il.reserved)                              as total_reserved,
  sum(greatest(0, il.on_hand - il.reserved))    as total_available,
  sum(il.on_order)                              as total_on_order,
  sum(il.in_transit)                            as total_in_transit,
  sum(il.on_hand + il.in_transit + il.on_order) as total_owned,
  jsonb_agg(jsonb_build_object(
    'location_id',   il.location_id,
    'location_name', loc.name,
    'location_code', loc.code,
    'location_type', loc.location_type,
    'on_hand',       il.on_hand,
    'reserved',      il.reserved,
    'available',     greatest(0, il.on_hand - il.reserved),
    'in_transit',    il.in_transit,
    'on_order',      il.on_order
  ) order by loc.name)                          as by_location
from      public.inventory_levels il
join      public.products p              on p.id  = il.product_id
join      public.inventory_locations loc on loc.id = il.location_id
group by  il.workspace_id, il.product_id, il.variant_id, p.title, p.sku;

-- Open POs with receipt progress
create or replace view public.v_purchase_orders as
select
  po.*,
  loc.name                                  as destination_name,
  loc.code                                  as destination_code,
  count(pol.id)                             as line_count,
  sum(pol.ordered_qty)                      as total_ordered,
  sum(pol.received_qty)                     as total_received,
  sum(pol.ordered_qty - pol.received_qty)   as total_remaining
from      public.purchase_orders po
join      public.inventory_locations loc on loc.id = po.destination_location_id
left join public.purchase_order_lines pol on pol.po_id = po.id
group by  po.id, loc.name, loc.code;

-- Low stock alert view
create or replace view public.v_low_stock as
select
  s.workspace_id,
  s.product_id,
  s.variant_id,
  s.product_title,
  s.product_sku,
  s.total_available,
  s.total_on_order,
  s.total_in_transit,
  p.low_stock_threshold
from      public.v_inventory_summary s
join      public.products p on p.id = s.product_id
where     p.track_inventory = true
  and     s.total_available <= p.low_stock_threshold;


-- ============================================================
-- 12. RPC: upsert_inventory_level
--     Safely creates or updates a level row and records a
--     ledger entry.  All inventory mutations go through RPCs
--     so the ledger always stays in sync.
-- ============================================================
create or replace function public.upsert_inventory_level(
  p_workspace_id    uuid,
  p_product_id      uuid,
  p_variant_id      uuid,
  p_location_id     uuid,
  p_quantity_type   text,   -- 'on_hand'|'reserved'|'on_order'|'in_transit'
  p_delta           int,    -- signed change
  p_movement_type   text,
  p_reference_type  text    default null,
  p_reference_id    uuid    default null,
  p_reference_line_id uuid  default null,
  p_notes           text    default null,
  p_created_by      uuid    default null
)
returns public.inventory_levels
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level   public.inventory_levels%rowtype;
  v_after   int;
begin
  -- Upsert the level row
  insert into public.inventory_levels
    (workspace_id, product_id, variant_id, location_id)
  values
    (p_workspace_id, p_product_id, p_variant_id, p_location_id)
  on conflict (product_id, variant_id, location_id) do nothing;

  -- Lock the row, apply delta
  if p_quantity_type = 'on_hand' then
    update public.inventory_levels
    set    on_hand   = on_hand   + p_delta,
           updated_at = now()
    where  product_id  = p_product_id
      and  coalesce(variant_id::text,'') = coalesce(p_variant_id::text,'')
      and  location_id = p_location_id
    returning * into v_level;
    v_after := v_level.on_hand;

  elsif p_quantity_type = 'reserved' then
    update public.inventory_levels
    set    reserved  = reserved  + p_delta,
           updated_at = now()
    where  product_id  = p_product_id
      and  coalesce(variant_id::text,'') = coalesce(p_variant_id::text,'')
      and  location_id = p_location_id
    returning * into v_level;
    v_after := v_level.reserved;

  elsif p_quantity_type = 'on_order' then
    update public.inventory_levels
    set    on_order  = on_order  + p_delta,
           updated_at = now()
    where  product_id  = p_product_id
      and  coalesce(variant_id::text,'') = coalesce(p_variant_id::text,'')
      and  location_id = p_location_id
    returning * into v_level;
    v_after := v_level.on_order;

  elsif p_quantity_type = 'in_transit' then
    update public.inventory_levels
    set    in_transit = in_transit + p_delta,
           updated_at = now()
    where  product_id  = p_product_id
      and  coalesce(variant_id::text,'') = coalesce(p_variant_id::text,'')
      and  location_id = p_location_id
    returning * into v_level;
    v_after := v_level.in_transit;

  else
    raise exception 'Unknown quantity_type: %', p_quantity_type;
  end if;

  -- Ledger entry
  insert into public.inventory_ledger
    (workspace_id, product_id, variant_id, location_id,
     quantity_type, quantity_change, quantity_after,
     movement_type, reference_type, reference_id, reference_line_id,
     notes, created_by)
  values
    (p_workspace_id, p_product_id, p_variant_id, p_location_id,
     p_quantity_type, p_delta, v_after,
     p_movement_type, p_reference_type, p_reference_id, p_reference_line_id,
     p_notes, p_created_by);

  return v_level;
end;
$$;


-- ============================================================
-- 13. RPC: receive_purchase_order
--     Called when user clicks "Receive Goods" on a PO.
--     Accepts an array of {line_id, qty} to support partial
--     receipts.  Atomically updates levels + ledger + PO.
-- ============================================================
create or replace function public.receive_purchase_order(
  p_po_id       uuid,
  p_receipts    jsonb,   -- [{"line_id": "uuid", "qty": 5}, ...]
  p_created_by  uuid    default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po          public.purchase_orders%rowtype;
  v_line        public.purchase_order_lines%rowtype;
  v_receipt     jsonb;
  v_qty         int;
  v_all_done    boolean;
begin
  select * into v_po from public.purchase_orders where id = p_po_id;
  if not found then
    raise exception 'Purchase order not found';
  end if;

  if v_po.workspace_id not in (
    select workspace_id from public.workspace_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ) then
    raise exception 'Access denied';
  end if;

  if v_po.status not in ('in_transit','confirmed','partially_received') then
    raise exception 'PO must be confirmed or in transit before receiving goods';
  end if;

  -- Process each receipt line
  for v_receipt in select * from jsonb_array_elements(p_receipts)
  loop
    select * into v_line
    from public.purchase_order_lines
    where id = (v_receipt->>'line_id')::uuid and po_id = p_po_id;

    if not found then
      raise exception 'PO line % not found', v_receipt->>'line_id';
    end if;

    v_qty := (v_receipt->>'qty')::int;

    if v_qty <= 0 then continue; end if;
    if v_line.received_qty + v_qty > v_line.ordered_qty then
      raise exception 'Receipt qty % exceeds remaining on line %', v_qty, v_line.id;
    end if;

    -- Update line
    update public.purchase_order_lines
    set    received_qty = received_qty + v_qty
    where  id = v_line.id;

    -- in_transit ↓
    perform public.upsert_inventory_level(
      v_po.workspace_id, v_line.product_id, v_line.variant_id,
      v_po.destination_location_id,
      'in_transit', -v_qty,
      'po_received', 'purchase_order', p_po_id, v_line.id,
      'Received from PO ' || v_po.po_number, p_created_by
    );

    -- on_hand ↑
    perform public.upsert_inventory_level(
      v_po.workspace_id, v_line.product_id, v_line.variant_id,
      v_po.destination_location_id,
      'on_hand', v_qty,
      'po_received', 'purchase_order', p_po_id, v_line.id,
      'Received from PO ' || v_po.po_number, p_created_by
    );
  end loop;

  -- Update PO status
  select bool_and(received_qty >= ordered_qty) into v_all_done
  from public.purchase_order_lines where po_id = p_po_id;

  update public.purchase_orders
  set    status = case when v_all_done then 'received' else 'partially_received' end
  where  id = p_po_id;

  return json_build_object('success', true, 'status', case when v_all_done then 'received' else 'partially_received' end);
end;
$$;


-- ============================================================
-- 14. RPC: mark_po_in_transit
--     Called when user clicks "Mark as Shipped / ASN received".
--     Moves on_order → in_transit for all unshipped lines.
-- ============================================================
create or replace function public.mark_po_in_transit(
  p_po_id            uuid,
  p_carrier          text    default null,
  p_tracking_number  text    default null,
  p_shipping_method  text    default null,
  p_expected_arrival date    default null,
  p_created_by       uuid    default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po    public.purchase_orders%rowtype;
  v_line  public.purchase_order_lines%rowtype;
  v_qty   int;
begin
  select * into v_po from public.purchase_orders where id = p_po_id;
  if not found then raise exception 'Purchase order not found'; end if;

  if v_po.workspace_id not in (
    select workspace_id from public.workspace_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ) then
    raise exception 'Access denied';
  end if;

  if v_po.status not in ('confirmed','submitted') then
    raise exception 'PO must be confirmed before marking in transit';
  end if;

  -- For each line: move remaining on_order → in_transit
  for v_line in
    select * from public.purchase_order_lines
    where po_id = p_po_id and received_qty < ordered_qty
  loop
    v_qty := v_line.ordered_qty - v_line.received_qty;

    -- on_order ↓
    perform public.upsert_inventory_level(
      v_po.workspace_id, v_line.product_id, v_line.variant_id,
      v_po.destination_location_id,
      'on_order', -v_qty,
      'po_shipped', 'purchase_order', p_po_id, v_line.id,
      'PO ' || v_po.po_number || ' marked in transit', p_created_by
    );

    -- in_transit ↑
    perform public.upsert_inventory_level(
      v_po.workspace_id, v_line.product_id, v_line.variant_id,
      v_po.destination_location_id,
      'in_transit', v_qty,
      'po_shipped', 'purchase_order', p_po_id, v_line.id,
      'PO ' || v_po.po_number || ' marked in transit', p_created_by
    );
  end loop;

  -- Update PO
  update public.purchase_orders
  set    status           = 'in_transit',
         carrier          = coalesce(p_carrier, carrier),
         tracking_number  = coalesce(p_tracking_number, tracking_number),
         shipping_method  = coalesce(p_shipping_method, shipping_method),
         expected_arrival = coalesce(p_expected_arrival, expected_arrival),
         shipped_at       = now()
  where  id = p_po_id;

  return json_build_object('success', true);
end;
$$;


-- ============================================================
-- 15. RPC: confirm_purchase_order
--     Moves status → confirmed and sets on_order quantities.
-- ============================================================
create or replace function public.confirm_purchase_order(
  p_po_id       uuid,
  p_created_by  uuid default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po    public.purchase_orders%rowtype;
  v_line  public.purchase_order_lines%rowtype;
begin
  select * into v_po from public.purchase_orders where id = p_po_id;
  if not found then raise exception 'Purchase order not found'; end if;

  if v_po.workspace_id not in (
    select workspace_id from public.workspace_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ) then
    raise exception 'Access denied';
  end if;

  if v_po.status not in ('draft','submitted') then
    raise exception 'PO is already confirmed or past that stage';
  end if;

  for v_line in select * from public.purchase_order_lines where po_id = p_po_id
  loop
    -- on_order ↑
    perform public.upsert_inventory_level(
      v_po.workspace_id, v_line.product_id, v_line.variant_id,
      v_po.destination_location_id,
      'on_order', v_line.ordered_qty,
      'po_confirmed', 'purchase_order', p_po_id, v_line.id,
      'PO ' || v_po.po_number || ' confirmed', p_created_by
    );
  end loop;

  update public.purchase_orders set status = 'confirmed' where id = p_po_id;

  return json_build_object('success', true);
end;
$$;


-- ============================================================
-- 16. SEED DEFAULT LOCATIONS FOR A WORKSPACE
--     Every workspace gets five default locations that model
--     the reality of an e-commerce seller:
--
--       WH-MAIN      warehouse   Main Warehouse (is_default)
--       READY-SHIP   virtual     Picked & packed, awaiting carrier
--       IN-TRANSIT   in_transit  En route between locations or from supplier
--       DAMAGED      damaged     Damaged / quarantine
--       RETURNS      returns     Customer returns awaiting inspection
--
--     Channel locks (e.g. "locked on Shopify") are NOT a
--     location — they are inventory_reservations rows with
--       reason_type = 'channel'
--       reason_label = 'Shopify' / 'Amazon' / etc.
--     This keeps the quantity model clean:
--       available = on_hand - reserved  (ATS across all channels)
-- ============================================================
create or replace function public.seed_workspace_inventory_locations(
  p_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_locations
    (workspace_id, name, code, location_type, is_default, notes)
  values
    (p_workspace_id,
     'Main Warehouse',  'WH-MAIN',     'warehouse',  true,
     'Primary storage location for all sellable stock'),

    (p_workspace_id,
     'Ready to Ship',   'READY-SHIP',  'virtual',    false,
     'Stock picked and packed, sitting in the dispatch area awaiting carrier pickup. Once the carrier collects, move these to the relevant in-transit or sold bucket.'),

    (p_workspace_id,
     'In Transit',      'IN-TRANSIT',  'in_transit', false,
     'Stock en route between locations or arriving from a supplier. Populated automatically when a Purchase Order is marked as shipped.'),

    (p_workspace_id,
     'Damaged Goods',   'DAMAGED',     'damaged',    false,
     'Items that failed QC or were damaged. Stock here is excluded from Available to Sell.'),

    (p_workspace_id,
     'Returns',         'RETURNS',     'returns',    false,
     'Customer returns awaiting inspection. Transfer to Main Warehouse when cleared, or Damaged Goods if not resellable.')

  on conflict (workspace_id, code) do nothing;
end;
$$;

-- Auto-seed locations when a new workspace is created.
create or replace function public.handle_new_workspace_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_workspace_inventory_locations(new.id);
  return new;
end;
$$;

create trigger on_workspace_created_seed_inventory
  after insert on public.workspaces
  for each row execute function public.handle_new_workspace_inventory();


-- ============================================================
-- 17. Drop the old stock_quantity / track_inventory columns
--     from products once data is migrated to inventory_levels.
--     COMMENTED OUT — run manually after migration.
-- ============================================================
-- alter table public.products
--   drop column stock_quantity,
--   drop column low_stock_threshold,
--   drop column track_inventory;
