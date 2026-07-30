-- 077 — Track RP-4: aggregate the Shopee Mall harvest in SQL.
--
-- Why a function rather than a view or client-side reduce:
--   * PostgREST cannot express GROUP BY, so without this the only options are
--     shipping every row to the client and folding it in JS (what
--     queryBrandSummary did — 1,200 rows over the wire to produce ~3KB) or
--     a fixed view per grouping.
--   * Marketers' questions are overwhelmingly aggregate. Serving them as rows
--     forces the LLM to do arithmetic it is measurably bad at, costs 22k+
--     tokens per call, and is not reproducible run to run.
--   * Aggregating here makes payload and latency roughly constant as the
--     harvest grows — the property that lets this scale to 84 brands and a
--     year of weekly snapshots.
--
-- Reads v_marketplace_listing_latest (mig 076) so every group counts each
-- listing once, not once per observation.
--
-- Metric expressions mirror marketplace/metrics/definitions.mjs (RP-6).
-- Keep the two in sync — that module is what the agent cites.
--
-- p_group_by is validated against a fixed allowlist and mapped with a CASE,
-- so there is no dynamic SQL and no injection surface.

create or replace function public.marketplace_brand_rollup(
  p_workspace_id  uuid,
  p_group_by      text,
  p_brand_keys    text[] default null,
  p_shop_username text   default null,
  p_shelf         text   default null,
  p_leaf          text   default null,
  p_min_sold      bigint default null,
  p_seller_type   text   default null,
  p_since         timestamptz default null,
  p_until         timestamptz default null,
  p_limit         integer default 50
)
returns table (
  group_key           text,
  sku_count           bigint,
  sold_sum            bigint,
  sold_max            bigint,
  sold_avg            bigint,
  price_p50           numeric,
  with_platform_path  bigint,
  top_title           text,
  top_sold            bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select
      v.*,
      case p_group_by
        when 'brand'         then v.brand_key
        when 'shelf'         then v.shop_collection_name
        when 'platform_leaf' then v.platform_category_leaf
        when 'shop'          then v.shop_username
      end                                              as grp,
      l.title                                          as listing_title
    from public.v_marketplace_listing_latest v
    left join public.marketplace_listings l on l.id = v.listing_id
    where v.workspace_id = p_workspace_id
      and (p_brand_keys    is null or v.brand_key = any (p_brand_keys))
      and (p_shop_username is null or v.shop_username = p_shop_username)
      and (p_shelf         is null or v.shop_collection_name ilike '%' || p_shelf || '%')
      and (p_leaf          is null or v.platform_category_leaf ilike '%' || p_leaf || '%')
      and (p_min_sold      is null or v.sold_count_lower_bound >= p_min_sold)
      and (p_seller_type   is null or v.seller_type = p_seller_type)
      and (p_since         is null or v.crawled_at >= p_since)
      and (p_until         is null or v.crawled_at <= p_until)
  ),
  ranked as (
    -- Top listing per group, for a named example the agent can quote.
    select distinct on (grp)
      grp, listing_title, sold_count_lower_bound
    from scoped
    order by grp, sold_count_lower_bound desc nulls last
  )
  select
    coalesce(s.grp, '(unattributed)')                            as group_key,
    count(*)                                                     as sku_count,
    sum(coalesce(s.sold_count_lower_bound, 0))::bigint           as sold_sum,
    max(s.sold_count_lower_bound)::bigint                        as sold_max,
    round(avg(coalesce(s.sold_count_lower_bound, 0)))::bigint    as sold_avg,
    percentile_cont(0.5) within group (order by s.price)         as price_p50,
    count(*) filter (where s.platform_category_leaf is not null) as with_platform_path,
    max(r.listing_title)                                         as top_title,
    max(r.sold_count_lower_bound)::bigint                        as top_sold
  from scoped s
  left join ranked r on r.grp is not distinct from s.grp
  group by s.grp
  order by sold_sum desc, sku_count desc
  limit greatest(least(coalesce(p_limit, 50), 200), 1);
$$;

comment on function public.marketplace_brand_rollup is
  'RP-4: grouped Shopee Mall harvest aggregates over v_marketplace_listing_latest. Metric expressions mirror marketplace/metrics/definitions.mjs. security invoker so RLS on the base table still applies.';

-- Companion: exact group count, so the tool can say whether `limit` truncated
-- the grouping. Same honest-truncation rule as RP-1.
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
  select count(distinct case p_group_by
      when 'brand'         then v.brand_key
      when 'shelf'         then v.shop_collection_name
      when 'platform_leaf' then v.platform_category_leaf
      when 'shop'          then v.shop_username
    end)
  from public.v_marketplace_listing_latest v
  where v.workspace_id = p_workspace_id
    and (p_brand_keys    is null or v.brand_key = any (p_brand_keys))
    and (p_shop_username is null or v.shop_username = p_shop_username)
    and (p_shelf         is null or v.shop_collection_name ilike '%' || p_shelf || '%')
    and (p_leaf          is null or v.platform_category_leaf ilike '%' || p_leaf || '%')
    and (p_min_sold      is null or v.sold_count_lower_bound >= p_min_sold)
    and (p_seller_type   is null or v.seller_type = p_seller_type)
    and (p_since         is null or v.crawled_at >= p_since)
    and (p_until         is null or v.crawled_at <= p_until);
$$;

grant execute on function public.marketplace_brand_rollup to authenticated, service_role;
grant execute on function public.marketplace_brand_rollup_count to authenticated, service_role;
