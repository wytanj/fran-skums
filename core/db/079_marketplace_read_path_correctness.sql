-- 079 — marketplace read-path correctness follow-up.
--
-- Migration 078 fingerprints max(crawled_at) + row count. That detects normal
-- harvest inserts and deletes, but not in-place repairs/backfills such as:
--   * backfill-snapshot-dimensions.mjs
--   * fix-implausible-sold.mjs
-- Those updates can materially change a rollup while leaving both original
-- fingerprint inputs unchanged, allowing a stale cache entry to live forever.

alter table public.marketplace_listing_snapshots
  add column if not exists cache_changed_at timestamptz not null default clock_timestamp();

comment on column public.marketplace_listing_snapshots.cache_changed_at is
  'Changes on every snapshot update so marketplace_data_version invalidates aggregate caches after repairs and backfills.';

create or replace function public.touch_marketplace_snapshot_cache_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.cache_changed_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists trg_marketplace_snapshot_cache_version
  on public.marketplace_listing_snapshots;
create trigger trg_marketplace_snapshot_cache_version
before update on public.marketplace_listing_snapshots
for each row execute function public.touch_marketplace_snapshot_cache_version();

revoke all on function public.touch_marketplace_snapshot_cache_version() from public;

create or replace function public.marketplace_data_version(p_workspace_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    to_char(
      max(greatest(crawled_at, cache_changed_at)),
      'YYYYMMDDHH24MISS.US'
    ) || '-' || count(*)::text,
    'empty'
  )
  from public.marketplace_listing_snapshots
  where workspace_id = p_workspace_id;
$$;

grant execute on function public.marketplace_data_version to authenticated, service_role;

-- Migration 077's group-count companion used count(distinct dimension), which
-- excludes NULL. The rollup itself exposes that NULL bucket as "(unattributed)",
-- so limited responses could undercount total_groups and falsely claim
-- complete=true. Replace the applied function without changing migration 077's
-- checksum.
create or replace function public.marketplace_brand_rollup_count(
  p_workspace_id  uuid,
  p_group_by      text,
  p_brand_keys    text[] default null,
  p_shop_username text   default null,
  p_shelf         text   default null,
  p_leaf          text   default null,
  p_min_sold      bigint default null,
  p_seller_type   text   default null,
  p_since         timestamptz default null,
  p_until         timestamptz default null
)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select case p_group_by
      when 'brand'         then v.brand_key
      when 'shelf'         then v.shop_collection_name
      when 'platform_leaf' then v.platform_category_leaf
      when 'shop'          then v.shop_username
    end as grp
    from public.v_marketplace_listing_latest v
    where v.workspace_id = p_workspace_id
      and (p_brand_keys    is null or v.brand_key = any (p_brand_keys))
      and (p_shop_username is null or v.shop_username = p_shop_username)
      and (p_shelf         is null or v.shop_collection_name ilike '%' || p_shelf || '%')
      and (p_leaf          is null or v.platform_category_leaf ilike '%' || p_leaf || '%')
      and (p_min_sold      is null or v.sold_count_lower_bound >= p_min_sold)
      and (p_seller_type   is null or v.seller_type = p_seller_type)
      and (p_since         is null or v.crawled_at >= p_since)
      and (p_until         is null or v.crawled_at <= p_until)
  )
  select
    count(distinct grp)
    + case when bool_or(grp is null) then 1 else 0 end
  from scoped;
$$;

grant execute on function public.marketplace_brand_rollup_count
  to authenticated, service_role;
