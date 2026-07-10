-- ============================================================
-- SKUMS — Marketplace intelligence (collect / BI facts)
--
-- Purpose:
--   Always-on competitive observation warehouse for public marketplaces
--   (Shopee first). Seeds schedule daily/weekly product pulls; listings
--   and snapshots store identity + time-series observations.
--
-- Run AFTER: 046_loyalty_pricing_inventory.sql
-- Related: Major Update.md Phase 0–2
-- ============================================================

-- ── Seeds (what we watch forever) ────────────────────────────

create table if not exists public.marketplace_crawl_seeds (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  marketplace           text not null default 'shopee'
    check (marketplace in ('shopee', 'lazada', 'tiktok', 'other')),
  country               text not null default 'sg'
    check (country ~ '^[a-z]{2}$'),
  mode                  text not null default 'keyword'
    check (mode in ('keyword', 'shop', 'listing', 'brand_portfolio')),
  target                text not null,

  enabled               boolean not null default true,
  schedule_kind         text not null default 'daily'
    check (schedule_kind in ('daily', 'weekly', 'cron', 'manual_only')),
  schedule_cron         text,
  timezone              text not null default 'Asia/Singapore',
  preferred_hour        integer not null default 2
    check (preferred_hour >= 0 and preferred_hour <= 23),
  weekly_day            integer
    check (weekly_day is null or (weekly_day >= 0 and weekly_day <= 6)),

  max_pages             integer not null default 3
    check (max_pages > 0 and max_pages <= 50),
  max_listings          integer not null default 60
    check (max_listings > 0 and max_listings <= 500),
  detail_top_n          integer not null default 15
    check (detail_top_n >= 0 and detail_top_n <= 100),

  priority              integer not null default 100,
  collector_id          text not null default 'mock'
    check (collector_id ~ '^[a-z0-9][a-z0-9_-]*$'),

  last_enqueued_at      timestamptz,
  last_success_at       timestamptz,
  last_error            text,
  next_run_at           timestamptz,
  consecutive_failures  integer not null default 0,

  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, marketplace, country, mode, target)
);

create index if not exists idx_marketplace_crawl_seeds_due
  on public.marketplace_crawl_seeds(enabled, next_run_at)
  where enabled = true and schedule_kind <> 'manual_only';

create index if not exists idx_marketplace_crawl_seeds_workspace
  on public.marketplace_crawl_seeds(workspace_id, marketplace, country);

alter table public.marketplace_crawl_seeds enable row level security;

drop policy if exists "Members can view marketplace crawl seeds"
  on public.marketplace_crawl_seeds;
create policy "Members can view marketplace crawl seeds"
  on public.marketplace_crawl_seeds for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage marketplace crawl seeds"
  on public.marketplace_crawl_seeds;
create policy "Members can manage marketplace crawl seeds"
  on public.marketplace_crawl_seeds for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.marketplace_crawl_seeds
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.marketplace_crawl_seeds;
create trigger set_updated_at before update on public.marketplace_crawl_seeds
  for each row execute function public.update_updated_at();


-- ── Crawl jobs ───────────────────────────────────────────────

create table if not exists public.marketplace_crawl_jobs (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  seed_id               uuid references public.marketplace_crawl_seeds(id) on delete set null,

  marketplace           text not null default 'shopee',
  country               text not null default 'sg',
  crawl_type            text not null default 'keyword'
    check (crawl_type in ('keyword', 'shop', 'listing', 'brand_portfolio', 'manual')),
  target                text not null,

  status                text not null default 'pending'
    check (status in ('pending', 'claimed', 'running', 'completed', 'failed', 'cancelled')),
  priority              integer not null default 100,
  collector_id          text not null default 'mock',

  scheduled_for         timestamptz not null default now(),
  claimed_at            timestamptz,
  claimed_by            text,
  started_at            timestamptz,
  completed_at          timestamptz,

  total_targets         integer not null default 0,
  processed_targets     integer not null default 0,
  failed_targets        integer not null default 0,
  summary               jsonb not null default '{}',
  error                 text,
  metadata              jsonb not null default '{}',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_marketplace_crawl_jobs_pending
  on public.marketplace_crawl_jobs(status, priority desc, scheduled_for)
  where status in ('pending', 'claimed');

create index if not exists idx_marketplace_crawl_jobs_workspace
  on public.marketplace_crawl_jobs(workspace_id, created_at desc);

create index if not exists idx_marketplace_crawl_jobs_seed
  on public.marketplace_crawl_jobs(seed_id, created_at desc)
  where seed_id is not null;

alter table public.marketplace_crawl_jobs enable row level security;

drop policy if exists "Members can view marketplace crawl jobs"
  on public.marketplace_crawl_jobs;
create policy "Members can view marketplace crawl jobs"
  on public.marketplace_crawl_jobs for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage marketplace crawl jobs"
  on public.marketplace_crawl_jobs;
create policy "Members can manage marketplace crawl jobs"
  on public.marketplace_crawl_jobs for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.marketplace_crawl_jobs
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.marketplace_crawl_jobs;
create trigger set_updated_at before update on public.marketplace_crawl_jobs
  for each row execute function public.update_updated_at();


-- ── Shops ────────────────────────────────────────────────────

create table if not exists public.marketplace_shops (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  marketplace           text not null default 'shopee',
  country               text not null default 'sg',
  shop_id               text not null,
  shop_name             text,
  seller_type           text not null default 'unknown'
    check (seller_type in (
      'mall', 'preferred_plus', 'preferred', 'official_brand', 'normal', 'unknown'
    )),
  is_official_seed      boolean not null default false,
  shop_url              text,
  raw_identity          jsonb not null default '{}',
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, marketplace, country, shop_id)
);

create index if not exists idx_marketplace_shops_workspace
  on public.marketplace_shops(workspace_id, marketplace, country);

alter table public.marketplace_shops enable row level security;

drop policy if exists "Members can view marketplace shops"
  on public.marketplace_shops;
create policy "Members can view marketplace shops"
  on public.marketplace_shops for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage marketplace shops"
  on public.marketplace_shops;
create policy "Members can manage marketplace shops"
  on public.marketplace_shops for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.marketplace_shops
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.marketplace_shops;
create trigger set_updated_at before update on public.marketplace_shops
  for each row execute function public.update_updated_at();


-- ── Listings (stable identity) ───────────────────────────────

create table if not exists public.marketplace_listings (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  marketplace           text not null default 'shopee',
  country               text not null default 'sg',
  shop_id               text not null,
  item_id               text not null,
  listing_url           text,
  title                 text,
  shop_name             text,
  seller_type           text not null default 'unknown'
    check (seller_type in (
      'mall', 'preferred_plus', 'preferred', 'official_brand', 'normal', 'unknown'
    )),
  brand_name_raw        text,
  category_path         text,
  image_url             text,
  status                text not null default 'active'
    check (status in ('active', 'inactive', 'unknown')),
  marketplace_shop_row_id uuid references public.marketplace_shops(id) on delete set null,
  raw_identity          jsonb not null default '{}',
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, marketplace, country, shop_id, item_id)
);

create index if not exists idx_marketplace_listings_workspace
  on public.marketplace_listings(workspace_id, marketplace, country);

create index if not exists idx_marketplace_listings_seller_type
  on public.marketplace_listings(workspace_id, seller_type, last_seen_at desc);

create index if not exists idx_marketplace_listings_title
  on public.marketplace_listings using gin (to_tsvector('simple', coalesce(title, '')));

alter table public.marketplace_listings enable row level security;

drop policy if exists "Members can view marketplace listings"
  on public.marketplace_listings;
create policy "Members can view marketplace listings"
  on public.marketplace_listings for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage marketplace listings"
  on public.marketplace_listings;
create policy "Members can manage marketplace listings"
  on public.marketplace_listings for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.marketplace_listings
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.marketplace_listings;
create trigger set_updated_at before update on public.marketplace_listings
  for each row execute function public.update_updated_at();


-- ── Snapshots (time-series observations) ─────────────────────

create table if not exists public.marketplace_listing_snapshots (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  listing_id            uuid not null references public.marketplace_listings(id) on delete cascade,
  crawl_job_id          uuid references public.marketplace_crawl_jobs(id) on delete set null,

  crawled_at            timestamptz not null default now(),
  price                 numeric(14, 4),
  original_price        numeric(14, 4),
  currency              text not null default 'SGD',
  price_sgd             numeric(14, 4),
  rating                numeric(4, 2),
  review_count          integer,
  sold_label            text,
  sold_count_lower_bound integer,
  favourite_count       integer,
  available_quantity    integer,
  availability          text not null default 'unknown'
    check (availability in ('in_stock', 'out_of_stock', 'unknown')),
  rank_position         integer,
  search_query          text,
  category_id           text,
  voucher_labels        text[] not null default '{}',
  shipping_labels       text[] not null default '{}',
  preorder_days         integer,
  seller_type           text,
  signals               jsonb not null default '{}',
  raw_observation       jsonb not null default '{}',
  created_at            timestamptz not null default now()
);

create index if not exists idx_marketplace_listing_snapshots_listing
  on public.marketplace_listing_snapshots(listing_id, crawled_at desc);

create index if not exists idx_marketplace_listing_snapshots_workspace
  on public.marketplace_listing_snapshots(workspace_id, crawled_at desc);

create index if not exists idx_marketplace_listing_snapshots_job
  on public.marketplace_listing_snapshots(crawl_job_id)
  where crawl_job_id is not null;

create index if not exists idx_marketplace_listing_snapshots_query
  on public.marketplace_listing_snapshots(workspace_id, search_query, crawled_at desc)
  where search_query is not null;

alter table public.marketplace_listing_snapshots enable row level security;

drop policy if exists "Members can view marketplace listing snapshots"
  on public.marketplace_listing_snapshots;
create policy "Members can view marketplace listing snapshots"
  on public.marketplace_listing_snapshots for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage marketplace listing snapshots"
  on public.marketplace_listing_snapshots;
create policy "Members can manage marketplace listing snapshots"
  on public.marketplace_listing_snapshots for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.marketplace_listing_snapshots
  to authenticated, service_role;


-- ── Daily metrics (pre-aggregates for BI) ────────────────────

create table if not exists public.marketplace_metrics_daily (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  metric_date           date not null,
  marketplace           text not null default 'shopee',
  country               text not null default 'sg',
  dimension_type        text not null default 'seed'
    check (dimension_type in ('seed', 'query', 'brand', 'shop', 'workspace')),
  dimension_key         text not null,
  metrics               jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, metric_date, marketplace, country, dimension_type, dimension_key)
);

create index if not exists idx_marketplace_metrics_daily_workspace
  on public.marketplace_metrics_daily(workspace_id, metric_date desc);

alter table public.marketplace_metrics_daily enable row level security;

drop policy if exists "Members can view marketplace metrics daily"
  on public.marketplace_metrics_daily;
create policy "Members can view marketplace metrics daily"
  on public.marketplace_metrics_daily for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage marketplace metrics daily"
  on public.marketplace_metrics_daily;
create policy "Members can manage marketplace metrics daily"
  on public.marketplace_metrics_daily for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.marketplace_metrics_daily
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.marketplace_metrics_daily;
create trigger set_updated_at before update on public.marketplace_metrics_daily
  for each row execute function public.update_updated_at();


-- ── BI digests / alerts (Grok-enriched later) ────────────────

create table if not exists public.bi_digests (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  marketplace           text not null default 'shopee',
  country               text,
  period_start          timestamptz not null,
  period_end            timestamptz not null,
  digest_kind           text not null default 'daily'
    check (digest_kind in ('daily', 'weekly', 'ad_hoc')),
  title                 text not null,
  body_markdown         text,
  grounded              jsonb not null default '{}',
  evidence_refs         text[] not null default '{}',
  model_id              text,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now()
);

create index if not exists idx_bi_digests_workspace
  on public.bi_digests(workspace_id, created_at desc);

alter table public.bi_digests enable row level security;

drop policy if exists "Members can view bi digests"
  on public.bi_digests;
create policy "Members can view bi digests"
  on public.bi_digests for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage bi digests"
  on public.bi_digests;
create policy "Members can manage bi digests"
  on public.bi_digests for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.bi_digests
  to authenticated, service_role;


create table if not exists public.bi_alerts (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  alert_type            text not null,
  severity              text not null default 'medium'
    check (severity in ('low', 'medium', 'high', 'critical')),
  status                text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),
  title                 text not null,
  summary               text,
  evidence_refs         text[] not null default '{}',
  payload               jsonb not null default '{}',
  seed_id               uuid references public.marketplace_crawl_seeds(id) on delete set null,
  listing_id            uuid references public.marketplace_listings(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  resolved_at           timestamptz
);

create index if not exists idx_bi_alerts_workspace_status
  on public.bi_alerts(workspace_id, status, created_at desc);

alter table public.bi_alerts enable row level security;

drop policy if exists "Members can view bi alerts"
  on public.bi_alerts;
create policy "Members can view bi alerts"
  on public.bi_alerts for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage bi alerts"
  on public.bi_alerts;
create policy "Members can manage bi alerts"
  on public.bi_alerts for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.bi_alerts
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.bi_alerts;
create trigger set_updated_at before update on public.bi_alerts
  for each row execute function public.update_updated_at();
