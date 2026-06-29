-- ============================================================
-- SKUMS - Store operations workflow
-- Store replenishment, receiving, and exceptions for POS -> SKUMS -> 3PL.
-- Run AFTER: 043_fulfillment_integrations.sql
-- ============================================================

create table if not exists public.store_replenishment_requests (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  request_number        text not null,
  request_type          text not null default 'manual'
    check (request_type in ('manual', 'low_stock', 'cycle_count', 'campaign', 'system_suggested', 'pos_requested')),
  status                text not null default 'submitted'
    check (status in ('draft', 'submitted', 'in_review', 'approved', 'rejected', 'converted', 'cancelled')),
  priority              text not null default 'normal'
    check (priority in ('low', 'normal', 'urgent', 'critical')),
  source_type           text not null default 'skums'
    check (source_type in ('pos', 'skums', 'system', 'integration')),
  source_ref            text,
  idempotency_key       text,

  pos_location_id       uuid references public.pos_locations(id) on delete set null,
  store_location_id     uuid references public.inventory_locations(id) on delete set null,
  requested_by          uuid references public.profiles(id) on delete set null,
  approved_by           uuid references public.profiles(id) on delete set null,
  needed_by             date,
  approved_at           timestamptz,
  reason                text,
  metadata              jsonb not null default '{}',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, request_number)
);

create unique index if not exists idx_store_replenishment_requests_idempotency
  on public.store_replenishment_requests(workspace_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_store_replenishment_requests_workspace_status
  on public.store_replenishment_requests(workspace_id, status, created_at desc);

create index if not exists idx_store_replenishment_requests_store_location
  on public.store_replenishment_requests(store_location_id, created_at desc)
  where store_location_id is not null;

alter table public.store_replenishment_requests enable row level security;

drop policy if exists "Members can view store replenishment requests"
  on public.store_replenishment_requests;
create policy "Members can view store replenishment requests"
  on public.store_replenishment_requests for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage store replenishment requests"
  on public.store_replenishment_requests;
create policy "Members can manage store replenishment requests"
  on public.store_replenishment_requests for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.store_replenishment_requests
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.store_replenishment_requests;
create trigger set_updated_at before update on public.store_replenishment_requests
  for each row execute function public.update_updated_at();


create table if not exists public.store_replenishment_request_lines (
  id                    uuid primary key default uuid_generate_v4(),
  request_id            uuid not null references public.store_replenishment_requests(id) on delete cascade,
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  product_identity_id   uuid references public.product_identities(id) on delete set null,
  trade_unit_id         uuid references public.trade_units(id) on delete set null,
  listing_id            uuid references public.listings(id) on delete set null,
  channel_id            uuid references public.channels(id) on delete set null,
  sku_assignment_id     uuid references public.sku_assignments(id) on delete set null,
  identifier_id         uuid references public.identity_identifiers(id) on delete set null,
  product_id            uuid references public.products(id) on delete set null,
  variant_id            uuid references public.product_variants(id) on delete set null,

  sku                   text,
  requested_qty         integer not null check (requested_qty > 0),
  approved_qty          integer check (approved_qty is null or approved_qty >= 0),
  status                text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'converted', 'unresolved')),
  reason                text,
  metadata              jsonb not null default '{}',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_store_replenishment_request_lines_request
  on public.store_replenishment_request_lines(request_id);

create index if not exists idx_store_replenishment_request_lines_product
  on public.store_replenishment_request_lines(workspace_id, product_id)
  where product_id is not null;

alter table public.store_replenishment_request_lines enable row level security;

drop policy if exists "Members can view store replenishment request lines"
  on public.store_replenishment_request_lines;
create policy "Members can view store replenishment request lines"
  on public.store_replenishment_request_lines for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage store replenishment request lines"
  on public.store_replenishment_request_lines;
create policy "Members can manage store replenishment request lines"
  on public.store_replenishment_request_lines for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.store_replenishment_request_lines
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.store_replenishment_request_lines;
create trigger set_updated_at before update on public.store_replenishment_request_lines
  for each row execute function public.update_updated_at();


create table if not exists public.store_replenishment_orders (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  order_number          text not null,
  request_id            uuid references public.store_replenishment_requests(id) on delete set null,
  connection_id         uuid references public.integration_connections(id) on delete set null,

  status                text not null default 'draft'
    check (status in (
      'draft',
      'approved',
      'queued',
      'sent_to_3pl',
      'acknowledged',
      'partially_shipped',
      'shipped',
      'partially_received',
      'received',
      'exception',
      'cancelled',
      'failed'
    )),
  priority              text not null default 'normal'
    check (priority in ('low', 'normal', 'urgent', 'critical')),

  source_location_id      uuid references public.inventory_locations(id) on delete set null,
  destination_location_id uuid references public.inventory_locations(id) on delete set null,
  pos_location_id         uuid references public.pos_locations(id) on delete set null,

  external_order_id     text,
  external_status       text,
  sent_at               timestamptz,
  expected_delivery_at  timestamptz,
  delivered_at          timestamptz,
  approved_by           uuid references public.profiles(id) on delete set null,
  approved_at           timestamptz,
  metadata              jsonb not null default '{}',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, order_number)
);

create index if not exists idx_store_replenishment_orders_workspace_status
  on public.store_replenishment_orders(workspace_id, status, created_at desc);

create index if not exists idx_store_replenishment_orders_connection
  on public.store_replenishment_orders(connection_id, created_at desc)
  where connection_id is not null;

create index if not exists idx_store_replenishment_orders_destination
  on public.store_replenishment_orders(destination_location_id, created_at desc)
  where destination_location_id is not null;

alter table public.store_replenishment_orders enable row level security;

drop policy if exists "Members can view store replenishment orders"
  on public.store_replenishment_orders;
create policy "Members can view store replenishment orders"
  on public.store_replenishment_orders for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage store replenishment orders"
  on public.store_replenishment_orders;
create policy "Members can manage store replenishment orders"
  on public.store_replenishment_orders for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.store_replenishment_orders
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.store_replenishment_orders;
create trigger set_updated_at before update on public.store_replenishment_orders
  for each row execute function public.update_updated_at();


create table if not exists public.store_replenishment_order_lines (
  id                    uuid primary key default uuid_generate_v4(),
  order_id              uuid not null references public.store_replenishment_orders(id) on delete cascade,
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  request_line_id       uuid references public.store_replenishment_request_lines(id) on delete set null,

  product_identity_id   uuid references public.product_identities(id) on delete set null,
  trade_unit_id         uuid references public.trade_units(id) on delete set null,
  listing_id            uuid references public.listings(id) on delete set null,
  channel_id            uuid references public.channels(id) on delete set null,
  sku_assignment_id     uuid references public.sku_assignments(id) on delete set null,
  identifier_id         uuid references public.identity_identifiers(id) on delete set null,
  product_id            uuid references public.products(id) on delete set null,
  variant_id            uuid references public.product_variants(id) on delete set null,

  sku                   text,
  ordered_qty           integer not null check (ordered_qty > 0),
  allocated_qty         integer not null default 0 check (allocated_qty >= 0),
  shipped_qty           integer not null default 0 check (shipped_qty >= 0),
  received_qty          integer not null default 0 check (received_qty >= 0),
  damaged_qty           integer not null default 0 check (damaged_qty >= 0),
  short_qty             integer not null default 0 check (short_qty >= 0),
  external_line_id      text,
  status                text not null default 'ordered'
    check (status in ('ordered', 'allocated', 'shipped', 'partially_received', 'received', 'exception', 'cancelled')),
  metadata              jsonb not null default '{}',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_store_replenishment_order_lines_order
  on public.store_replenishment_order_lines(order_id);

create index if not exists idx_store_replenishment_order_lines_product
  on public.store_replenishment_order_lines(workspace_id, product_id)
  where product_id is not null;

alter table public.store_replenishment_order_lines enable row level security;

drop policy if exists "Members can view store replenishment order lines"
  on public.store_replenishment_order_lines;
create policy "Members can view store replenishment order lines"
  on public.store_replenishment_order_lines for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage store replenishment order lines"
  on public.store_replenishment_order_lines;
create policy "Members can manage store replenishment order lines"
  on public.store_replenishment_order_lines for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.store_replenishment_order_lines
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.store_replenishment_order_lines;
create trigger set_updated_at before update on public.store_replenishment_order_lines
  for each row execute function public.update_updated_at();


create table if not exists public.receiving_sessions (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  session_number        text not null,
  receipt_type          text not null default 'store_replenishment'
    check (receipt_type in ('store_replenishment', 'transfer', 'purchase_order', 'manual')),
  status                text not null default 'draft'
    check (status in ('draft', 'submitted', 'reconciled', 'exception', 'cancelled')),
  idempotency_key       text,

  replenishment_order_id uuid references public.store_replenishment_orders(id) on delete set null,
  transfer_id            uuid references public.inventory_transfers(id) on delete set null,
  purchase_order_id      uuid references public.purchase_orders(id) on delete set null,
  pos_location_id        uuid references public.pos_locations(id) on delete set null,
  inventory_location_id  uuid references public.inventory_locations(id) on delete set null,

  source_ref            text,
  received_by           uuid references public.profiles(id) on delete set null,
  started_at            timestamptz not null default now(),
  received_at           timestamptz,
  submitted_at          timestamptz,
  reconciled_at         timestamptz,
  metadata              jsonb not null default '{}',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, session_number)
);

create unique index if not exists idx_receiving_sessions_idempotency
  on public.receiving_sessions(workspace_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_receiving_sessions_workspace_status
  on public.receiving_sessions(workspace_id, status, created_at desc);

create index if not exists idx_receiving_sessions_replenishment_order
  on public.receiving_sessions(replenishment_order_id)
  where replenishment_order_id is not null;

alter table public.receiving_sessions enable row level security;

drop policy if exists "Members can view receiving sessions"
  on public.receiving_sessions;
create policy "Members can view receiving sessions"
  on public.receiving_sessions for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage receiving sessions"
  on public.receiving_sessions;
create policy "Members can manage receiving sessions"
  on public.receiving_sessions for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.receiving_sessions
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.receiving_sessions;
create trigger set_updated_at before update on public.receiving_sessions
  for each row execute function public.update_updated_at();


create table if not exists public.receiving_session_lines (
  id                    uuid primary key default uuid_generate_v4(),
  session_id            uuid not null references public.receiving_sessions(id) on delete cascade,
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  replenishment_order_line_id uuid references public.store_replenishment_order_lines(id) on delete set null,

  product_identity_id   uuid references public.product_identities(id) on delete set null,
  trade_unit_id         uuid references public.trade_units(id) on delete set null,
  listing_id            uuid references public.listings(id) on delete set null,
  channel_id            uuid references public.channels(id) on delete set null,
  sku_assignment_id     uuid references public.sku_assignments(id) on delete set null,
  identifier_id         uuid references public.identity_identifiers(id) on delete set null,
  product_id            uuid references public.products(id) on delete set null,
  variant_id            uuid references public.product_variants(id) on delete set null,

  sku                   text,
  expected_qty          integer not null default 0 check (expected_qty >= 0),
  received_qty          integer not null default 0 check (received_qty >= 0),
  damaged_qty           integer not null default 0 check (damaged_qty >= 0),
  overage_qty           integer not null default 0 check (overage_qty >= 0),
  short_qty             integer not null default 0 check (short_qty >= 0),
  exception_type        text
    check (exception_type is null or exception_type in ('short', 'damaged', 'over', 'wrong_sku', 'unexpected_item', 'unmapped_sku')),
  status                text not null default 'pending'
    check (status in ('pending', 'matched', 'exception', 'resolved')),
  metadata              jsonb not null default '{}',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_receiving_session_lines_session
  on public.receiving_session_lines(session_id);

create index if not exists idx_receiving_session_lines_product
  on public.receiving_session_lines(workspace_id, product_id)
  where product_id is not null;

alter table public.receiving_session_lines enable row level security;

drop policy if exists "Members can view receiving session lines"
  on public.receiving_session_lines;
create policy "Members can view receiving session lines"
  on public.receiving_session_lines for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage receiving session lines"
  on public.receiving_session_lines;
create policy "Members can manage receiving session lines"
  on public.receiving_session_lines for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.receiving_session_lines
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.receiving_session_lines;
create trigger set_updated_at before update on public.receiving_session_lines
  for each row execute function public.update_updated_at();


create table if not exists public.inventory_exceptions (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  exception_type        text not null
    check (exception_type in ('short_receipt', 'damaged_receipt', 'over_receipt', 'wrong_sku', 'unmapped_sku', 'stock_variance', '3pl_error', 'other')),
  severity              text not null default 'medium'
    check (severity in ('low', 'medium', 'high', 'critical')),
  status                text not null default 'open'
    check (status in ('open', 'in_review', 'resolved', 'dismissed', 'escalated')),
  source_type           text not null default 'manual'
    check (source_type in ('pos_inventory_event', 'receiving_session', 'replenishment_order', 'integration', 'manual')),
  source_id             uuid,

  pos_location_id       uuid references public.pos_locations(id) on delete set null,
  inventory_location_id uuid references public.inventory_locations(id) on delete set null,
  connection_id         uuid references public.integration_connections(id) on delete set null,

  product_identity_id   uuid references public.product_identities(id) on delete set null,
  trade_unit_id         uuid references public.trade_units(id) on delete set null,
  listing_id            uuid references public.listings(id) on delete set null,
  channel_id            uuid references public.channels(id) on delete set null,
  sku_assignment_id     uuid references public.sku_assignments(id) on delete set null,
  identifier_id         uuid references public.identity_identifiers(id) on delete set null,
  product_id            uuid references public.products(id) on delete set null,
  variant_id            uuid references public.product_variants(id) on delete set null,

  sku                   text,
  expected_qty          integer,
  actual_qty            integer,
  title                 text not null,
  summary               text,
  evidence              jsonb not null default '{}',
  resolution            jsonb not null default '{}',
  assigned_to           uuid references public.profiles(id) on delete set null,
  resolved_by           uuid references public.profiles(id) on delete set null,
  resolved_at           timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_inventory_exceptions_workspace_status
  on public.inventory_exceptions(workspace_id, status, severity, created_at desc);

create index if not exists idx_inventory_exceptions_product
  on public.inventory_exceptions(workspace_id, product_id)
  where product_id is not null;

create index if not exists idx_inventory_exceptions_source
  on public.inventory_exceptions(source_type, source_id)
  where source_id is not null;

alter table public.inventory_exceptions enable row level security;

drop policy if exists "Members can view inventory exceptions"
  on public.inventory_exceptions;
create policy "Members can view inventory exceptions"
  on public.inventory_exceptions for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage inventory exceptions"
  on public.inventory_exceptions;
create policy "Members can manage inventory exceptions"
  on public.inventory_exceptions for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.inventory_exceptions
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.inventory_exceptions;
create trigger set_updated_at before update on public.inventory_exceptions
  for each row execute function public.update_updated_at();


drop view if exists public.v_store_replenishment_requests;
create view public.v_store_replenishment_requests
with (security_invoker = true)
as
select
  r.*,
  pl.name as pos_location_name,
  pl.code as pos_location_code,
  il.name as store_location_name,
  il.code as store_location_code,
  count(rl.id)::int as line_count,
  coalesce(sum(rl.requested_qty), 0)::int as total_requested_qty,
  coalesce(sum(coalesce(rl.approved_qty, 0)), 0)::int as total_approved_qty
from public.store_replenishment_requests r
left join public.pos_locations pl on pl.id = r.pos_location_id
left join public.inventory_locations il on il.id = r.store_location_id
left join public.store_replenishment_request_lines rl on rl.request_id = r.id
group by r.id, pl.name, pl.code, il.name, il.code;

grant select on public.v_store_replenishment_requests
  to authenticated, service_role;


drop view if exists public.v_store_replenishment_orders;
create view public.v_store_replenishment_orders
with (security_invoker = true)
as
select
  o.*,
  src.name as source_location_name,
  src.code as source_location_code,
  dst.name as destination_location_name,
  dst.code as destination_location_code,
  pl.name as pos_location_name,
  pl.code as pos_location_code,
  ic.name as connection_name,
  ind.slug as integration_slug,
  count(ol.id)::int as line_count,
  coalesce(sum(ol.ordered_qty), 0)::int as total_ordered_qty,
  coalesce(sum(ol.shipped_qty), 0)::int as total_shipped_qty,
  coalesce(sum(ol.received_qty), 0)::int as total_received_qty,
  coalesce(sum(ol.damaged_qty), 0)::int as total_damaged_qty,
  coalesce(sum(ol.short_qty), 0)::int as total_short_qty
from public.store_replenishment_orders o
left join public.inventory_locations src on src.id = o.source_location_id
left join public.inventory_locations dst on dst.id = o.destination_location_id
left join public.pos_locations pl on pl.id = o.pos_location_id
left join public.integration_connections ic on ic.id = o.connection_id
left join public.integration_node_definitions ind on ind.id = ic.node_def_id
left join public.store_replenishment_order_lines ol on ol.order_id = o.id
group by o.id, src.name, src.code, dst.name, dst.code, pl.name, pl.code, ic.name, ind.slug;

grant select on public.v_store_replenishment_orders
  to authenticated, service_role;
