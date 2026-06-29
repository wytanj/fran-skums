-- ============================================================
-- SKUMS POS Core
--
-- Purpose:
--   Add first-party POS primitives as an app layer over the SKUMS
--   product identity graph. POS sales reference product identities,
--   trade units, listings, identifiers, and contextual SKU assignments.
--
-- Run AFTER: 029_audit_events.sql
-- ============================================================

-- ============================================================
-- 1. POS LOCATIONS
-- ============================================================

create table if not exists public.pos_locations (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  inventory_location_id uuid references public.inventory_locations(id) on delete set null,

  name                  text not null,
  code                  text not null,
  timezone              text not null default 'UTC',
  currency              text not null default 'USD',
  is_active             boolean not null default true,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, code)
);

create index if not exists idx_pos_locations_workspace
  on public.pos_locations(workspace_id);

alter table public.pos_locations enable row level security;

create policy "Members can view POS locations"
  on public.pos_locations for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage POS locations"
  on public.pos_locations for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.pos_locations
  for each row execute function public.update_updated_at();


-- ============================================================
-- 2. POS REGISTERS AND SESSIONS
-- ============================================================

create table if not exists public.pos_registers (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  location_id     uuid not null references public.pos_locations(id) on delete cascade,

  register_code   text not null,
  name            text not null,
  device_ref      text,
  is_active       boolean not null default true,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (workspace_id, location_id, register_code)
);

create index if not exists idx_pos_registers_workspace
  on public.pos_registers(workspace_id);

create index if not exists idx_pos_registers_location
  on public.pos_registers(location_id);

alter table public.pos_registers enable row level security;

create policy "Members can view POS registers"
  on public.pos_registers for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage POS registers"
  on public.pos_registers for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.pos_registers
  for each row execute function public.update_updated_at();


create table if not exists public.pos_register_sessions (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  register_id         uuid not null references public.pos_registers(id) on delete cascade,
  location_id         uuid not null references public.pos_locations(id) on delete cascade,

  opened_by           uuid references public.profiles(id) on delete set null,
  closed_by           uuid references public.profiles(id) on delete set null,
  status              text not null default 'open'
    check (status in ('open', 'closed', 'suspended')),
  opened_at           timestamptz not null default now(),
  closed_at           timestamptz,
  opening_float       numeric(14,4),
  closing_cash_count  numeric(14,4),
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_pos_sessions_workspace
  on public.pos_register_sessions(workspace_id, opened_at desc);

create index if not exists idx_pos_sessions_register
  on public.pos_register_sessions(register_id, status);

alter table public.pos_register_sessions enable row level security;

create policy "Members can view POS sessions"
  on public.pos_register_sessions for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage POS sessions"
  on public.pos_register_sessions for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.pos_register_sessions
  for each row execute function public.update_updated_at();


-- ============================================================
-- 3. POS SALES
-- ============================================================

create table if not exists public.pos_sales (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  location_id         uuid references public.pos_locations(id) on delete set null,
  register_id         uuid references public.pos_registers(id) on delete set null,
  register_session_id uuid references public.pos_register_sessions(id) on delete set null,

  receipt_number      text not null,
  sale_type           text not null default 'sale'
    check (sale_type in ('sale', 'return', 'exchange', 'sample_issue', 'tester_conversion', 'writeoff')),
  status              text not null default 'completed'
    check (status in ('draft', 'completed', 'voided', 'refunded', 'failed')),

  customer_ref        text,
  cashier_user_id     uuid references public.profiles(id) on delete set null,

  currency            text not null default 'USD',
  subtotal            numeric(14,4) not null default 0,
  discount_total      numeric(14,4) not null default 0,
  tax_total           numeric(14,4) not null default 0,
  total               numeric(14,4) not null default 0,

  source              text not null default 'pos'
    check (source in ('pos', 'api', 'import', 'sync', 'system')),
  idempotency_key     text,
  completed_at        timestamptz,
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_pos_sales_workspace
  on public.pos_sales(workspace_id, created_at desc);

create index if not exists idx_pos_sales_location
  on public.pos_sales(location_id, created_at desc)
  where location_id is not null;

create unique index if not exists idx_pos_sales_receipt
  on public.pos_sales(workspace_id, receipt_number);

create unique index if not exists idx_pos_sales_idempotency
  on public.pos_sales(workspace_id, idempotency_key)
  where idempotency_key is not null;

alter table public.pos_sales enable row level security;

create policy "Members can view POS sales"
  on public.pos_sales for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can insert POS sales"
  on public.pos_sales for insert
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create policy "Members can update POS sales"
  on public.pos_sales for update
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.pos_sales
  for each row execute function public.update_updated_at();


create table if not exists public.pos_sale_items (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  sale_id               uuid not null references public.pos_sales(id) on delete cascade,

  line_number           integer not null,
  product_identity_id   uuid references public.product_identities(id) on delete set null,
  trade_unit_id         uuid references public.trade_units(id) on delete set null,
  listing_id            uuid references public.listings(id) on delete set null,
  channel_id            uuid references public.channels(id) on delete set null,
  sku_assignment_id     uuid references public.sku_assignments(id) on delete set null,
  identifier_id         uuid references public.identity_identifiers(id) on delete set null,

  product_id            uuid references public.products(id) on delete set null,
  variant_id            uuid references public.product_variants(id) on delete set null,
  batch_id              uuid references public.expiry_batches(id) on delete set null,

  display_name          text not null,
  scanned_value         text,
  quantity              numeric(14,4) not null,
  unit_price            numeric(14,4) not null,
  list_price            numeric(14,4),
  discount_amount       numeric(14,4) not null default 0,
  tax_amount            numeric(14,4) not null default 0,
  line_total            numeric(14,4) not null,

  line_type             text not null default 'sale'
    check (line_type in ('sale', 'return', 'exchange_in', 'sample', 'tester', 'bundle_component', 'writeoff')),
  reason_code           text,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),

  unique (sale_id, line_number)
);

create index if not exists idx_pos_sale_items_workspace
  on public.pos_sale_items(workspace_id, created_at desc);

create index if not exists idx_pos_sale_items_sale
  on public.pos_sale_items(sale_id);

create index if not exists idx_pos_sale_items_identity
  on public.pos_sale_items(product_identity_id)
  where product_identity_id is not null;

create index if not exists idx_pos_sale_items_trade_unit
  on public.pos_sale_items(trade_unit_id)
  where trade_unit_id is not null;

alter table public.pos_sale_items enable row level security;

create policy "POS sale items follow sale access"
  on public.pos_sale_items for select
  using (
    sale_id in (
      select id from public.pos_sales
      where workspace_id in (select public.get_my_workspace_ids())
    )
  );

create policy "POS sale items follow sale insert"
  on public.pos_sale_items for insert
  with check (
    sale_id in (
      select id from public.pos_sales
      where workspace_id in (select public.get_my_writable_workspace_ids())
    )
  );


create table if not exists public.pos_sale_payments (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  sale_id         uuid not null references public.pos_sales(id) on delete cascade,

  payment_method  text not null,
  payment_ref     text,
  amount          numeric(14,4) not null,
  currency        text not null default 'USD',
  status          text not null default 'captured'
    check (status in ('pending', 'captured', 'failed', 'refunded', 'voided')),
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index if not exists idx_pos_sale_payments_sale
  on public.pos_sale_payments(sale_id);

alter table public.pos_sale_payments enable row level security;

create policy "POS payments follow sale access"
  on public.pos_sale_payments for select
  using (
    sale_id in (
      select id from public.pos_sales
      where workspace_id in (select public.get_my_workspace_ids())
    )
  );

create policy "POS payments follow sale insert"
  on public.pos_sale_payments for insert
  with check (
    sale_id in (
      select id from public.pos_sales
      where workspace_id in (select public.get_my_writable_workspace_ids())
    )
  );


-- ============================================================
-- 4. DETERMINISTIC SCAN RESOLUTION
-- ============================================================

create or replace function public.resolve_pos_scan(
  p_workspace_id uuid,
  p_identifier text,
  p_channel_id uuid default null,
  p_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identifier text := lower(trim(p_identifier));
  v_matches jsonb;
  v_count int;
begin
  if v_identifier is null or v_identifier = '' then
    return jsonb_build_object(
      'match_status', 'none',
      'warnings', jsonb_build_array('empty_identifier'),
      'matches', '[]'::jsonb
    );
  end if;

  with candidates as (
    select
      100 as confidence,
      'identity_identifier'::text as candidate_source,
      ii.id as identifier_id,
      null::uuid as sku_assignment_id,
      null::uuid as listing_id,
      null::uuid as channel_id,
      pi.id as product_identity_id,
      tu.id as trade_unit_id,
      pi.product_id,
      tu.variant_id,
      pi.name as display_name,
      ii.identifier_value as matched_value,
      null::text as sku,
      jsonb_build_object('identifier_type', ii.identifier_type) as metadata
    from public.identity_identifiers ii
    join public.product_identities pi
      on pi.id = coalesce(ii.product_identity_id, (
        select tu2.product_identity_id from public.trade_units tu2 where tu2.id = ii.trade_unit_id
      ))
    left join public.trade_units tu on tu.id = ii.trade_unit_id
    where ii.workspace_id = p_workspace_id
      and lower(ii.identifier_value) = v_identifier

    union all

    select
      case when sa.is_primary then 90 else 80 end as confidence,
      'sku_assignment'::text as candidate_source,
      null::uuid as identifier_id,
      sa.id as sku_assignment_id,
      null::uuid as listing_id,
      case when sa.scope_type = 'channel' then sa.scope_id else null end as channel_id,
      coalesce(sa.product_identity_id, tu.product_identity_id) as product_identity_id,
      sa.trade_unit_id,
      coalesce(sa.product_id, pi.product_id, tu.product_id) as product_id,
      coalesce(sa.variant_id, tu.variant_id) as variant_id,
      coalesce(pi.name, p.title, sa.sku) as display_name,
      sa.sku as matched_value,
      sa.sku,
      jsonb_build_object('scope_type', sa.scope_type, 'scope_label', sa.scope_label) as metadata
    from public.sku_assignments sa
    left join public.trade_units tu on tu.id = sa.trade_unit_id
    left join public.product_identities pi on pi.id = coalesce(sa.product_identity_id, tu.product_identity_id)
    left join public.products p on p.id = coalesce(sa.product_id, pi.product_id, tu.product_id)
    where sa.workspace_id = p_workspace_id
      and sa.is_active = true
      and lower(sa.sku) = v_identifier
      and (
        p_channel_id is null
        or sa.scope_type <> 'channel'
        or sa.scope_id = p_channel_id
      )

    union all

    select
      95 as confidence,
      'listing_identifier'::text as candidate_source,
      null::uuid as identifier_id,
      null::uuid as sku_assignment_id,
      l.id as listing_id,
      l.channel_id,
      l.product_identity_id,
      l.trade_unit_id,
      l.product_id,
      l.variant_id,
      coalesce(l.listing_title, pi.name) as display_name,
      li.identifier_value as matched_value,
      l.seller_sku as sku,
      jsonb_build_object('identifier_type', li.identifier_type, 'listing_status', l.status) as metadata
    from public.listing_identifiers li
    join public.listings l on l.id = li.listing_id
    join public.product_identities pi on pi.id = l.product_identity_id
    where li.workspace_id = p_workspace_id
      and lower(li.identifier_value) = v_identifier
      and (p_channel_id is null or l.channel_id = p_channel_id)

    union all

    select
      85 as confidence,
      'listing_seller_sku'::text as candidate_source,
      null::uuid as identifier_id,
      null::uuid as sku_assignment_id,
      l.id as listing_id,
      l.channel_id,
      l.product_identity_id,
      l.trade_unit_id,
      l.product_id,
      l.variant_id,
      coalesce(l.listing_title, pi.name) as display_name,
      l.seller_sku as matched_value,
      l.seller_sku as sku,
      jsonb_build_object('listing_status', l.status) as metadata
    from public.listings l
    join public.product_identities pi on pi.id = l.product_identity_id
    where l.workspace_id = p_workspace_id
      and l.seller_sku is not null
      and lower(l.seller_sku) = v_identifier
      and (p_channel_id is null or l.channel_id = p_channel_id)
  )
  select coalesce(jsonb_agg(to_jsonb(c) order by c.confidence desc), '[]'::jsonb)
  into v_matches
  from (
    select *
    from candidates
    order by confidence desc, candidate_source
    limit 10
  ) c;

  v_count := jsonb_array_length(v_matches);

  return jsonb_build_object(
    'match_status', case when v_count = 0 then 'none' when v_count = 1 then 'single' else 'ambiguous' end,
    'identifier', p_identifier,
    'workspace_id', p_workspace_id,
    'channel_id', p_channel_id,
    'location_id', p_location_id,
    'warnings', case when v_count > 1 then jsonb_build_array('ambiguous_identifier') else '[]'::jsonb end,
    'matches', v_matches
  );
end;
$$;

grant execute on function public.resolve_pos_scan(uuid, text, uuid, uuid) to authenticated, service_role;


-- ============================================================
-- 5. AUDIT TRIGGERS
-- ============================================================

drop trigger if exists audit_pos_locations on public.pos_locations;
create trigger audit_pos_locations
  after insert or update or delete on public.pos_locations
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_pos_registers on public.pos_registers;
create trigger audit_pos_registers
  after insert or update or delete on public.pos_registers
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_pos_register_sessions on public.pos_register_sessions;
create trigger audit_pos_register_sessions
  after insert or update or delete on public.pos_register_sessions
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_pos_sales on public.pos_sales;
create trigger audit_pos_sales
  after insert or update or delete on public.pos_sales
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_pos_sale_items on public.pos_sale_items;
create trigger audit_pos_sale_items
  after insert or update or delete on public.pos_sale_items
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_pos_sale_payments on public.pos_sale_payments;
create trigger audit_pos_sale_payments
  after insert or update or delete on public.pos_sale_payments
  for each row execute function public.record_graph_audit_event();
