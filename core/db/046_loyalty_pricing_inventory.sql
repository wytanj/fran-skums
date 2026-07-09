-- ============================================================
-- Fran SKUMS - Loyalty pricing and inventory authority
--
-- Purpose:
--   Give Fran POS a quote-first pricing basis and reservation
--   lifecycle while keeping inventory movements in SKUMS.
--
-- Run AFTER: 045_fran_product_metadata.sql
-- ============================================================

create table if not exists public.pos_basket_quotes (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  location_id           uuid references public.pos_locations(id) on delete set null,
  inventory_location_id uuid references public.inventory_locations(id) on delete set null,
  register_id           uuid references public.pos_registers(id) on delete set null,
  register_session_id   uuid references public.pos_register_sessions(id) on delete set null,

  customer_ref          text,
  member_ref            text,
  quote_mode            text not null default 'checkout'
    check (quote_mode in ('checkout', 'reward', 'sample', 'preview')),
  currency              text not null default 'USD',
  quote_revision        text not null,
  status                text not null default 'quoted'
    check (status in ('quoted', 'reserved', 'committed', 'released', 'expired', 'cancelled')),
  idempotency_key       text,

  expires_at            timestamptz not null,
  price_source          jsonb not null default '{}',
  requested_context     jsonb not null default '{}',
  totals                jsonb not null default '{}',
  response_snapshot     jsonb not null default '{}',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_pos_basket_quotes_workspace
  on public.pos_basket_quotes(workspace_id, created_at desc);

create index if not exists idx_pos_basket_quotes_expires
  on public.pos_basket_quotes(workspace_id, expires_at);

create unique index if not exists idx_pos_basket_quotes_idempotency
  on public.pos_basket_quotes(workspace_id, idempotency_key)
  where idempotency_key is not null;

alter table public.pos_basket_quotes enable row level security;

create policy "Members can view POS basket quotes"
  on public.pos_basket_quotes for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage POS basket quotes"
  on public.pos_basket_quotes for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.pos_basket_quotes
  for each row execute function public.update_updated_at();


create table if not exists public.pos_basket_quote_lines (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  quote_id              uuid not null references public.pos_basket_quotes(id) on delete cascade,

  line_id               text,
  product_identity_id   uuid references public.product_identities(id) on delete set null,
  trade_unit_id         uuid references public.trade_units(id) on delete set null,
  listing_id            uuid references public.listings(id) on delete set null,
  channel_id            uuid references public.channels(id) on delete set null,
  sku_assignment_id     uuid references public.sku_assignments(id) on delete set null,
  identifier_id         uuid references public.identity_identifiers(id) on delete set null,
  product_id            uuid references public.products(id) on delete set null,
  variant_id            uuid references public.product_variants(id) on delete set null,
  inventory_location_id uuid references public.inventory_locations(id) on delete set null,

  sku                   text,
  display_name          text,
  requested_quantity    numeric(14,4) not null check (requested_quantity > 0),
  reservable_quantity   integer not null default 0,
  unit_price            numeric(14,4) not null default 0,
  list_price            numeric(14,4),
  discount_amount       numeric(14,4) not null default 0,
  tax_basis             jsonb not null default '{}',
  line_total            numeric(14,4) not null default 0,
  currency              text not null default 'USD',

  price_source          jsonb not null default '{}',
  availability          jsonb not null default '{}',
  product_context       jsonb not null default '{}',
  blocked               boolean not null default false,
  warnings              text[] not null default '{}',
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now()
);

create index if not exists idx_pos_basket_quote_lines_quote
  on public.pos_basket_quote_lines(quote_id);

create index if not exists idx_pos_basket_quote_lines_product
  on public.pos_basket_quote_lines(product_id)
  where product_id is not null;

create unique index if not exists idx_pos_basket_quote_lines_line_id
  on public.pos_basket_quote_lines(quote_id, line_id)
  where line_id is not null;

alter table public.pos_basket_quote_lines enable row level security;

create policy "POS basket quote lines follow quote access"
  on public.pos_basket_quote_lines for select
  using (
    quote_id in (
      select id from public.pos_basket_quotes
      where workspace_id in (select public.get_my_workspace_ids())
    )
  );

create policy "POS basket quote lines follow quote management"
  on public.pos_basket_quote_lines for all
  using (
    quote_id in (
      select id from public.pos_basket_quotes
      where workspace_id in (select public.get_my_writable_workspace_ids())
    )
  )
  with check (
    quote_id in (
      select id from public.pos_basket_quotes
      where workspace_id in (select public.get_my_writable_workspace_ids())
    )
  );


create table if not exists public.pos_reservations (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  quote_id              uuid references public.pos_basket_quotes(id) on delete set null,

  status                text not null default 'active'
    check (status in ('active', 'committed', 'released', 'expired', 'cancelled')),
  source                text not null default 'fran_pos',
  pos_cart_id           text,
  pos_sale_id           uuid references public.pos_sales(id) on delete set null,

  location_id           uuid references public.pos_locations(id) on delete set null,
  inventory_location_id uuid references public.inventory_locations(id) on delete set null,
  register_id           uuid references public.pos_registers(id) on delete set null,
  register_session_id   uuid references public.pos_register_sessions(id) on delete set null,

  idempotency_key       text,
  expires_at            timestamptz not null,
  committed_at          timestamptz,
  released_at           timestamptz,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_pos_reservations_workspace
  on public.pos_reservations(workspace_id, created_at desc);

create index if not exists idx_pos_reservations_quote
  on public.pos_reservations(quote_id)
  where quote_id is not null;

create index if not exists idx_pos_reservations_status
  on public.pos_reservations(workspace_id, status, expires_at);

create unique index if not exists idx_pos_reservations_idempotency
  on public.pos_reservations(workspace_id, idempotency_key)
  where idempotency_key is not null;

alter table public.pos_reservations enable row level security;

create policy "Members can view POS reservations"
  on public.pos_reservations for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage POS reservations"
  on public.pos_reservations for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.pos_reservations
  for each row execute function public.update_updated_at();


create table if not exists public.pos_reservation_lines (
  id                       uuid primary key default uuid_generate_v4(),
  workspace_id             uuid not null references public.workspaces(id) on delete cascade,
  reservation_id           uuid not null references public.pos_reservations(id) on delete cascade,
  quote_line_id            uuid references public.pos_basket_quote_lines(id) on delete set null,
  inventory_reservation_id uuid references public.inventory_reservations(id) on delete set null,

  product_id               uuid references public.products(id) on delete set null,
  variant_id               uuid references public.product_variants(id) on delete set null,
  inventory_location_id    uuid references public.inventory_locations(id) on delete set null,
  requested_qty            integer not null check (requested_qty > 0),
  reserved_qty             integer not null default 0 check (reserved_qty >= 0),
  status                   text not null default 'active'
    check (status in ('active', 'committed', 'released', 'expired', 'cancelled', 'failed')),
  metadata                 jsonb not null default '{}',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_pos_reservation_lines_reservation
  on public.pos_reservation_lines(reservation_id);

create index if not exists idx_pos_reservation_lines_inventory_reservation
  on public.pos_reservation_lines(inventory_reservation_id)
  where inventory_reservation_id is not null;

alter table public.pos_reservation_lines enable row level security;

create policy "POS reservation lines follow reservation access"
  on public.pos_reservation_lines for select
  using (
    reservation_id in (
      select id from public.pos_reservations
      where workspace_id in (select public.get_my_workspace_ids())
    )
  );

create policy "POS reservation lines follow reservation management"
  on public.pos_reservation_lines for all
  using (
    reservation_id in (
      select id from public.pos_reservations
      where workspace_id in (select public.get_my_writable_workspace_ids())
    )
  )
  with check (
    reservation_id in (
      select id from public.pos_reservations
      where workspace_id in (select public.get_my_writable_workspace_ids())
    )
  );

create trigger set_updated_at before update on public.pos_reservation_lines
  for each row execute function public.update_updated_at();


alter table public.inventory_reservations
  add column if not exists pos_reservation_id uuid references public.pos_reservations(id) on delete set null,
  add column if not exists quote_id uuid references public.pos_basket_quotes(id) on delete set null,
  add column if not exists quote_line_id uuid references public.pos_basket_quote_lines(id) on delete set null,
  add column if not exists pos_cart_id text,
  add column if not exists pos_sale_id uuid references public.pos_sales(id) on delete set null,
  add column if not exists source text not null default 'skums',
  add column if not exists idempotency_key text,
  add column if not exists status text not null default 'active',
  add column if not exists committed_at timestamptz,
  add column if not exists released_at timestamptz,
  add column if not exists metadata jsonb not null default '{}';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.inventory_reservations'::regclass
      and conname = 'inventory_reservations_reason_type_check'
  ) then
    alter table public.inventory_reservations
      drop constraint inventory_reservations_reason_type_check;
  end if;

  alter table public.inventory_reservations
    add constraint inventory_reservations_reason_type_check
    check (reason_type in (
      'order',
      'channel',
      'manual',
      'safety_stock',
      'transfer',
      'pos_cart',
      'reward',
      'sample'
    ));
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.inventory_reservations'::regclass
      and conname = 'inventory_reservations_status_check'
  ) then
    alter table public.inventory_reservations
      add constraint inventory_reservations_status_check
      check (status in ('active', 'committed', 'released', 'expired', 'cancelled'));
  end if;
end $$;

create index if not exists idx_inventory_reservations_pos_reservation
  on public.inventory_reservations(pos_reservation_id)
  where pos_reservation_id is not null;

create index if not exists idx_inventory_reservations_quote
  on public.inventory_reservations(quote_id)
  where quote_id is not null;

create unique index if not exists idx_inventory_reservations_line_idempotency
  on public.inventory_reservations(workspace_id, pos_reservation_id, quote_line_id)
  where pos_reservation_id is not null and quote_line_id is not null;


grant select, insert, update, delete on table
  public.pos_basket_quotes,
  public.pos_basket_quote_lines,
  public.pos_reservations,
  public.pos_reservation_lines
  to service_role;

grant select, insert, update on table public.inventory_reservations to service_role;
