-- ============================================================
-- SKUMS Identity Spine Backfill
--
-- Purpose:
--   Populate the new identity-spine tables from existing products
--   and keep future product inserts compatible while API writes are
--   still product-row first.
--
-- Run AFTER: 021_identity_spine.sql
-- ============================================================

-- ============================================================
-- 1. Helper: create or complete identity-spine records for one product
-- ============================================================

create or replace function public.ensure_product_identity_spine(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_identity public.product_identities%rowtype;
  v_trade_unit public.trade_units%rowtype;
  v_identifier record;
begin
  select * into v_product
  from public.products
  where id = p_product_id;

  if not found then
    raise exception 'Product not found: %', p_product_id;
  end if;

  insert into public.product_identities (
    workspace_id,
    product_id,
    name,
    description,
    identity_kind,
    status,
    metadata
  )
  values (
    v_product.workspace_id,
    v_product.id,
    v_product.title,
    v_product.description,
    'product',
    v_product.status::text,
    jsonb_build_object('source', 'legacy_product_backfill')
  )
  on conflict (workspace_id, product_id) do update
  set
    name = excluded.name,
    description = coalesce(public.product_identities.description, excluded.description),
    status = excluded.status
  returning * into v_identity;

  insert into public.trade_units (
    workspace_id,
    product_identity_id,
    product_id,
    unit_kind,
    label,
    quantity,
    base_unit,
    conversion_factor,
    is_default,
    metadata
  )
  values (
    v_product.workspace_id,
    v_identity.id,
    v_product.id,
    'each',
    'Each',
    1,
    'each',
    1,
    true,
    jsonb_build_object('source', 'legacy_product_backfill')
  )
  on conflict (product_identity_id) where is_default = true do update
  set
    product_id = excluded.product_id,
    label = coalesce(public.trade_units.label, excluded.label)
  returning * into v_trade_unit;

  if v_product.sku is not null and length(trim(v_product.sku)) > 0 then
    insert into public.sku_assignments (
      workspace_id,
      sku,
      scope_type,
      product_identity_id,
      trade_unit_id,
      product_id,
      assignment_kind,
      is_primary,
      metadata
    )
    select
      v_product.workspace_id,
      trim(v_product.sku),
      'workspace',
      v_identity.id,
      v_trade_unit.id,
      v_product.id,
      'internal',
      true,
      jsonb_build_object('source', 'legacy_product_sku')
    where not exists (
      select 1
      from public.sku_assignments sa
      where sa.workspace_id = v_product.workspace_id
        and sa.scope_type = 'workspace'
        and sa.scope_id is null
        and lower(sa.sku) = lower(trim(v_product.sku))
        and sa.is_active = true
    );
  end if;

  for v_identifier in
    select *
    from (
      values
        ('gtin', v_product.gtin),
        ('upc', v_product.upc),
        ('ean', v_product.ean),
        ('isbn', v_product.isbn),
        ('asin', v_product.asin),
        ('mpn', v_product.mpn)
    ) as identifiers(identifier_type, identifier_value)
    where identifier_value is not null
      and length(trim(identifier_value)) > 0
  loop
    insert into public.identity_identifiers (
      workspace_id,
      product_identity_id,
      trade_unit_id,
      identifier_type,
      identifier_value,
      source,
      is_primary,
      metadata
    )
    values (
      v_product.workspace_id,
      v_identity.id,
      v_trade_unit.id,
      v_identifier.identifier_type,
      trim(v_identifier.identifier_value),
      'legacy_product_column',
      v_identifier.identifier_type in ('gtin', 'upc', 'ean'),
      jsonb_build_object('source_column', v_identifier.identifier_type)
    )
    on conflict (
      workspace_id,
      identifier_type,
      lower(identifier_value),
      coalesce(lower(issuer), '')
    ) do nothing;
  end loop;

  return jsonb_build_object(
    'product_id', v_product.id,
    'product_identity_id', v_identity.id,
    'trade_unit_id', v_trade_unit.id
  );
end;
$$;


-- ============================================================
-- 2. Bulk backfill helper
-- ============================================================

create or replace function public.backfill_identity_spine(p_workspace_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
  v_count int := 0;
begin
  for v_product in
    select id
    from public.products
    where p_workspace_id is null or workspace_id = p_workspace_id
    order by created_at
  loop
    perform public.ensure_product_identity_spine(v_product.id);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('processed_products', v_count);
end;
$$;


-- ============================================================
-- 3. Insert bridge while app writes still target products directly
-- ============================================================

create or replace function public.handle_product_identity_spine_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_product_identity_spine(new.id);
  return new;
end;
$$;

drop trigger if exists on_product_created_identity_spine on public.products;

create trigger on_product_created_identity_spine
  after insert on public.products
  for each row execute function public.handle_product_identity_spine_insert();

revoke execute on function public.ensure_product_identity_spine(uuid) from public, anon, authenticated;
revoke execute on function public.backfill_identity_spine(uuid) from public, anon, authenticated;
revoke execute on function public.handle_product_identity_spine_insert() from public, anon, authenticated;


-- ============================================================
-- 4. Backfill existing rows now
-- ============================================================

select public.backfill_identity_spine(null);
