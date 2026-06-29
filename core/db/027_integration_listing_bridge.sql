-- ============================================================
-- SKUMS Integration Listing Bridge
--
-- Purpose:
--   Connect existing integration_sync_mappings to first-class listings
--   without breaking the old integration framework.
--
-- Run AFTER: 026_listings.sql
-- ============================================================

alter table public.integration_sync_mappings
  add column if not exists listing_id uuid references public.listings(id) on delete set null;

create index if not exists idx_sync_mappings_listing
  on public.integration_sync_mappings(listing_id)
  where listing_id is not null;


-- ============================================================
-- 1. Ensure one listing for one integration sync mapping
-- ============================================================

create or replace function public.ensure_listing_for_integration_sync_mapping(p_mapping_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mapping public.integration_sync_mappings%rowtype;
  v_connection public.integration_connections%rowtype;
  v_node public.integration_node_definitions%rowtype;
  v_identity public.product_identities%rowtype;
  v_trade_unit public.trade_units%rowtype;
  v_channel_id uuid;
  v_listing_id uuid;
  v_channel_key text;
begin
  select * into v_mapping
  from public.integration_sync_mappings
  where id = p_mapping_id;

  if not found then
    raise exception 'Integration sync mapping not found: %', p_mapping_id;
  end if;

  select * into v_connection
  from public.integration_connections
  where id = v_mapping.connection_id;

  if not found then
    raise exception 'Integration connection not found: %', v_mapping.connection_id;
  end if;

  select * into v_node
  from public.integration_node_definitions
  where id = v_connection.node_def_id;

  if not found then
    raise exception 'Integration node definition not found: %', v_connection.node_def_id;
  end if;

  perform public.ensure_product_identity_spine(v_mapping.product_id);

  select * into v_identity
  from public.product_identities
  where workspace_id = v_connection.workspace_id
    and product_id = v_mapping.product_id;

  select * into v_trade_unit
  from public.trade_units
  where product_identity_id = v_identity.id
    and is_default = true
  limit 1;

  v_channel_key := coalesce(v_node.slug, 'custom_api');

  select id into v_channel_id
  from public.channels
  where channel_key = v_channel_key
    and (workspace_id is null or workspace_id = v_connection.workspace_id)
  order by workspace_id nulls first
  limit 1;

  if v_channel_id is null then
    insert into public.channels (
      workspace_id,
      channel_key,
      name,
      channel_type,
      vendor,
      adapter_id,
      metadata
    )
    values (
      v_connection.workspace_id,
      v_channel_key,
      v_node.name,
      case
        when v_node.category = 'marketplace' then 'marketplace'
        when v_node.category = 'ecommerce' then 'storefront'
        else 'custom'
      end,
      v_node.name,
      v_node.slug,
      jsonb_build_object('source', 'integration_node_definition')
    )
    returning id into v_channel_id;
  end if;

  select id into v_listing_id
  from public.listings
  where workspace_id = v_connection.workspace_id
    and channel_id = v_channel_id
    and coalesce(integration_connection_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(v_connection.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and external_listing_id = v_mapping.external_id
  limit 1;

  if v_listing_id is null then
    insert into public.listings (
      workspace_id,
      channel_id,
      integration_connection_id,
      product_identity_id,
      trade_unit_id,
      product_id,
      external_listing_id,
      external_url,
      status,
      last_synced_at,
      metadata
    )
    values (
      v_connection.workspace_id,
      v_channel_id,
      v_connection.id,
      v_identity.id,
      v_trade_unit.id,
      v_mapping.product_id,
      v_mapping.external_id,
      v_mapping.external_url,
      case
        when v_mapping.sync_status = 'synced' then 'active'
        when v_mapping.sync_status = 'error' then 'error'
        else 'draft'
      end,
      greatest(v_mapping.last_pushed_at, v_mapping.last_pulled_at),
      jsonb_build_object(
        'source', 'integration_sync_mapping',
        'sync_mapping_id', v_mapping.id,
        'external_data', coalesce(v_mapping.external_data, '{}'::jsonb)
      )
    )
    returning id into v_listing_id;
  end if;

  update public.integration_sync_mappings
  set listing_id = v_listing_id,
      updated_at = now()
  where id = v_mapping.id;

  insert into public.listing_sync_states (
    workspace_id,
    listing_id,
    integration_connection_id,
    sync_status,
    local_hash,
    remote_hash,
    last_pushed_at,
    last_pulled_at,
    last_error,
    metadata
  )
  values (
    v_connection.workspace_id,
    v_listing_id,
    v_connection.id,
    v_mapping.sync_status,
    v_mapping.local_hash,
    v_mapping.remote_hash,
    v_mapping.last_pushed_at,
    v_mapping.last_pulled_at,
    v_mapping.last_error,
    jsonb_build_object('source', 'integration_sync_mapping')
  )
  on conflict (
    listing_id,
    coalesce(integration_connection_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) do update
  set
    sync_status = excluded.sync_status,
    local_hash = excluded.local_hash,
    remote_hash = excluded.remote_hash,
    last_pushed_at = excluded.last_pushed_at,
    last_pulled_at = excluded.last_pulled_at,
    last_error = excluded.last_error,
    updated_at = now();

  return v_listing_id;
end;
$$;


-- ============================================================
-- 2. Bulk bridge existing mappings
-- ============================================================

create or replace function public.backfill_integration_listing_bridge()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mapping record;
  v_count int := 0;
begin
  for v_mapping in
    select id
    from public.integration_sync_mappings
    where listing_id is null
    order by created_at
  loop
    perform public.ensure_listing_for_integration_sync_mapping(v_mapping.id);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('processed_mappings', v_count);
end;
$$;


-- ============================================================
-- 3. Keep future mapping inserts bridged
-- ============================================================

create or replace function public.handle_integration_sync_mapping_listing_bridge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_listing_for_integration_sync_mapping(new.id);
  return new;
end;
$$;

drop trigger if exists on_sync_mapping_created_listing_bridge on public.integration_sync_mappings;

create trigger on_sync_mapping_created_listing_bridge
  after insert on public.integration_sync_mappings
  for each row execute function public.handle_integration_sync_mapping_listing_bridge();

revoke execute on function public.ensure_listing_for_integration_sync_mapping(uuid) from public, anon, authenticated;
revoke execute on function public.backfill_integration_listing_bridge() from public, anon, authenticated;
revoke execute on function public.handle_integration_sync_mapping_listing_bridge() from public, anon, authenticated;

select public.backfill_integration_listing_bridge();
