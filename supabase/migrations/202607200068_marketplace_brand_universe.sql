-- ============================================================
-- 068 — Marketplace brand universe (weekly brand radar)
--
-- Competitive brand list for Shopee (and later) portfolio collect.
-- Separate from catalog public.brands (SKU organization).
-- Import from sample-brands.csv; default pilot_tier=paused (no auto crawl).
--
-- Run AFTER: 047_marketplace_intelligence.sql
-- Design: docs/WEEKLY_MARKETPLACE_INTELLIGENCE_DESIGN.md
-- ============================================================

create table if not exists public.marketplace_brand_universe (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  brand_key             text not null,
  display_name          text not null,
  categories            text[] not null default '{}',
  origin_country        text,
  official_interest     boolean,
  shopee_mall_interest  boolean not null default false,
  iherb_interest        boolean not null default false,
  followers_note        text,

  marketplace           text not null default 'shopee'
    check (marketplace in ('shopee', 'lazada', 'tiktok', 'other')),
  country               text not null default 'sg'
    check (country ~ '^[a-z]{2}$'),
  pilot_tier            text not null default 'paused'
    check (pilot_tier in ('pilot', 'mid', 'full', 'paused')),
  enabled               boolean not null default true,
  priority              integer not null default 100,

  primary_seed_id       uuid references public.marketplace_crawl_seeds(id) on delete set null,
  metadata              jsonb not null default '{}',
  source                text not null default 'sample-brands.csv',
  imported_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, marketplace, country, brand_key)
);

create index if not exists idx_marketplace_brand_universe_workspace
  on public.marketplace_brand_universe(workspace_id, marketplace, country);

create index if not exists idx_marketplace_brand_universe_tier
  on public.marketplace_brand_universe(workspace_id, pilot_tier)
  where enabled = true;

create index if not exists idx_marketplace_brand_universe_seed
  on public.marketplace_brand_universe(primary_seed_id)
  where primary_seed_id is not null;

alter table public.marketplace_brand_universe enable row level security;

drop policy if exists "Members can view marketplace brand universe"
  on public.marketplace_brand_universe;
create policy "Members can view marketplace brand universe"
  on public.marketplace_brand_universe for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage marketplace brand universe"
  on public.marketplace_brand_universe;
create policy "Members can manage marketplace brand universe"
  on public.marketplace_brand_universe for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.marketplace_brand_universe
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.marketplace_brand_universe;
create trigger set_updated_at before update on public.marketplace_brand_universe
  for each row execute function public.update_updated_at();
