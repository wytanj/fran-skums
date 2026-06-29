-- ============================================================
-- SKUMS — Expiry App
-- Batch-level expiry tracking with LIFO planning and public microsites.
-- Run AFTER schema.sql, fix-rls-recursion.sql, api-keys.sql
-- ============================================================

-- ----- SKU Aliases (the resolution layer) -----
-- A workspace can have many aliases for one product.
-- The same string "ABC123" can appear in different workspaces pointing
-- to different products. Within a workspace, (alias_type, alias_value) is unique.
-- This solves: manufacturer SKU ≠ internal SKU ≠ supplier code ≠ UPC.
-- When expiry data arrives with just a SKU string, we resolve it here first,
-- falling back to products.sku / products.ean / products.upc for unregistered aliases.

create table if not exists public.sku_aliases (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,

  alias_type      text not null default 'sku',
  alias_value     text not null,

  label           text,           -- human-friendly note, e.g. "Supplier ABC code"
  source          text,           -- where this alias came from: 'manual', 'csv_import', 'api', 'integration'

  created_at      timestamptz not null default now(),

  constraint uq_sku_alias unique (workspace_id, alias_type, alias_value)
);

create index if not exists idx_sku_aliases_lookup
  on public.sku_aliases(workspace_id, alias_value);
create index if not exists idx_sku_aliases_product
  on public.sku_aliases(product_id);

alter table public.sku_aliases enable row level security;

create policy "Members can view sku aliases"
  on public.sku_aliases for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Writers can manage sku aliases"
  on public.sku_aliases for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));


-- ----- Resolve SKU helper -----
-- Given a workspace + raw sku string, returns the product_id.
-- Priority: exact alias match → products.sku → products.ean → products.upc → null.

create or replace function public.resolve_sku(
  p_workspace_id uuid,
  p_sku_value text
) returns uuid
language plpgsql
security definer
as $$
declare
  v_product_id uuid;
begin
  -- 1. Check aliases (most specific)
  select product_id into v_product_id
    from public.sku_aliases
    where workspace_id = p_workspace_id
      and alias_value = p_sku_value
    limit 1;
  if v_product_id is not null then return v_product_id; end if;

  -- 2. Check products.sku
  select id into v_product_id
    from public.products
    where workspace_id = p_workspace_id and sku = p_sku_value
    limit 1;
  if v_product_id is not null then return v_product_id; end if;

  -- 3. Check products.ean
  select id into v_product_id
    from public.products
    where workspace_id = p_workspace_id and ean = p_sku_value
    limit 1;
  if v_product_id is not null then return v_product_id; end if;

  -- 4. Check products.upc
  select id into v_product_id
    from public.products
    where workspace_id = p_workspace_id and upc = p_sku_value
    limit 1;

  return v_product_id;  -- may still be null
end;
$$;


-- ----- Expiry Batches -----
-- A batch represents a physical receipt of goods with a known expiry.
-- Multiple items (SKUs × quantities) belong to a batch.

create table if not exists public.expiry_batches (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  batch_code      text not null,                   -- manufacturer or internal batch ID
  received_at     date not null default current_date,
  notes           text,

  source          text not null default 'manual',  -- 'manual', 'csv', 'api', 'agent', 'integration'
  source_ref      text,                            -- optional reference (filename, agent id, etc.)

  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_expiry_batches_ws
  on public.expiry_batches(workspace_id);

alter table public.expiry_batches enable row level security;

create policy "Members can view expiry batches"
  on public.expiry_batches for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Writers can manage expiry batches"
  on public.expiry_batches for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.expiry_batches
  for each row execute function public.update_updated_at();


-- ----- Expiry Items -----
-- Each row = one SKU line within a batch, with quantity + expiry date.

create type public.expiry_item_status as enum ('in_stock', 'sold', 'promoted', 'disposed', 'returned');

create table if not exists public.expiry_items (
  id              uuid primary key default uuid_generate_v4(),
  batch_id        uuid not null references public.expiry_batches(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  -- The raw SKU string as received (before resolution)
  raw_sku         text not null,

  -- Resolved product (nullable: might be unresolved on first import)
  product_id      uuid references public.products(id) on delete set null,

  quantity         int not null default 1,
  remaining_qty    int not null default 1,

  -- Expiry as month/year (day optional for flexibility)
  expiry_year      int not null,
  expiry_month     int not null check (expiry_month between 1 and 12),
  expiry_day       int,                           -- null if only month/year known

  status           public.expiry_item_status not null default 'in_stock',

  unit_cost        numeric(12,2),
  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_expiry_items_batch on public.expiry_items(batch_id);
create index if not exists idx_expiry_items_ws on public.expiry_items(workspace_id);
create index if not exists idx_expiry_items_product on public.expiry_items(product_id);
create index if not exists idx_expiry_items_expiry on public.expiry_items(workspace_id, expiry_year, expiry_month);

alter table public.expiry_items enable row level security;

create policy "Members can view expiry items"
  on public.expiry_items for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Writers can manage expiry items"
  on public.expiry_items for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.expiry_items
  for each row execute function public.update_updated_at();


-- ----- Auto-resolve SKU on insert -----
-- When an expiry_item is inserted, try to resolve raw_sku → product_id automatically.

create or replace function public.auto_resolve_expiry_sku()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.product_id is null and new.raw_sku is not null then
    new.product_id := public.resolve_sku(new.workspace_id, new.raw_sku);
  end if;
  return new;
end;
$$;

create trigger trg_auto_resolve_sku
  before insert or update on public.expiry_items
  for each row execute function public.auto_resolve_expiry_sku();


-- ----- LIFO view -----
-- Returns in-stock items ordered newest-expiry-first (for LIFO sell planning)
-- and soonest-expiry-first (for promo/disposal planning).

create or replace view public.expiry_lifo as
select
  ei.*,
  eb.batch_code,
  eb.received_at,
  p.title as product_title,
  p.sku as product_sku,
  make_date(ei.expiry_year, ei.expiry_month, coalesce(ei.expiry_day, 1)) as expiry_date,
  make_date(ei.expiry_year, ei.expiry_month, coalesce(ei.expiry_day, 1)) - current_date as days_until_expiry
from public.expiry_items ei
join public.expiry_batches eb on eb.id = ei.batch_id
left join public.products p on p.id = ei.product_id
where ei.status = 'in_stock' and ei.remaining_qty > 0
order by make_date(ei.expiry_year, ei.expiry_month, coalesce(ei.expiry_day, 1)) asc;


-- ----- Expiry Microsites -----
-- Public-facing pages for transparency. Customers can see expiry data.

create table if not exists public.expiry_microsites (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  slug            text not null unique,
  title           text not null,
  description     text,

  -- What to show
  show_product_name  boolean not null default true,
  show_batch_code    boolean not null default true,
  show_sku           boolean not null default false,
  show_quantity      boolean not null default false,
  show_days_remaining boolean not null default true,

  -- Filter: only show specific products, or all
  product_filter    uuid[],                       -- null = show all

  -- Branding
  logo_url         text,
  accent_color     text default '#6366f1',
  footer_text      text,

  is_active        boolean not null default true,
  password_hash    text,                          -- optional password protection

  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.expiry_microsites enable row level security;

create policy "Members can view microsites"
  on public.expiry_microsites for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Admins can manage microsites"
  on public.expiry_microsites for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

create trigger set_updated_at before update on public.expiry_microsites
  for each row execute function public.update_updated_at();


-- ----- Expiry summary stats RPC -----

create or replace function public.expiry_summary(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'total_items', count(*),
    'total_quantity', coalesce(sum(remaining_qty), 0),
    'expired', count(*) filter (
      where make_date(expiry_year, expiry_month, coalesce(expiry_day, 1)) < current_date
    ),
    'expiring_30d', count(*) filter (
      where make_date(expiry_year, expiry_month, coalesce(expiry_day, 1))
        between current_date and current_date + 30
    ),
    'expiring_90d', count(*) filter (
      where make_date(expiry_year, expiry_month, coalesce(expiry_day, 1))
        between current_date and current_date + 90
    ),
    'unresolved', count(*) filter (where product_id is null),
    'unique_products', count(distinct product_id)
  ) into v_result
  from public.expiry_items
  where workspace_id = p_workspace_id
    and status = 'in_stock'
    and remaining_qty > 0;

  return v_result;
end;
$$;
