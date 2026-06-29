-- ============================================================
-- SKUMS Listings
--
-- Purpose:
--   Model channel and marketplace listings as first-class records.
--   A listing is not a product and not a SKU. It is a channel-facing
--   commercial projection of a product identity / trade unit.
--
-- Run AFTER: 025_sku_assignment_helpers.sql
-- ============================================================

-- ============================================================
-- 1. CHANNELS
-- ============================================================

create table if not exists public.channels (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,

  channel_key   text not null,
  name          text not null,
  channel_type  text not null default 'marketplace'
    check (channel_type in ('storefront', 'marketplace', 'erp', 'wms', 'retailer_portal', 'supplier_portal', 'custom')),
  vendor        text,
  market        text,
  adapter_id    text,

  is_global     boolean not null default false,
  is_active     boolean not null default true,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_channels_workspace
  on public.channels(workspace_id);

create index if not exists idx_channels_key
  on public.channels(channel_key);

create unique index if not exists idx_channels_unique_key
  on public.channels(
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    channel_key
  );

alter table public.channels enable row level security;

create policy "Anyone can view global channels"
  on public.channels for select
  using (workspace_id is null and is_global = true);

create policy "Members can view workspace channels"
  on public.channels for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Admins can manage workspace channels"
  on public.channels for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

create trigger set_updated_at before update on public.channels
  for each row execute function public.update_updated_at();


-- ============================================================
-- 2. LISTINGS
-- ============================================================

create table if not exists public.listings (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  channel_id            uuid not null references public.channels(id) on delete restrict,
  integration_connection_id uuid references public.integration_connections(id) on delete set null,

  product_identity_id   uuid not null references public.product_identities(id) on delete cascade,
  trade_unit_id         uuid references public.trade_units(id) on delete set null,
  product_id            uuid references public.products(id) on delete set null,
  variant_id            uuid references public.product_variants(id) on delete set null,

  listing_title         text,
  external_listing_id   text,
  external_variant_id   text,
  external_url          text,

  -- Channel-facing seller SKU. The durable SKU semantics live in
  -- sku_assignments with scope_type = 'listing' or 'channel'.
  seller_sku            text,

  status                text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'error', 'archived', 'deleted')),
  currency              text,
  price                 numeric(14,4),
  compare_at_price      numeric(14,4),

  last_synced_at        timestamptz,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_listings_workspace
  on public.listings(workspace_id);

create index if not exists idx_listings_channel
  on public.listings(channel_id);

create index if not exists idx_listings_identity
  on public.listings(product_identity_id);

create index if not exists idx_listings_trade_unit
  on public.listings(trade_unit_id)
  where trade_unit_id is not null;

create unique index if not exists idx_listings_external_unique
  on public.listings(
    workspace_id,
    channel_id,
    coalesce(integration_connection_id, '00000000-0000-0000-0000-000000000000'::uuid),
    external_listing_id
  )
  where external_listing_id is not null;

alter table public.listings enable row level security;

create policy "Members can view listings"
  on public.listings for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage listings"
  on public.listings for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.listings
  for each row execute function public.update_updated_at();


-- ============================================================
-- 3. LISTING IDENTIFIERS
-- ============================================================

create table if not exists public.listing_identifiers (
  id                 uuid primary key default uuid_generate_v4(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  listing_id         uuid not null references public.listings(id) on delete cascade,

  identifier_type    text not null
    check (identifier_type in (
      'external_listing_id', 'external_variant_id', 'seller_sku',
      'asin', 'shopify_product', 'shopify_variant', 'marketplace_item',
      'retailer_item', 'other'
    )),
  identifier_value   text not null,
  issuer             text,
  metadata           jsonb not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (listing_id, identifier_type, identifier_value)
);

create index if not exists idx_listing_identifiers_workspace
  on public.listing_identifiers(workspace_id);

create index if not exists idx_listing_identifiers_listing
  on public.listing_identifiers(listing_id);

alter table public.listing_identifiers enable row level security;

create policy "Members can view listing identifiers"
  on public.listing_identifiers for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage listing identifiers"
  on public.listing_identifiers for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.listing_identifiers
  for each row execute function public.update_updated_at();


-- ============================================================
-- 4. LISTING SYNC STATE
-- ============================================================

create table if not exists public.listing_sync_states (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  listing_id            uuid not null references public.listings(id) on delete cascade,
  integration_connection_id uuid references public.integration_connections(id) on delete set null,

  sync_status           text not null default 'pending'
    check (sync_status in ('pending', 'synced', 'pending_push', 'pending_pull', 'conflict', 'error', 'paused')),
  local_hash            text,
  remote_hash           text,
  last_pushed_at        timestamptz,
  last_pulled_at        timestamptz,
  last_error            text,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_listing_sync_states_workspace
  on public.listing_sync_states(workspace_id);

create index if not exists idx_listing_sync_states_listing
  on public.listing_sync_states(listing_id);

create index if not exists idx_listing_sync_states_status
  on public.listing_sync_states(workspace_id, sync_status);

create unique index if not exists idx_listing_sync_states_unique_listing_connection
  on public.listing_sync_states(
    listing_id,
    coalesce(integration_connection_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.listing_sync_states enable row level security;

create policy "Members can view listing sync states"
  on public.listing_sync_states for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage listing sync states"
  on public.listing_sync_states for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.listing_sync_states
  for each row execute function public.update_updated_at();


-- ============================================================
-- 5. GLOBAL CHANNEL SEED
-- ============================================================

insert into public.channels
  (workspace_id, channel_key, name, channel_type, vendor, market, adapter_id, is_global, metadata)
select *
from (
  values
    (null::uuid, 'shopify', 'Shopify', 'storefront', 'Shopify', null::text, 'shopify', true, '{}'::jsonb),
    (null::uuid, 'amazon', 'Amazon', 'marketplace', 'Amazon', null::text, 'amazon', true, '{}'::jsonb),
    (null::uuid, 'tiktok_shop', 'TikTok Shop', 'marketplace', 'TikTok', null::text, 'tiktok_shop', true, '{}'::jsonb),
    (null::uuid, 'shopee', 'Shopee', 'marketplace', 'Shopee', null::text, 'shopee', true, '{}'::jsonb),
    (null::uuid, 'lazada', 'Lazada', 'marketplace', 'Lazada', null::text, 'lazada', true, '{}'::jsonb),
    (null::uuid, 'custom_api', 'Custom API', 'custom', 'Custom', null::text, 'custom_api', true, '{}'::jsonb)
) as seed(workspace_id, channel_key, name, channel_type, vendor, market, adapter_id, is_global, metadata)
where not exists (
  select 1
  from public.channels c
  where c.workspace_id is null
    and c.channel_key = seed.channel_key
);
