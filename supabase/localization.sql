-- Product Localization: multi-language product content
-- Run AFTER organizations.sql
-- =====================================================

-- ── 1. Workspace locale config ──

create table public.workspace_locales (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  locale_code   text not null,          -- e.g. 'en', 'zh-CN', 'ja', 'ko', 'th', 'ms'
  locale_name   text not null,          -- e.g. 'English', '简体中文', '日本語'
  is_default    boolean not null default false,
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  unique (workspace_id, locale_code)
);

alter table public.workspace_locales enable row level security;

create policy "members can view locales"
  on public.workspace_locales for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "admins can manage locales"
  on public.workspace_locales for insert
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

create policy "admins can update locales"
  on public.workspace_locales for update
  using (workspace_id in (select public.get_my_admin_workspace_ids()));

create policy "admins can delete locales"
  on public.workspace_locales for delete
  using (workspace_id in (select public.get_my_admin_workspace_ids()));

-- ── 2. Product localizations ──

create table public.product_localizations (
  id            uuid primary key default uuid_generate_v4(),
  product_id    uuid not null references public.products(id) on delete cascade,
  locale_code   text not null,          -- e.g. 'zh-CN'

  -- Translatable content fields (mirror of products table string fields)
  title               text,
  description         text,
  short_description   text,
  seo_title           text,
  seo_description     text,
  seo_keywords        text[],
  tags                text[],

  -- Beauty/ingredient-specific structured data
  -- Stores ingredient translations, efficacy descriptions, warnings, usage instructions
  -- Schema: { ingredients: [{name, local_name, description, warnings}], usage, benefits, warnings }
  localized_data      jsonb default '{}',

  -- Translation metadata
  translation_status  text not null default 'pending'
    check (translation_status in ('pending', 'draft', 'ai_translated', 'human_reviewed', 'approved')),
  translated_by       text,             -- 'ai:grok-3-mini', 'human:user-id', etc.
  reviewed_by         uuid references public.profiles(id),
  review_notes        text,
  source_locale       text,             -- which locale was this translated from
  ai_confidence       numeric(3,2),     -- 0.00 to 1.00 — AI translation confidence

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (product_id, locale_code)
);

alter table public.product_localizations enable row level security;

create index idx_product_localizations_product on public.product_localizations(product_id);
create index idx_product_localizations_locale on public.product_localizations(locale_code);
create index idx_product_localizations_status on public.product_localizations(translation_status);

-- RLS: access follows product access (product's workspace must be in user's workspaces)
create policy "members can view localizations"
  on public.product_localizations for select
  using (exists (
    select 1 from public.products p
    where p.id = product_localizations.product_id
      and p.workspace_id in (select public.get_my_workspace_ids())
  ));

create policy "writers can insert localizations"
  on public.product_localizations for insert
  with check (exists (
    select 1 from public.products p
    where p.id = product_localizations.product_id
      and p.workspace_id in (select public.get_my_writable_workspace_ids())
  ));

create policy "writers can update localizations"
  on public.product_localizations for update
  using (exists (
    select 1 from public.products p
    where p.id = product_localizations.product_id
      and p.workspace_id in (select public.get_my_writable_workspace_ids())
  ));

create policy "writers can delete localizations"
  on public.product_localizations for delete
  using (exists (
    select 1 from public.products p
    where p.id = product_localizations.product_id
      and p.workspace_id in (select public.get_my_writable_workspace_ids())
  ));

-- ── 3. Product ingredients table (beauty/cosmetics specific) ──
-- Normalized ingredient data that can be translated and used for recommendations

create table public.product_ingredients (
  id            uuid primary key default uuid_generate_v4(),
  product_id    uuid not null references public.products(id) on delete cascade,
  inci_name     text not null,          -- International Nomenclature of Cosmetic Ingredients
  common_name   text,                   -- e.g. "Vitamin C"
  cas_number    text,                   -- Chemical Abstracts Service number
  category      text,                   -- e.g. 'active', 'emollient', 'preservative', 'fragrance', 'colorant'
  concentration numeric(5,2),           -- percentage if known
  sort_order    int not null default 0, -- order on ingredient list (typically by concentration)

  -- Properties for recommendation engine
  properties    jsonb default '{}',     -- { hydrating: true, exfoliating: true, anti_aging: true, ... }
  skin_types    text[] default '{}',    -- e.g. ['oily', 'combination'] — which skin types benefit
  concerns      text[] default '{}',    -- e.g. ['acne', 'hyperpigmentation', 'fine_lines']
  contraindications text[] default '{}', -- e.g. ['sensitive_skin', 'pregnancy', 'aha_users']

  is_active_ingredient boolean not null default false,
  is_potential_allergen boolean not null default false,

  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_id, inci_name)
);

alter table public.product_ingredients enable row level security;

create index idx_product_ingredients_product on public.product_ingredients(product_id);
create index idx_product_ingredients_inci on public.product_ingredients(inci_name);
create index idx_product_ingredients_category on public.product_ingredients(category);

-- GIN index for array/jsonb searching (for recommendation queries)
create index idx_product_ingredients_skin_types on public.product_ingredients using gin(skin_types);
create index idx_product_ingredients_concerns on public.product_ingredients using gin(concerns);
create index idx_product_ingredients_contraindications on public.product_ingredients using gin(contraindications);
create index idx_product_ingredients_properties on public.product_ingredients using gin(properties);

create policy "members can view ingredients"
  on public.product_ingredients for select
  using (exists (
    select 1 from public.products p
    where p.id = product_ingredients.product_id
      and p.workspace_id in (select public.get_my_workspace_ids())
  ));

create policy "writers can insert ingredients"
  on public.product_ingredients for insert
  with check (exists (
    select 1 from public.products p
    where p.id = product_ingredients.product_id
      and p.workspace_id in (select public.get_my_writable_workspace_ids())
  ));

create policy "writers can update ingredients"
  on public.product_ingredients for update
  using (exists (
    select 1 from public.products p
    where p.id = product_ingredients.product_id
      and p.workspace_id in (select public.get_my_writable_workspace_ids())
  ));

create policy "writers can delete ingredients"
  on public.product_ingredients for delete
  using (exists (
    select 1 from public.products p
    where p.id = product_ingredients.product_id
      and p.workspace_id in (select public.get_my_writable_workspace_ids())
  ));

-- ── 4. Ingredient localizations ──

create table public.ingredient_localizations (
  id              uuid primary key default uuid_generate_v4(),
  ingredient_id   uuid not null references public.product_ingredients(id) on delete cascade,
  locale_code     text not null,
  local_name      text,                 -- translated common name
  description     text,                 -- what it does, in local language
  efficacy        text,                 -- purported benefits in local language
  warnings        text,                 -- safety warnings in local language
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (ingredient_id, locale_code)
);

alter table public.ingredient_localizations enable row level security;

-- RLS follows ingredient → product → workspace chain
create policy "members can view ingredient localizations"
  on public.ingredient_localizations for select
  using (exists (
    select 1 from public.product_ingredients pi
    join public.products p on p.id = pi.product_id
    where pi.id = ingredient_localizations.ingredient_id
      and p.workspace_id in (select public.get_my_workspace_ids())
  ));

create policy "writers can manage ingredient localizations"
  on public.ingredient_localizations for insert
  with check (exists (
    select 1 from public.product_ingredients pi
    join public.products p on p.id = pi.product_id
    where pi.id = ingredient_localizations.ingredient_id
      and p.workspace_id in (select public.get_my_writable_workspace_ids())
  ));

create policy "writers can update ingredient localizations"
  on public.ingredient_localizations for update
  using (exists (
    select 1 from public.product_ingredients pi
    join public.products p on p.id = pi.product_id
    where pi.id = ingredient_localizations.ingredient_id
      and p.workspace_id in (select public.get_my_writable_workspace_ids())
  ));

create policy "writers can delete ingredient localizations"
  on public.ingredient_localizations for delete
  using (exists (
    select 1 from public.product_ingredients pi
    join public.products p on p.id = pi.product_id
    where pi.id = ingredient_localizations.ingredient_id
      and p.workspace_id in (select public.get_my_writable_workspace_ids())
  ));

-- ── 5. Localization summary view ──

create or replace view public.v_product_locale_status as
select
  p.id as product_id,
  p.workspace_id,
  p.title,
  p.status,
  wl.locale_code,
  wl.locale_name,
  wl.is_default,
  pl.id as localization_id,
  pl.translation_status,
  pl.ai_confidence,
  pl.translated_by,
  pl.updated_at as translation_updated_at,
  case
    when wl.is_default then 'source'
    when pl.id is null then 'missing'
    when pl.translation_status = 'approved' then 'complete'
    when pl.translation_status in ('ai_translated', 'human_reviewed') then 'review'
    else 'incomplete'
  end as locale_status
from public.products p
cross join public.workspace_locales wl
left join public.product_localizations pl
  on pl.product_id = p.id and pl.locale_code = wl.locale_code
where wl.workspace_id = p.workspace_id
  and wl.is_active = true;

-- ── 6. Seed default locales function ──

create or replace function public.seed_workspace_locales(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_locales (workspace_id, locale_code, locale_name, is_default, sort_order)
  values
    (p_workspace_id, 'en', 'English', true, 0)
  on conflict (workspace_id, locale_code) do nothing;
end;
$$;
