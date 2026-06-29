-- ============================================================
-- SKUMS Scoped SKU Assignment Helpers
--
-- Purpose:
--   Centralize SKU-as-context-label behavior behind RPCs.
--
-- Run AFTER: 024_identity_spine_update_bridge.sql
-- ============================================================

-- ============================================================
-- 1. Assign a SKU to a trade unit within a context
-- ============================================================

create or replace function public.assign_sku_to_trade_unit(
  p_trade_unit_id uuid,
  p_sku text,
  p_scope_type text default 'workspace',
  p_scope_id uuid default null,
  p_scope_label text default null,
  p_assignment_kind text default 'internal',
  p_is_primary boolean default false,
  p_metadata jsonb default '{}'::jsonb
)
returns public.sku_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trade_unit public.trade_units%rowtype;
  v_assignment public.sku_assignments%rowtype;
begin
  if p_sku is null or length(trim(p_sku)) = 0 then
    raise exception 'SKU cannot be empty';
  end if;

  select * into v_trade_unit
  from public.trade_units
  where id = p_trade_unit_id;

  if not found then
    raise exception 'Trade unit not found: %', p_trade_unit_id;
  end if;

  if v_trade_unit.workspace_id not in (select public.get_my_writable_workspace_ids()) then
    raise exception 'Access denied';
  end if;

  if p_is_primary then
    update public.sku_assignments
    set is_primary = false, updated_at = now()
    where trade_unit_id = p_trade_unit_id
      and scope_type = p_scope_type
      and coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and is_primary = true
      and is_active = true;
  end if;

  insert into public.sku_assignments (
    workspace_id,
    sku,
    scope_type,
    scope_id,
    scope_label,
    product_identity_id,
    trade_unit_id,
    product_id,
    variant_id,
    assignment_kind,
    is_primary,
    metadata
  )
  values (
    v_trade_unit.workspace_id,
    trim(p_sku),
    p_scope_type,
    p_scope_id,
    p_scope_label,
    v_trade_unit.product_identity_id,
    v_trade_unit.id,
    v_trade_unit.product_id,
    v_trade_unit.variant_id,
    p_assignment_kind,
    p_is_primary,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_assignment;

  return v_assignment;
end;
$$;


-- ============================================================
-- 2. Resolve the best SKU assignment for a trade unit and context
-- ============================================================

create or replace function public.resolve_sku_for_context(
  p_trade_unit_id uuid,
  p_scope_type text default 'workspace',
  p_scope_id uuid default null
)
returns public.sku_assignments
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_trade_unit public.trade_units%rowtype;
  v_assignment public.sku_assignments%rowtype;
begin
  select * into v_trade_unit
  from public.trade_units
  where id = p_trade_unit_id;

  if not found then
    raise exception 'Trade unit not found: %', p_trade_unit_id;
  end if;

  if v_trade_unit.workspace_id not in (select public.get_my_workspace_ids()) then
    raise exception 'Access denied';
  end if;

  select * into v_assignment
  from public.sku_assignments
  where trade_unit_id = p_trade_unit_id
    and scope_type = p_scope_type
    and coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and is_active = true
  order by is_primary desc, created_at desc
  limit 1;

  if found then
    return v_assignment;
  end if;

  -- Fallback to the default workspace SKU for channel/supplier/listing
  -- contexts that do not yet have their own assignment.
  select * into v_assignment
  from public.sku_assignments
  where trade_unit_id = p_trade_unit_id
    and scope_type = 'workspace'
    and scope_id is null
    and is_active = true
  order by is_primary desc, created_at desc
  limit 1;

  return v_assignment;
end;
$$;


-- ============================================================
-- 3. List SKU assignments for a product
-- ============================================================

create or replace function public.list_sku_assignments_for_product(p_product_id uuid)
returns setof public.sku_assignments
language sql
security definer
set search_path = ''
stable
as $$
  select sa.*
  from public.sku_assignments sa
  join public.products p
    on p.id = p_product_id
   and p.workspace_id = sa.workspace_id
  where p.workspace_id in (select public.get_my_workspace_ids())
    and (
      sa.product_id = p_product_id
      or sa.product_identity_id in (
        select pi.id
        from public.product_identities pi
        where pi.product_id = p_product_id
      )
      or sa.trade_unit_id in (
        select tu.id
        from public.trade_units tu
        where tu.product_id = p_product_id
      )
    )
  order by sa.is_primary desc, sa.scope_type, sa.created_at;
$$;
