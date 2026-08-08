-- ============================================================
-- SKUMS — iHerb catalogue warehouse (separate from Shopee)
--
-- Why separate tables: marketplace_brand_rollup / v_marketplace_listing_latest
-- filter on nothing for marketplace. iHerb rows in marketplace_listings would
-- silently rewrite every Shopee rollup. See docs/IHERB_HANDOFF.md.
--
-- Run AFTER: 085_invite_unique_pending_only.sql
-- Apply: node scripts/migrate.mjs --only 086
-- ============================================================

-- ── Stable product identity ──────────────────────────────────

create table if not exists public.iherb_products (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  country               text not null default 'sg'
    check (country ~ '^[a-z]{2}$'),
  part_number           text not null,
  product_id            text,
  gtin                  text,
  name                  text,
  brand_key             text,
  brand_name            text,
  brand_id              text,
  url                   text,
  category_path_text    text,
  category_leaf         text,
  weight_value          numeric(14, 4),
  weight_unit           text,

  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, country, part_number)
);

create index if not exists idx_iherb_products_workspace_brand
  on public.iherb_products (workspace_id, brand_key);

create index if not exists idx_iherb_products_product_id
  on public.iherb_products (workspace_id, product_id)
  where product_id is not null;

create index if not exists idx_iherb_products_gtin
  on public.iherb_products (workspace_id, gtin)
  where gtin is not null;

alter table public.iherb_products enable row level security;

drop policy if exists "Members can view iherb products"
  on public.iherb_products;
create policy "Members can view iherb products"
  on public.iherb_products for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage iherb products"
  on public.iherb_products;
create policy "Members can manage iherb products"
  on public.iherb_products for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.iherb_products
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.iherb_products;
create trigger set_updated_at before update on public.iherb_products
  for each row execute function public.update_updated_at();


-- ── Time-series observations ─────────────────────────────────

create table if not exists public.iherb_product_snapshots (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  product_row_id        uuid not null references public.iherb_products(id) on delete cascade,

  captured_at           timestamptz not null default now(),
  price                 numeric(14, 4),
  list_price            numeric(14, 4),
  discount_pct          numeric(8, 2),
  currency              text not null default 'SGD',
  rating                numeric(4, 2),
  review_count          integer,
  sold_label            text,
  sold_lower_bound      integer,
  sold_is_bucket        boolean,
  -- 'month' = iHerb "sold in 30 days" rate; never compare to Shopee lifetime.
  sold_period           text,
  in_stock              boolean,
  is_sponsored          boolean not null default false,
  position              integer,
  signals               jsonb not null default '{}',
  created_at            timestamptz not null default now()
);

create index if not exists idx_iherb_product_snapshots_product
  on public.iherb_product_snapshots (product_row_id, captured_at desc);

create index if not exists idx_iherb_product_snapshots_workspace
  on public.iherb_product_snapshots (workspace_id, captured_at desc);

create index if not exists idx_iherb_product_snapshots_brand_via_signals
  on public.iherb_product_snapshots using gin (signals);

alter table public.iherb_product_snapshots enable row level security;

drop policy if exists "Members can view iherb product snapshots"
  on public.iherb_product_snapshots;
create policy "Members can view iherb product snapshots"
  on public.iherb_product_snapshots for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage iherb product snapshots"
  on public.iherb_product_snapshots;
create policy "Members can manage iherb product snapshots"
  on public.iherb_product_snapshots for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.iherb_product_snapshots
  to authenticated, service_role;

comment on table public.iherb_products is
  'iHerb catalogue identity. Separate from marketplace_listings so Shopee rollups stay clean.';
comment on table public.iherb_product_snapshots is
  'iHerb price/rating/sold-rate time series. sold_period=month is a 30-day rate, not lifetime.';
comment on column public.iherb_product_snapshots.sold_period is
  'month = sold in 30 days (rate). Never ratio against Shopee sold_count_lower_bound.';
