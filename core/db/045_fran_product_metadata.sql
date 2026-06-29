-- ============================================================
-- Fran SKUMS - Product metadata projection
--
-- Purpose:
--   Keep Fran-specific product facts in product_data while exposing a
--   narrow, typed context for POS and CRM reward/product decisions.
--
-- Run AFTER: 044_store_operations.sql
-- ============================================================

create or replace function public.fran_jsonb_bool(
  p_data jsonb,
  p_key text,
  p_default boolean default false
)
returns boolean
language sql
immutable
as $$
  select case
    when jsonb_typeof(p_data -> p_key) = 'boolean' then (p_data ->> p_key)::boolean
    when jsonb_typeof(p_data -> p_key) = 'number' then (p_data ->> p_key) <> '0'
    when lower(coalesce(p_data ->> p_key, '')) in ('true', '1', 'yes', 'y', 'on', 'eligible') then true
    when lower(coalesce(p_data ->> p_key, '')) in ('false', '0', 'no', 'n', 'off', 'ineligible') then false
    else p_default
  end;
$$;

create or replace function public.fran_jsonb_text_array(
  p_data jsonb,
  p_key text
)
returns text[]
language sql
immutable
as $$
  select case
    when jsonb_typeof(p_data -> p_key) = 'array' then (
      select coalesce(array_agg(nullif(trim(value), '')), '{}')
      from jsonb_array_elements_text(p_data -> p_key) as value
      where nullif(trim(value), '') is not null
    )
    when nullif(trim(coalesce(p_data ->> p_key, '')), '') is not null then (
      select array_agg(trim(value))
      from regexp_split_to_table(p_data ->> p_key, ',') as value
      where nullif(trim(value), '') is not null
    )
    else '{}'
  end;
$$;

drop view if exists public.v_fran_product_context;
create view public.v_fran_product_context
with (security_invoker = true)
as
select
  p.workspace_id,
  p.id as product_id,
  p.sku,
  coalesce(p.gtin, p.ean, p.upc) as barcode,
  p.title,
  coalesce(p.product_data ->> 'fran_brand', b.name) as brand,
  coalesce(p.product_data ->> 'fran_category', c.name) as category,
  nullif(p.product_data ->> 'fran_collection', '') as collection,
  p.tags,
  public.fran_jsonb_bool(p.product_data, 'fran_reward_eligible', false) as reward_eligible,
  nullif(p.product_data ->> 'fran_reward_exclusion_reason', '') as reward_exclusion_reason,
  public.fran_jsonb_bool(p.product_data, 'fran_sample_eligible', false) as sample_eligible,
  coalesce(nullif(p.product_data ->> 'fran_return_policy_group', ''), 'standard') as return_policy_group,
  public.fran_jsonb_bool(p.product_data, 'fran_store_pickup_eligible', true) as store_pickup_eligible,
  nullif(p.product_data ->> 'fran_3pl_fulfillment_profile', '') as fulfillment_profile_3pl,
  public.fran_jsonb_text_array(p.product_data, 'fran_skin_concern_tags') as skin_concern_tags,
  public.fran_jsonb_text_array(p.product_data, 'fran_sensitivity_flags') as sensitivity_flags,
  public.fran_jsonb_text_array(p.product_data, 'restricted_product_flags') as restricted_product_flags,
  jsonb_build_object(
    'fran_category', coalesce(p.product_data ->> 'fran_category', c.name),
    'fran_brand', coalesce(p.product_data ->> 'fran_brand', b.name),
    'fran_collection', nullif(p.product_data ->> 'fran_collection', ''),
    'fran_reward_eligible', public.fran_jsonb_bool(p.product_data, 'fran_reward_eligible', false),
    'fran_reward_exclusion_reason', nullif(p.product_data ->> 'fran_reward_exclusion_reason', ''),
    'fran_sample_eligible', public.fran_jsonb_bool(p.product_data, 'fran_sample_eligible', false),
    'fran_return_policy_group', coalesce(nullif(p.product_data ->> 'fran_return_policy_group', ''), 'standard'),
    'fran_store_pickup_eligible', public.fran_jsonb_bool(p.product_data, 'fran_store_pickup_eligible', true),
    'fran_3pl_fulfillment_profile', nullif(p.product_data ->> 'fran_3pl_fulfillment_profile', ''),
    'fran_skin_concern_tags', to_jsonb(public.fran_jsonb_text_array(p.product_data, 'fran_skin_concern_tags')),
    'fran_sensitivity_flags', to_jsonb(public.fran_jsonb_text_array(p.product_data, 'fran_sensitivity_flags')),
    'restricted_product_flags', to_jsonb(public.fran_jsonb_text_array(p.product_data, 'restricted_product_flags'))
  ) as fran_metadata,
  p.updated_at
from public.products p
left join public.brands b on b.id = p.brand_id
left join public.categories c on c.id = p.category_id;

grant execute on function public.fran_jsonb_bool(jsonb, text, boolean)
  to authenticated, service_role;

grant execute on function public.fran_jsonb_text_array(jsonb, text)
  to authenticated, service_role;

grant select on public.v_fran_product_context
  to authenticated, service_role;

create index if not exists idx_products_fran_reward_eligible
  on public.products (public.fran_jsonb_bool(product_data, 'fran_reward_eligible', false));

create index if not exists idx_products_fran_sample_eligible
  on public.products (public.fran_jsonb_bool(product_data, 'fran_sample_eligible', false));
