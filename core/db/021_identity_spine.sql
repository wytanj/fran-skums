-- ============================================================
-- SKUMS Identity Spine
--
-- Purpose:
--   Stop treating SKU as the canonical product identity.
--
-- Model:
--   product_identities      canonical identity records for things SKUMS knows
--   trade_units             countable/sellable forms: each, pack, case, pallet
--   identity_identifiers    GTIN/UPC/EAN/ASIN/etc. attached to identities/units
--   sku_assignments         context-scoped SKU labels
--
-- Run AFTER: organizations.sql and product base schema.
-- ============================================================

-- ============================================================
-- 1. PRODUCT IDENTITIES
-- ============================================================

create table if not exists public.product_identities (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  -- Compatibility bridge while the current app is still product-row first.
  product_id    uuid references public.products(id) on delete cascade,

  name          text not null,
  description   text,
  identity_kind text not null default 'product'
    check (identity_kind in ('product', 'component', 'material', 'service', 'digital', 'bundle')),

  status        text not null default 'active'
    check (status in ('draft', 'active', 'archived')),

  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (workspace_id, product_id)
);

create index if not exists idx_product_identities_workspace
  on public.product_identities(workspace_id);

create index if not exists idx_product_identities_product
  on public.product_identities(product_id)
  where product_id is not null;

alter table public.product_identities enable row level security;

create policy "Members can view product identities"
  on public.product_identities for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage product identities"
  on public.product_identities for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.product_identities
  for each row execute function public.update_updated_at();


-- ============================================================
-- 2. TRADE UNITS
-- ============================================================

create table if not exists public.trade_units (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  product_identity_id uuid not null references public.product_identities(id) on delete cascade,

  -- Optional bridge to existing product/variant rows.
  product_id          uuid references public.products(id) on delete cascade,
  variant_id          uuid references public.product_variants(id) on delete cascade,

  parent_trade_unit_id uuid references public.trade_units(id) on delete set null,

  unit_kind           text not null default 'each'
    check (unit_kind in ('each', 'pack', 'case', 'pallet', 'bundle', 'bulk', 'sample')),
  label               text not null,

  -- Quantity represented by this unit. Examples:
  --   each switch = 1 switch
  --   pack of 10 switches = 10 switch
  --   case of 24 bottles = 24 bottle
  quantity            numeric(18,6) not null default 1 check (quantity > 0),
  base_unit           text not null default 'each',
  conversion_factor   numeric(18,6) not null default 1 check (conversion_factor > 0),

  is_default          boolean not null default false,
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_trade_units_workspace
  on public.trade_units(workspace_id);

create index if not exists idx_trade_units_identity
  on public.trade_units(product_identity_id);

create index if not exists idx_trade_units_product
  on public.trade_units(product_id)
  where product_id is not null;

create unique index if not exists idx_trade_units_one_default_per_identity
  on public.trade_units(product_identity_id)
  where is_default = true;

alter table public.trade_units enable row level security;

create policy "Members can view trade units"
  on public.trade_units for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage trade units"
  on public.trade_units for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.trade_units
  for each row execute function public.update_updated_at();


-- ============================================================
-- 3. IDENTITY IDENTIFIERS
-- ============================================================

create table if not exists public.identity_identifiers (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  product_identity_id uuid references public.product_identities(id) on delete cascade,
  trade_unit_id       uuid references public.trade_units(id) on delete cascade,

  identifier_type     text not null
    check (identifier_type in (
      'gtin', 'upc', 'ean', 'isbn', 'asin', 'mpn',
      'supplier_item', 'manufacturer_part', 'shopify_product',
      'shopify_variant', 'marketplace_listing', 'erp_item', 'wms_item',
      'skums_public_id', 'other'
    )),
  identifier_value    text not null,
  issuer              text,
  source              text,
  is_primary          boolean not null default false,
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  check (product_identity_id is not null or trade_unit_id is not null)
);

create index if not exists idx_identity_identifiers_workspace
  on public.identity_identifiers(workspace_id);

create index if not exists idx_identity_identifiers_identity
  on public.identity_identifiers(product_identity_id)
  where product_identity_id is not null;

create index if not exists idx_identity_identifiers_trade_unit
  on public.identity_identifiers(trade_unit_id)
  where trade_unit_id is not null;

create unique index if not exists idx_identity_identifiers_unique_in_workspace
  on public.identity_identifiers(
    workspace_id,
    identifier_type,
    lower(identifier_value),
    coalesce(lower(issuer), '')
  );

alter table public.identity_identifiers enable row level security;

create policy "Members can view identity identifiers"
  on public.identity_identifiers for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage identity identifiers"
  on public.identity_identifiers for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.identity_identifiers
  for each row execute function public.update_updated_at();


-- ============================================================
-- 4. SKU ASSIGNMENTS
-- ============================================================

create table if not exists public.sku_assignments (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,

  sku                 text not null,

  -- SKU meaning is scoped. The same SKU text can be valid in different
  -- contexts, such as a warehouse, channel, supplier, or listing.
  scope_type          text not null default 'workspace'
    check (scope_type in (
      'workspace', 'supplier', 'manufacturer', 'warehouse',
      'channel', 'listing', 'integration', 'campaign', 'import', 'manual'
    )),
  scope_id            uuid,
  scope_label         text,

  -- Explicit target columns avoid polymorphic FK ambiguity.
  product_identity_id uuid references public.product_identities(id) on delete cascade,
  trade_unit_id       uuid references public.trade_units(id) on delete cascade,
  product_id          uuid references public.products(id) on delete cascade,
  variant_id          uuid references public.product_variants(id) on delete cascade,

  assignment_kind     text not null default 'internal'
    check (assignment_kind in ('internal', 'seller', 'warehouse', 'supplier', 'channel', 'display', 'other')),

  is_primary          boolean not null default false,
  is_active           boolean not null default true,
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  check (
    product_identity_id is not null
    or trade_unit_id is not null
    or product_id is not null
    or variant_id is not null
  )
);

create index if not exists idx_sku_assignments_workspace
  on public.sku_assignments(workspace_id);

create index if not exists idx_sku_assignments_identity
  on public.sku_assignments(product_identity_id)
  where product_identity_id is not null;

create index if not exists idx_sku_assignments_trade_unit
  on public.sku_assignments(trade_unit_id)
  where trade_unit_id is not null;

create index if not exists idx_sku_assignments_product
  on public.sku_assignments(product_id)
  where product_id is not null;

create unique index if not exists idx_sku_assignments_unique_in_scope
  on public.sku_assignments(
    workspace_id,
    scope_type,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(sku)
  )
  where is_active = true;

create unique index if not exists idx_sku_assignments_one_primary_per_trade_unit_scope
  on public.sku_assignments(
    trade_unit_id,
    scope_type,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where is_primary = true and is_active = true and trade_unit_id is not null;

alter table public.sku_assignments enable row level security;

create policy "Members can view SKU assignments"
  on public.sku_assignments for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage SKU assignments"
  on public.sku_assignments for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.sku_assignments
  for each row execute function public.update_updated_at();
