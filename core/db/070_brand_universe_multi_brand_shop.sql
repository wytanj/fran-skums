-- ============================================================
-- 070 — Multi-brand distributor Mall shops (MH-7)
--
-- Official SG Mall often uses group/distributor storefronts that
-- host multiple brands under one shop_username.
--
-- shop_kind:
--   single_brand (default) — 1:1 brand ↔ shop harvest stamp
--   multi_brand_distributor — shared shop; per-SKU brand attribution
--
-- Allowlist of brand_keys stored in metadata.distributor_brand_keys
-- (and mirrored on every brand row linked to that shop).
--
-- Run AFTER: 069_brand_universe_shop_identity.sql
-- ============================================================

alter table public.marketplace_brand_universe
  add column if not exists shop_kind text not null default 'single_brand';

-- Drop default constraint if re-run; enforce allowed values
alter table public.marketplace_brand_universe
  drop constraint if exists marketplace_brand_universe_shop_kind_check;

alter table public.marketplace_brand_universe
  add constraint marketplace_brand_universe_shop_kind_check
  check (shop_kind in ('single_brand', 'multi_brand_distributor'));

create index if not exists idx_marketplace_brand_universe_shop_kind
  on public.marketplace_brand_universe(workspace_id, shop_kind)
  where shop_kind = 'multi_brand_distributor';

comment on column public.marketplace_brand_universe.shop_kind is
  'single_brand = official mono-brand Mall; multi_brand_distributor = group/distributor shop hosting multiple brands. See metadata.distributor_brand_keys.';
