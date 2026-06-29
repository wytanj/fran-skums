-- ============================================================
-- SKUMS — Global Product Database
-- Supabase / PostgreSQL Schema
-- ============================================================

-- 0. Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";    -- for fuzzy text search

-- ============================================================
-- 1. PROFILES  (extends Supabase auth.users)
-- ============================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  avatar_url  text,
  company     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', '')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. WORKSPACES  (multi-tenant: teams / orgs)
-- ============================================================
create table public.workspaces (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.workspaces enable row level security;

create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          text not null default 'member' check (role in ('owner','admin','member','viewer')),
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.workspace_members enable row level security;

-- ============================================================
-- HELPER FUNCTIONS (security definer — bypass RLS to avoid
-- infinite recursion when other tables' policies need to
-- look up workspace membership)
-- ============================================================
create or replace function public.get_my_workspace_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select workspace_id
  from public.workspace_members
  where user_id = auth.uid();
$$;

create or replace function public.get_my_writable_workspace_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select workspace_id
  from public.workspace_members
  where user_id = auth.uid()
    and role in ('owner','admin','member');
$$;

create or replace function public.get_my_admin_workspace_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select workspace_id
  from public.workspace_members
  where user_id = auth.uid()
    and role in ('owner','admin');
$$;

-- Workspace policies
create policy "Members can view workspace"
  on public.workspaces for select
  using (
    owner_id = auth.uid()
    or id in (select public.get_my_workspace_ids())
  );

create policy "Owner can update workspace"
  on public.workspaces for update
  using (owner_id = auth.uid());

create policy "Authenticated users can create workspaces"
  on public.workspaces for insert
  with check (auth.uid() = owner_id);

-- Workspace members policies (no self-referencing!)
create policy "Members can view membership"
  on public.workspace_members for select
  using (user_id = auth.uid());

create policy "Owners can insert members"
  on public.workspace_members for insert
  with check (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
    or user_id = auth.uid()
  );

create policy "Owners can update members"
  on public.workspace_members for update
  using (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  );

create policy "Owners can delete members"
  on public.workspace_members for delete
  using (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
    or user_id = auth.uid()
  );

-- ============================================================
-- 3. BRANDS
-- ============================================================
create table public.brands (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  logo_url      text,
  website       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, name)
);

alter table public.brands enable row level security;

create policy "Workspace members can view brands"
  on public.brands for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Workspace members can manage brands"
  on public.brands for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

-- ============================================================
-- 4. CATEGORIES  (self-referencing tree)
-- ============================================================
create table public.categories (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  parent_id     uuid references public.categories(id) on delete set null,
  name          text not null,
  slug          text not null,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  unique (workspace_id, slug)
);

alter table public.categories enable row level security;

create policy "Workspace members can view categories"
  on public.categories for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Workspace members can manage categories"
  on public.categories for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

-- ============================================================
-- 5. PRODUCTS  (the core table)
-- ============================================================
create type product_status as enum ('draft','active','archived');

create table public.products (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  -- Identifiers
  sku             text,
  ean             text,
  upc             text,
  isbn            text,
  asin            text,
  mpn             text,          -- manufacturer part number
  gtin            text,          -- global trade item number (covers EAN/UPC/ISBN)

  -- Core fields
  title           text not null,
  description     text,
  short_description text,
  brand_id        uuid references public.brands(id) on delete set null,
  category_id     uuid references public.categories(id) on delete set null,

  -- Pricing
  cost_price      numeric(12,2),
  retail_price    numeric(12,2),
  sale_price      numeric(12,2),
  currency        text not null default 'USD',

  -- Physical
  weight          numeric(10,3),
  weight_unit     text default 'kg' check (weight_unit in ('kg','lb','g','oz')),
  length          numeric(10,2),
  width           numeric(10,2),
  height          numeric(10,2),
  dimension_unit  text default 'cm' check (dimension_unit in ('cm','in','m','ft')),

  -- Inventory
  stock_quantity  int not null default 0,
  low_stock_threshold int default 10,
  track_inventory boolean not null default true,

  -- SEO meta
  seo_title       text,
  seo_description text,
  seo_keywords    text[],
  canonical_url   text,

  -- Status
  status          product_status not null default 'draft',
  published_at    timestamptz,

  -- Tags (array for flexible labeling)
  tags            text[] default '{}',

  -- Canonical / Fork
  is_canonical        boolean not null default false,
  canonical_product_id uuid references public.products(id) on delete set null,
  overrides           jsonb default '{}',
  export_target       text,
  rendition_name      text,

  -- Timestamps
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Constraints
  unique (workspace_id, sku)
);

create index idx_products_canonical on public.products(canonical_product_id) where canonical_product_id is not null;
create index idx_products_is_canonical on public.products(workspace_id, is_canonical) where is_canonical = true;
create index idx_products_workspace on public.products(workspace_id);
create index idx_products_sku on public.products(sku);
create index idx_products_ean on public.products(ean);
create index idx_products_upc on public.products(upc);
create index idx_products_gtin on public.products(gtin);
create index idx_products_status on public.products(workspace_id, status);
create index idx_products_title_trgm on public.products using gin (title gin_trgm_ops);
create index idx_products_tags on public.products using gin (tags);

alter table public.products enable row level security;

create policy "Workspace members can view products"
  on public.products for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Workspace members can manage products"
  on public.products for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

-- ============================================================
-- 6. PRODUCT IMAGES
-- ============================================================
create table public.product_images (
  id          uuid primary key default uuid_generate_v4(),
  product_id  uuid not null references public.products(id) on delete cascade,
  url         text not null,
  alt_text    text,
  sort_order  int not null default 0,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.product_images enable row level security;

create policy "Product images follow product access"
  on public.product_images for select
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_workspace_ids()))
  );

create policy "Product images follow product management"
  on public.product_images for all
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_writable_workspace_ids()))
  );

-- ============================================================
-- 7. PRODUCT VARIANTS  (size, color, etc.)
-- ============================================================
create table public.product_variants (
  id              uuid primary key default uuid_generate_v4(),
  product_id      uuid not null references public.products(id) on delete cascade,
  sku             text,
  ean             text,
  upc             text,
  gtin            text,
  title           text not null,
  options         jsonb not null default '{}',   -- e.g. {"size":"XL","color":"Red"}
  cost_price      numeric(12,2),
  retail_price    numeric(12,2),
  sale_price      numeric(12,2),
  stock_quantity  int not null default 0,
  weight          numeric(10,3),
  image_url       text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.product_variants enable row level security;

create policy "Variants follow product access"
  on public.product_variants for select
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_workspace_ids()))
  );

create policy "Variants follow product management"
  on public.product_variants for all
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_writable_workspace_ids()))
  );

-- ============================================================
-- 8. CUSTOM FIELDS  (user-defined per workspace)
-- ============================================================
create table public.custom_field_definitions (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  field_name    text not null,
  field_key     text not null,        -- slug / machine-readable key
  field_type    text not null default 'text' check (field_type in ('text','number','boolean','date','url','email','select','multi_select','json')),
  description   text,
  options       jsonb,                -- for select/multi_select: ["Option A","Option B"]
  is_required   boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  unique (workspace_id, field_key)
);

create table public.custom_field_values (
  id              uuid primary key default uuid_generate_v4(),
  product_id      uuid not null references public.products(id) on delete cascade,
  field_id        uuid not null references public.custom_field_definitions(id) on delete cascade,
  value_text      text,
  value_number    numeric,
  value_boolean   boolean,
  value_date      date,
  value_json      jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (product_id, field_id)
);

alter table public.custom_field_definitions enable row level security;
alter table public.custom_field_values enable row level security;

create policy "Workspace members can view custom fields"
  on public.custom_field_definitions for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Workspace members can manage custom fields"
  on public.custom_field_definitions for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

create policy "Custom field values follow product access"
  on public.custom_field_values for select
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_workspace_ids()))
  );

create policy "Custom field values follow product management"
  on public.custom_field_values for all
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_writable_workspace_ids()))
  );

-- ============================================================
-- 9. INTEGRATIONS  (Shopify, IMS, etc.)
-- ============================================================
create type integration_type as enum ('shopify','woocommerce','amazon','ebay','custom_ims','csv_import','api');
create type integration_status as enum ('active','paused','error','disconnected');

create table public.integrations (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  type            integration_type not null,
  name            text not null,
  status          integration_status not null default 'disconnected',
  config          jsonb not null default '{}',    -- store URLs, API keys (encrypted at app layer)
  last_synced_at  timestamptz,
  sync_frequency  text default 'manual' check (sync_frequency in ('manual','hourly','daily','weekly')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.integrations enable row level security;

create policy "Workspace members can view integrations"
  on public.integrations for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Admins can manage integrations"
  on public.integrations for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()));

-- Mapping between external product IDs and SKUMS products
create table public.integration_product_mappings (
  id                uuid primary key default uuid_generate_v4(),
  integration_id    uuid not null references public.integrations(id) on delete cascade,
  product_id        uuid not null references public.products(id) on delete cascade,
  external_id       text not null,
  external_url      text,
  last_synced_at    timestamptz,
  sync_status       text default 'synced' check (sync_status in ('synced','pending','error')),
  metadata          jsonb default '{}',
  created_at        timestamptz not null default now(),
  unique (integration_id, external_id)
);

alter table public.integration_product_mappings enable row level security;

create policy "Mappings follow integration access"
  on public.integration_product_mappings for select
  using (
    integration_id in (select id from public.integrations where workspace_id in (select public.get_my_workspace_ids()))
  );

create policy "Mappings follow integration management"
  on public.integration_product_mappings for all
  using (
    integration_id in (select id from public.integrations where workspace_id in (select public.get_my_admin_workspace_ids()))
  );

-- ============================================================
-- 10. ACTIVITY LOG  (audit trail)
-- ============================================================
create table public.activity_log (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid references public.profiles(id) on delete set null,
  entity_type   text not null,     -- 'product', 'brand', 'integration', etc.
  entity_id     uuid not null,
  action        text not null,     -- 'created', 'updated', 'deleted', 'imported', 'synced'
  changes       jsonb,             -- diff of what changed
  created_at    timestamptz not null default now()
);

create index idx_activity_workspace on public.activity_log(workspace_id, created_at desc);
create index idx_activity_entity on public.activity_log(entity_type, entity_id);

alter table public.activity_log enable row level security;

create policy "Workspace members can view activity"
  on public.activity_log for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "System can insert activity"
  on public.activity_log for insert
  with check (workspace_id in (select public.get_my_workspace_ids()));

-- ============================================================
-- 11. PRODUCT MANUALS
-- ============================================================
create table public.product_manuals (
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

create index idx_manuals_product on public.product_manuals(product_id);

alter table public.product_manuals enable row level security;

create policy "Manuals follow product access"
  on public.product_manuals for select
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_workspace_ids()))
  );

create policy "Manuals follow product management"
  on public.product_manuals for all
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_writable_workspace_ids()))
  );

-- ============================================================
-- 12. RPC: Fork a canonical product
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
  if target_workspace_id not in (
    select workspace_id from public.workspace_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ) then
    raise exception 'You do not have write access to the target workspace';
  end if;

  select * into source from public.products where id = source_product_id;
  if not found then
    raise exception 'Source product not found';
  end if;

  insert into public.products (
    workspace_id, is_canonical, canonical_product_id, overrides,
    rendition_name, export_target,
    sku, ean, upc, isbn, asin, mpn, gtin,
    title, description, short_description,
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

-- ============================================================
-- 13. HELPER: updated_at trigger
-- ============================================================
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on public.profiles
  for each row execute function public.update_updated_at();

create trigger set_updated_at before update on public.workspaces
  for each row execute function public.update_updated_at();

create trigger set_updated_at before update on public.products
  for each row execute function public.update_updated_at();

create trigger set_updated_at before update on public.product_variants
  for each row execute function public.update_updated_at();

create trigger set_updated_at before update on public.custom_field_values
  for each row execute function public.update_updated_at();

create trigger set_updated_at before update on public.integrations
  for each row execute function public.update_updated_at();

create trigger set_updated_at before update on public.product_manuals
  for each row execute function public.update_updated_at();
