-- ============================================================
-- SKUMS Identity Spine Update Bridge
--
-- Purpose:
--   Keep the new identity-spine projection coherent while existing
--   UI/API code still updates legacy columns on public.products.
--
-- Run AFTER: 023_identity_graph_views.sql
-- ============================================================

create or replace function public.sync_product_identity_spine_from_product_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity public.product_identities%rowtype;
  v_trade_unit public.trade_units%rowtype;
  v_existing_sku_id uuid;
  v_identifier record;
begin
  -- Ensure the product has spine records even if a row was inserted before
  -- the insert bridge existed or a manual migration missed it.
  perform public.ensure_product_identity_spine(new.id);

  select * into v_identity
  from public.product_identities
  where workspace_id = new.workspace_id
    and product_id = new.id;

  select * into v_trade_unit
  from public.trade_units
  where product_identity_id = v_identity.id
    and is_default = true
  limit 1;

  update public.product_identities
  set
    name = new.title,
    description = new.description,
    status = new.status::text,
    updated_at = now()
  where id = v_identity.id;

  -- Legacy product.sku represents only the default workspace-scoped label.
  -- It is not canonical identity. Keep only bridge-owned assignments in sync.
  select id into v_existing_sku_id
  from public.sku_assignments
  where product_id = new.id
    and scope_type = 'workspace'
    and scope_id is null
    and metadata->>'source' = 'legacy_product_sku'
  order by is_primary desc, created_at
  limit 1;

  if new.sku is null or length(trim(new.sku)) = 0 then
    update public.sku_assignments
    set is_active = false, updated_at = now()
    where product_id = new.id
      and scope_type = 'workspace'
      and scope_id is null
      and metadata->>'source' = 'legacy_product_sku';
  elsif v_existing_sku_id is not null then
    update public.sku_assignments
    set
      sku = trim(new.sku),
      product_identity_id = v_identity.id,
      trade_unit_id = v_trade_unit.id,
      is_primary = true,
      is_active = true,
      updated_at = now()
    where id = v_existing_sku_id;
  else
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
      new.workspace_id,
      trim(new.sku),
      'workspace',
      v_identity.id,
      v_trade_unit.id,
      new.id,
      'internal',
      true,
      jsonb_build_object('source', 'legacy_product_sku')
    where not exists (
      select 1
      from public.sku_assignments sa
      where sa.workspace_id = new.workspace_id
        and sa.scope_type = 'workspace'
        and sa.scope_id is null
        and lower(sa.sku) = lower(trim(new.sku))
        and sa.is_active = true
    );
  end if;

  -- Upsert non-empty legacy identifier columns into first-class identifiers.
  -- Empty values are not deleted here; identifier cleanup should be explicit
  -- once identifier management UI/API exists.
  for v_identifier in
    select *
    from (
      values
        ('gtin', new.gtin),
        ('upc', new.upc),
        ('ean', new.ean),
        ('isbn', new.isbn),
        ('asin', new.asin),
        ('mpn', new.mpn)
    ) as identifiers(identifier_type, identifier_value)
    where identifier_value is not null
      and length(trim(identifier_value)) > 0
  loop
    update public.identity_identifiers
    set
      identifier_value = trim(v_identifier.identifier_value),
      trade_unit_id = v_trade_unit.id,
      updated_at = now()
    where product_identity_id = v_identity.id
      and identifier_type = v_identifier.identifier_type
      and metadata->>'source_column' = v_identifier.identifier_type;

    if not found then
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
        new.workspace_id,
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
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists on_product_updated_identity_spine on public.products;

create trigger on_product_updated_identity_spine
  after update of
    title,
    description,
    status,
    sku,
    gtin,
    upc,
    ean,
    isbn,
    asin,
    mpn
  on public.products
  for each row execute function public.sync_product_identity_spine_from_product_update();

revoke execute on function public.sync_product_identity_spine_from_product_update() from public, anon, authenticated;
