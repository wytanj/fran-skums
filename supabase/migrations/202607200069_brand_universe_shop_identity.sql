-- ============================================================
-- 069 — Brand universe shop identity (official Mall storefront)
--
-- Official Shopee Mall shops are storefronts like:
--   https://shopee.sg/beautyofjoseonsg
-- Keyword SERP alone is insufficient for "official portfolio".
--
-- Run AFTER: 068_marketplace_brand_universe.sql
-- ============================================================

alter table public.marketplace_brand_universe
  add column if not exists shop_username text;

alter table public.marketplace_brand_universe
  add column if not exists shop_url text;

alter table public.marketplace_brand_universe
  add column if not exists shop_id text;

alter table public.marketplace_brand_universe
  add column if not exists shop_resolve_status text not null default 'unknown'
    check (shop_resolve_status in ('unknown', 'candidate', 'confirmed', 'failed'));

alter table public.marketplace_brand_universe
  add column if not exists shop_resolve_source text
    check (
      shop_resolve_source is null
      or shop_resolve_source in ('manual', 'serp', 'heuristic', 'import')
    );

alter table public.marketplace_brand_universe
  add column if not exists shop_resolve_evidence jsonb not null default '{}';

create index if not exists idx_marketplace_brand_universe_shop_username
  on public.marketplace_brand_universe(workspace_id, shop_username)
  where shop_username is not null;

comment on column public.marketplace_brand_universe.shop_username is
  'Shopee shop path slug, e.g. beautyofjoseonsg for https://shopee.sg/beautyofjoseonsg';
comment on column public.marketplace_brand_universe.shop_resolve_status is
  'unknown=not tried; candidate=heuristic/SERP guess not verified; confirmed=ops/SERP trusted; failed=lookup failed';
