-- 076 — Track RP: make the Shopee Mall read path filterable in SQL.
--
-- Problem this fixes (measured 2026-07-28 on 6,827 snapshots):
--   market_brand_listings { min_sold: 1000 } returned 176 rows.
--   Ground truth: 910 distinct listings match. 668 were invisible, and the
--   response reported itself as complete.
--
-- Cause: brand_key / shop_username / shop_collection_name /
-- platform_category_leaf live only inside `signals` jsonb with no index, so the
-- query fetched a recency window (default 800 rows) and filtered in JavaScript
-- afterwards. Any filter that wasn't brand_key/seller_type/since/until was
-- therefore evaluated against ~12% of the table — a share that shrinks every
-- week the harvest runs.
--
-- Approach: promote the hot filter dimensions to real columns.
-- `signals` stays the source of truth; these are derived, populated on write
-- by marketplace/writers/upsertObservations.mjs and backfilled by
-- scripts/backfill-snapshot-dimensions.mjs.
--
-- Why real columns rather than a GIN index on signals:
--   * min_sold is a numeric RANGE filter — jsonb containment cannot range-scan.
--   * brand_key / shelf / leaf are equality — btree composite is cheaper than GIN.
--   * Only a real column lets Postgres satisfy
--     `order by sold_count_lower_bound desc limit n` from the index
--     instead of sorting the matched set.

alter table public.marketplace_listing_snapshots
  add column if not exists brand_key              text,
  add column if not exists shop_username          text,
  add column if not exists shop_collection_name   text,
  add column if not exists platform_category_leaf text;

comment on column public.marketplace_listing_snapshots.brand_key is
  'Derived from signals->>brand_key. Denormalised for indexed filtering (Track RP).';
comment on column public.marketplace_listing_snapshots.shop_username is
  'Derived from signals->>shop_username.';
comment on column public.marketplace_listing_snapshots.shop_collection_name is
  'Derived from signals->>shop_collection_name (seller marketing shelf, taxonomy A).';
comment on column public.marketplace_listing_snapshots.platform_category_leaf is
  'Derived from signals->>platform_category_leaf (Shopee platform taxonomy B, MH-4).';

-- Primary access pattern: "top sellers for brand X", which is
-- filter by workspace+brand then ORDER BY sold DESC LIMIT n.
-- Descending sold in the index means no sort node.
create index if not exists idx_mls_workspace_brand_sold
  on public.marketplace_listing_snapshots
     (workspace_id, brand_key, sold_count_lower_bound desc nulls last);

-- Bare sold ranking across all brands (min_sold with no brand filter).
create index if not exists idx_mls_workspace_sold
  on public.marketplace_listing_snapshots
     (workspace_id, sold_count_lower_bound desc nulls last);

-- Taxonomy slices. Partial: most snapshots have no platform leaf until MH-4
-- enrichment runs, so indexing the nulls would be dead weight.
create index if not exists idx_mls_workspace_leaf
  on public.marketplace_listing_snapshots (workspace_id, platform_category_leaf)
  where platform_category_leaf is not null;

create index if not exists idx_mls_workspace_shelf
  on public.marketplace_listing_snapshots (workspace_id, shop_collection_name)
  where shop_collection_name is not null;

create index if not exists idx_mls_workspace_shop
  on public.marketplace_listing_snapshots (workspace_id, shop_username)
  where shop_username is not null;

-- ---------------------------------------------------------------------------
-- BR-A3 — latest observation per listing.
--
-- Every consumer wants one row per listing, not one row per observation. That
-- dedupe currently happens in JS (dedupeSnapshotsByListing) *after* pulling a
-- capped window, which is the structural reason the window exists at all.
--
-- Tie-break order matches the JS it replaces: prefer the higher sold figure,
-- then the newer crawl. Shopee's sold counter is cumulative, so "highest sold"
-- is normally also "most recent" — but a relisted item can reset, and
-- preferring the higher value keeps the peak observation rather than the reset.
--
-- Plain view, not materialized: the table is small and a matview would add
-- refresh scheduling for no measured gain. Revisit only if latency shows up.
-- ---------------------------------------------------------------------------
create or replace view public.v_marketplace_listing_latest as
select distinct on (s.listing_id)
  s.id,
  s.workspace_id,
  s.listing_id,
  s.crawled_at,
  s.price,
  s.original_price,
  s.currency,
  s.rating,
  s.review_count,
  s.sold_label,
  s.sold_count_lower_bound,
  s.seller_type,
  s.search_query,
  s.rank_position,
  s.signals,
  s.brand_key,
  s.shop_username,
  s.shop_collection_name,
  s.platform_category_leaf
from public.marketplace_listing_snapshots s
order by s.listing_id,
         s.sold_count_lower_bound desc nulls last,
         s.crawled_at desc;

comment on view public.v_marketplace_listing_latest is
  'BR-A3 / Track RP: one row per listing (highest sold, then newest crawl). Replaces the JS dedupe in brandListingsQuery so filters and LIMIT can run in SQL.';

-- Views inherit RLS from the underlying table when created by a non-superuser
-- owner, but be explicit about who may read it.
revoke all on public.v_marketplace_listing_latest from anon;
grant select on public.v_marketplace_listing_latest to authenticated, service_role;
