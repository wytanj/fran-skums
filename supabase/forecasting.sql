-- ============================================================
-- SKUMS — Forecasting & Demand Planning
-- Run after schema.sql and inventory.sql
-- ============================================================

-- ============================================================
-- 1. FORECAST EVENTS (Singapore demand calendar)
--    Named demand multipliers for shopping festivals
-- ============================================================
create table if not exists public.forecast_events (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,  -- null = global
  event_name    text not null,
  date_from     date not null,
  date_to       date not null,
  multiplier    numeric(5,2) not null default 1.0,  -- e.g. 2.5 = 250% of baseline
  applies_to    text not null default 'all',         -- 'all' | category slug | brand slug
  notes         text,
  created_at    timestamptz not null default now()
);

alter table public.forecast_events enable row level security;

create policy "Workspace members can view forecast events"
  on public.forecast_events for select
  using (
    workspace_id is null  -- global events visible to all
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = forecast_events.workspace_id
        and wm.user_id = auth.uid()
    )
  );

create policy "Workspace admins can manage forecast events"
  on public.forecast_events for all
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = forecast_events.workspace_id
        and wm.user_id = auth.uid()
        and wm.role in ('owner', 'admin')
    )
  );

-- Seed global Singapore events for 2025-2026
insert into public.forecast_events (workspace_id, event_name, date_from, date_to, multiplier, applies_to, notes) values
  (null, 'Chinese New Year 2025',        '2025-01-25', '2025-02-05', 2.2, 'all', 'CNY gifting surge'),
  (null, 'Valentine''s Day 2025',        '2025-02-10', '2025-02-14', 1.6, 'all', 'Gift sets, skincare bundles'),
  (null, 'Hari Raya Aidilfitri 2025',    '2025-03-25', '2025-04-05', 1.8, 'all', 'Gifting and self-care pre-Raya'),
  (null, '9.9 Sale 2025',               '2025-09-07', '2025-09-09', 2.5, 'all', 'Shopee/Lazada mega sale'),
  (null, '10.10 Sale 2025',             '2025-10-09', '2025-10-11', 1.8, 'all', 'Mid-size platform sale'),
  (null, '11.11 Sale 2025',             '2025-11-09', '2025-11-11', 3.0, 'all', 'Biggest SG shopping day'),
  (null, '12.12 Sale 2025',             '2025-12-11', '2025-12-12', 2.2, 'all', 'Year-end clearance surge'),
  (null, 'Christmas 2025',              '2025-12-20', '2025-12-26', 1.7, 'all', 'Gift sets and holiday kits'),
  (null, 'Chinese New Year 2026',        '2026-02-07', '2026-02-18', 2.2, 'all', 'CNY gifting surge'),
  (null, 'Great Singapore Sale 2025',    '2025-06-01', '2025-07-31', 1.4, 'all', 'GSS — sustained uplift'),
  (null, 'Great Singapore Sale 2026',    '2026-06-01', '2026-07-31', 1.4, 'all', 'GSS — sustained uplift'),
  (null, 'School Holidays Jun 2025',     '2025-05-30', '2025-06-29', 1.3, 'all', 'Beach/outdoor activity boost for SPF'),
  (null, 'School Holidays Nov-Dec 2025', '2025-11-15', '2025-12-31', 1.3, 'all', 'Year-end holiday boost')
on conflict do nothing;


-- ============================================================
-- 2. SALES EVENTS
--    Manual or integration-synced sales records per product
--    (populated from inventory_ledger movement_type='sale'
--     or via CSV import / Shopify sync)
-- ============================================================
create table if not exists public.sales_events (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  product_id    uuid references public.products(id) on delete set null,
  variant_id    uuid references public.product_variants(id) on delete set null,
  quantity_sold integer not null check (quantity_sold > 0),
  sale_date     date not null,
  channel       text,          -- 'shopify', 'lazada', 'shopee', 'manual', 'pos', etc.
  unit_price    numeric(12,4),
  currency      text default 'SGD',
  order_ref     text,          -- external order ID
  source        text not null default 'manual',  -- 'manual', 'csv', 'shopify', 'woocommerce', 'api'
  created_at    timestamptz not null default now()
);

create index if not exists idx_sales_events_workspace_product on public.sales_events (workspace_id, product_id);
create index if not exists idx_sales_events_sale_date on public.sales_events (sale_date desc);
create index if not exists idx_sales_events_product_date on public.sales_events (product_id, sale_date desc);

alter table public.sales_events enable row level security;

create policy "Workspace members can view sales events"
  on public.sales_events for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = sales_events.workspace_id
        and wm.user_id = auth.uid()
    )
  );

create policy "Workspace members can insert sales events"
  on public.sales_events for insert
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = sales_events.workspace_id
        and wm.user_id = auth.uid()
    )
  );

create policy "Workspace admins can update/delete sales events"
  on public.sales_events for all
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = sales_events.workspace_id
        and wm.user_id = auth.uid()
        and wm.role in ('owner', 'admin')
    )
  );


-- ============================================================
-- 3. DEMAND VELOCITY VIEW
--    Rolling 7/14/30/90-day units sold per product
--    Uses sales_events as primary source, falls back to
--    inventory_ledger movement_type='sale'
-- ============================================================
create or replace view public.v_demand_velocity as
with combined_sales as (
  -- Source 1: sales_events table (preferred, richer data)
  select
    workspace_id,
    product_id,
    sale_date::date as sale_date,
    sum(quantity_sold) as units_sold
  from public.sales_events
  where product_id is not null
  group by workspace_id, product_id, sale_date::date

  union all

  -- Source 2: inventory_ledger movements of type 'sale'
  --   only include if product not already in sales_events for that day
  select
    il.workspace_id,
    il.product_id,
    il.created_at::date as sale_date,
    sum(abs(il.quantity_change)) as units_sold
  from public.inventory_ledger il
  where il.movement_type = 'sale'
    and il.product_id is not null
    and not exists (
      select 1 from public.sales_events se
      where se.workspace_id = il.workspace_id
        and se.product_id   = il.product_id
        and se.sale_date    = il.created_at::date
    )
  group by il.workspace_id, il.product_id, il.created_at::date
),
daily_sales as (
  select
    workspace_id,
    product_id,
    sale_date,
    sum(units_sold) as units_sold
  from combined_sales
  group by workspace_id, product_id, sale_date
),
product_velocity as (
  select
    workspace_id,
    product_id,
    count(distinct sale_date) as days_with_sales,
    min(sale_date)            as first_sale_date,
    max(sale_date)            as last_sale_date,
    -- Rolling windows
    sum(case when sale_date >= current_date - 7  then units_sold else 0 end) as units_7d,
    sum(case when sale_date >= current_date - 14 then units_sold else 0 end) as units_14d,
    sum(case when sale_date >= current_date - 30 then units_sold else 0 end) as units_30d,
    sum(case when sale_date >= current_date - 90 then units_sold else 0 end) as units_90d,
    -- Daily averages
    round(sum(case when sale_date >= current_date - 7  then units_sold else 0 end)::numeric / 7,  3) as velocity_7d,
    round(sum(case when sale_date >= current_date - 14 then units_sold else 0 end)::numeric / 14, 3) as velocity_14d,
    round(sum(case when sale_date >= current_date - 30 then units_sold else 0 end)::numeric / 30, 3) as velocity_30d,
    round(sum(case when sale_date >= current_date - 90 then units_sold else 0 end)::numeric / 90, 3) as velocity_90d
  from daily_sales
  group by workspace_id, product_id
)
select
  pv.*,
  p.title         as product_title,
  p.sku           as product_sku,
  p.status        as product_status,
  -- Best velocity estimate: prefer 30d, fall back to 90d, then 14d
  coalesce(
    nullif(pv.velocity_30d, 0),
    nullif(pv.velocity_90d, 0),
    nullif(pv.velocity_14d, 0),
    0
  ) as best_velocity
from product_velocity pv
join public.products p on p.id = pv.product_id;


-- ============================================================
-- 4. REORDER ALERTS VIEW
--    Combines demand velocity + inventory levels + PO lead times
--    to flag products needing reorder action
-- ============================================================
create or replace view public.v_reorder_alerts as
with lead_times as (
  -- Average supplier lead time from PO confirmed → received (days)
  select
    workspace_id,
    supplier_name,
    round(
      avg(
        extract(epoch from (updated_at - created_at)) / 86400.0
      )
    )::integer as avg_lead_days
  from public.purchase_orders
  where status = 'received'
    and supplier_name is not null
  group by workspace_id, supplier_name
),
workspace_default_lead as (
  select workspace_id, round(avg(avg_lead_days))::integer as default_lead_days
  from lead_times
  group by workspace_id
),
stock as (
  select
    workspace_id,
    product_id,
    sum(on_hand)  as total_on_hand,
    sum(reserved) as total_reserved,
    sum(on_order) as total_on_order,
    greatest(sum(on_hand) - sum(reserved), 0) as available_to_sell
  from public.inventory_levels
  group by workspace_id, product_id
)
select
  dv.workspace_id,
  dv.product_id,
  dv.product_title,
  dv.product_sku,
  dv.best_velocity                                         as daily_velocity,
  dv.velocity_30d,
  dv.velocity_7d,
  dv.units_30d,
  dv.units_90d,
  dv.days_with_sales,
  dv.last_sale_date,

  coalesce(s.available_to_sell, 0)                         as available_to_sell,
  coalesce(s.total_on_hand, 0)                             as total_on_hand,
  coalesce(s.total_on_order, 0)                            as total_on_order,

  -- Lead time: use workspace default (14d fallback)
  coalesce(wdl.default_lead_days, 14)                      as lead_time_days,

  -- Days of stock remaining (DSR)
  case
    when dv.best_velocity > 0
    then round(coalesce(s.available_to_sell, 0) / dv.best_velocity)::integer
    else null  -- no velocity data, cannot compute
  end as days_of_stock_remaining,

  -- Reorder point: velocity × lead_time + safety stock (1.65 × stddev approx as 50% buffer)
  case
    when dv.best_velocity > 0
    then round(
      dv.best_velocity * coalesce(wdl.default_lead_days, 14) * 1.5
    )::integer
    else null
  end as reorder_point,

  -- Alert level
  case
    when dv.best_velocity = 0 or dv.best_velocity is null then 'no_data'
    when coalesce(s.available_to_sell, 0) = 0             then 'stockout'
    when round(coalesce(s.available_to_sell, 0) / dv.best_velocity)::integer <= 7  then 'critical'
    when round(coalesce(s.available_to_sell, 0) / dv.best_velocity)::integer <= 14 then 'reorder_now'
    when round(coalesce(s.available_to_sell, 0) / dv.best_velocity)::integer <= 30 then 'watch'
    when round(coalesce(s.available_to_sell, 0) / dv.best_velocity)::integer > 90  then 'overstock'
    else 'healthy'
  end as alert_level,

  -- Suggested order quantity (EOQ approximation: 30d demand + safety buffer)
  case
    when dv.best_velocity > 0
    then round(dv.best_velocity * 45)::integer  -- 45-day replenishment target
    else null
  end as suggested_order_qty

from public.v_demand_velocity dv
left join stock s on s.workspace_id = dv.workspace_id and s.product_id = dv.product_id
left join workspace_default_lead wdl on wdl.workspace_id = dv.workspace_id;


-- ============================================================
-- 5. EXPIRY RISK VIEW
--    Flags batches likely to expire before selling through
-- ============================================================
create or replace view public.v_expiry_risk as
select
  ei.id           as item_id,
  ei.batch_id,
  ei.product_id,
  eb.workspace_id,
  p.title         as product_title,
  p.sku           as product_sku,
  ei.remaining_qty,
  ei.expiry_year,
  ei.expiry_month,
  ei.expiry_day,
  -- Compute expiry date (use last day of month if no day given)
  make_date(
    ei.expiry_year,
    ei.expiry_month,
    coalesce(ei.expiry_day, extract(day from (
      date_trunc('month', make_date(ei.expiry_year, ei.expiry_month, 1)) + interval '1 month - 1 day'
    ))::integer)
  ) as expiry_date,
  -- Days until expiry
  make_date(
    ei.expiry_year,
    ei.expiry_month,
    coalesce(ei.expiry_day, extract(day from (
      date_trunc('month', make_date(ei.expiry_year, ei.expiry_month, 1)) + interval '1 month - 1 day'
    ))::integer)
  ) - current_date as days_until_expiry,
  -- Demand velocity
  dv.best_velocity as daily_velocity,
  -- Projected days to sell through remaining qty
  case
    when dv.best_velocity > 0
    then round(ei.remaining_qty / dv.best_velocity)::integer
    else null
  end as days_to_sell_through,
  -- Risk flag: will this expire before it sells?
  case
    when dv.best_velocity is null or dv.best_velocity = 0 then 'unknown'
    when (
      make_date(ei.expiry_year, ei.expiry_month,
        coalesce(ei.expiry_day, extract(day from (
          date_trunc('month', make_date(ei.expiry_year, ei.expiry_month, 1)) + interval '1 month - 1 day'
        ))::integer)
      ) - current_date
    ) < round(ei.remaining_qty / dv.best_velocity)::integer then 'at_risk'
    when (
      make_date(ei.expiry_year, ei.expiry_month,
        coalesce(ei.expiry_year, extract(day from (
          date_trunc('month', make_date(ei.expiry_year, ei.expiry_month, 1)) + interval '1 month - 1 day'
        ))::integer)
      ) - current_date
    ) < round(ei.remaining_qty / dv.best_velocity)::integer * 1.25 then 'borderline'
    else 'safe'
  end as risk_status
from public.expiry_items ei
join public.expiry_batches eb on eb.id = ei.batch_id
join public.products p on p.id = ei.product_id
left join public.v_demand_velocity dv
  on dv.product_id = ei.product_id
  and dv.workspace_id = eb.workspace_id
where ei.status = 'in_stock'
  and ei.remaining_qty > 0
  and ei.expiry_year is not null
  and ei.expiry_month is not null;
