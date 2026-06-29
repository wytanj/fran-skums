-- ============================================================
-- SKUMS — Product Quality & Competitive Intelligence
-- Run after schema.sql
-- ============================================================

-- ============================================================
-- 1. PRODUCT QUALITY SNAPSHOTS
--    Raw marketplace data captured per crawl per platform
-- ============================================================
create table if not exists public.product_quality_snapshots (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  product_id          uuid references public.products(id) on delete set null,
  marketplace         text not null,         -- 'shopee' | 'lazada' | 'amazon' | 'iherb'
  found               boolean not null default false,
  listing_title       text,
  external_url        text,
  external_product_id text,
  price               numeric(12,4),
  currency            text not null default 'SGD',
  rating              numeric(3,2),          -- 0.00 – 5.00
  review_count        integer,
  units_sold_label    text,                  -- e.g. "1.2k sold", "500+ bought"
  seller_name         text,
  availability        text default 'unknown',-- 'in_stock' | 'out_of_stock' | 'unknown'
  crawled_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index if not exists idx_pqs_workspace_product
  on public.product_quality_snapshots (workspace_id, product_id);
create index if not exists idx_pqs_crawled_at
  on public.product_quality_snapshots (crawled_at desc);

alter table public.product_quality_snapshots enable row level security;

create policy "Workspace members can view quality snapshots"
  on public.product_quality_snapshots for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = product_quality_snapshots.workspace_id
        and wm.user_id = auth.uid()
    )
  );

create policy "Workspace members can insert quality snapshots"
  on public.product_quality_snapshots for insert
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = product_quality_snapshots.workspace_id
        and wm.user_id = auth.uid()
    )
  );


-- ============================================================
-- 2. PRODUCT QUALITY ANALYSES
--    AI-generated composite score per product (latest only)
--    Upserted on each re-analysis via unique constraint
-- ============================================================
create table if not exists public.product_quality_analyses (
  id                   uuid primary key default uuid_generate_v4(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  product_id           uuid not null references public.products(id) on delete cascade,

  -- Composite scores (0–100)
  overall_score        numeric(4,1),
  price_score          numeric(4,1),
  review_score         numeric(4,1),
  availability_score   numeric(4,1),

  -- Competitive classification
  competitive_position text,  -- 'market_leader' | 'competitive' | 'at_risk' | 'lagging' | 'niche'
  price_position       text,  -- 'cheapest' | 'competitive' | 'premium' | 'overpriced'

  -- AI output
  ai_summary           text,
  recommendations      jsonb, -- string[]

  -- Snapshot references from this analysis run
  snapshot_ids         uuid[],
  sources_checked      text[], -- marketplaces where product was found

  analysed_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),

  -- One live analysis per product per workspace
  unique (workspace_id, product_id)
);

create index if not exists idx_pqa_workspace
  on public.product_quality_analyses (workspace_id);
create index if not exists idx_pqa_score
  on public.product_quality_analyses (workspace_id, overall_score desc);

alter table public.product_quality_analyses enable row level security;

create policy "Workspace members can view quality analyses"
  on public.product_quality_analyses for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = product_quality_analyses.workspace_id
        and wm.user_id = auth.uid()
    )
  );

create policy "Workspace members can manage quality analyses"
  on public.product_quality_analyses for all
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = product_quality_analyses.workspace_id
        and wm.user_id = auth.uid()
    )
  );


-- ============================================================
-- 3. LATEST SNAPSHOTS VIEW
--    Most recent crawl per product per marketplace
-- ============================================================
create or replace view public.v_quality_latest_snapshots as
select distinct on (workspace_id, product_id, marketplace)
  *
from public.product_quality_snapshots
order by workspace_id, product_id, marketplace, crawled_at desc;
