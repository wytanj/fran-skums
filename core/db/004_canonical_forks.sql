-- ============================================================
-- SKUMS — Canonical Products, Forks/Renditions, Product Manuals
-- Run this in the Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1. Add canonical/fork columns to products
-- ============================================================

-- Whether this is a manufacturer's canonical (base) product
alter table public.products
  add column if not exists is_canonical boolean not null default false;

-- If this is a fork, points to the canonical product it was forked from
alter table public.products
  add column if not exists canonical_product_id uuid references public.products(id) on delete set null;

-- Which fields the fork has overridden vs inherited from canonical
-- e.g. {"title": true, "retail_price": true} means those were customized
alter table public.products
  add column if not exists overrides jsonb default '{}';

-- What this rendition is for: "shopify", "amazon", "print_catalog", "website", etc.
alter table public.products
  add column if not exists export_target text;

-- Label for the rendition: "US Shopify", "EU Website", etc.
alter table public.products
  add column if not exists rendition_name text;

-- Index for finding forks of a canonical product
create index if not exists idx_products_canonical on public.products(canonical_product_id)
  where canonical_product_id is not null;

create index if not exists idx_products_is_canonical on public.products(workspace_id, is_canonical)
  where is_canonical = true;

-- ============================================================
-- 2. Product Manuals
-- ============================================================
create table if not exists public.product_manuals (
  id            uuid primary key default uuid_generate_v4(),
  product_id    uuid not null references public.products(id) on delete cascade,
  title         text not null,
  content       text not null default '',
  version       text default '1.0',
  is_published  boolean not null default false,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_manuals_product on public.product_manuals(product_id);

alter table public.product_manuals enable row level security;

drop policy if exists "Manuals follow product access" on public.product_manuals;
create policy "Manuals follow product access"
  on public.product_manuals for select
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_workspace_ids()))
  );

drop policy if exists "Manuals follow product management" on public.product_manuals;
create policy "Manuals follow product management"
  on public.product_manuals for all
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_writable_workspace_ids()))
  );

-- updated_at trigger
drop trigger if exists set_updated_at on public.product_manuals;
create trigger set_updated_at before update on public.product_manuals
  for each row execute function public.update_updated_at();

-- ============================================================
-- 3. RPC: Fork a canonical product into caller's workspace
-- ============================================================
create or replace function public.fork_product(
  source_product_id uuid,
  target_workspace_id uuid,
  p_rendition_name text default null,
  p_export_target text default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  source public.products%rowtype;
  new_product public.products%rowtype;
begin
  -- Verify caller has access to the target workspace
  if target_workspace_id not in (
    select workspace_id from public.workspace_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ) then
    raise exception 'You do not have write access to the target workspace';
  end if;

  -- Fetch the source product
  select * into source from public.products where id = source_product_id;

  if not found then
    raise exception 'Source product not found';
  end if;

  -- Create the fork
  insert into public.products (
    workspace_id, is_canonical, canonical_product_id, overrides,
    rendition_name, export_target,
    sku, ean, upc, isbn, asin, mpn, gtin,
    title, description, short_description,
    brand_id, category_id,
    cost_price, retail_price, sale_price, currency,
    weight, weight_unit, length, width, height, dimension_unit,
    stock_quantity, low_stock_threshold, track_inventory,
    seo_title, seo_description, seo_keywords, canonical_url,
    status, tags
  )
  values (
    target_workspace_id, false, source.id, '{}',
    coalesce(p_rendition_name, 'Fork of ' || source.title),
    p_export_target,
    source.sku, source.ean, source.upc, source.isbn,
    source.asin, source.mpn, source.gtin,
    source.title, source.description, source.short_description,
    null, null,  -- don't copy brand/category FKs across workspaces
    source.cost_price, source.retail_price, source.sale_price, source.currency,
    source.weight, source.weight_unit, source.length, source.width,
    source.height, source.dimension_unit,
    0, source.low_stock_threshold, source.track_inventory,
    source.seo_title, source.seo_description, source.seo_keywords, source.canonical_url,
    'draft', source.tags
  )
  returning * into new_product;

  return row_to_json(new_product);
end;
$$;
