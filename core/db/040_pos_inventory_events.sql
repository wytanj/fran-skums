-- ============================================================
-- SKUMS POS Inventory Events
--
-- Purpose:
--   Accept store-floor inventory signals from POS while keeping
--   SKUMS as the canonical ledger and approval surface.
--
-- Run AFTER: 039_import_review_pipeline.sql
-- ============================================================

create table if not exists public.pos_inventory_events (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  event_type            text not null
    check (event_type in (
      'inventory.damage.reported',
      'inventory.found_stock.reported',
      'inventory.transfer_receive.reported'
    )),

  status                text not null default 'received'
    check (status in ('received', 'pending_approval', 'applied', 'rejected', 'failed')),

  source                text not null default 'vantage_pos',
  idempotency_key       text,

  pos_location_id       uuid references public.pos_locations(id) on delete set null,
  inventory_location_id uuid references public.inventory_locations(id) on delete set null,
  register_id           uuid references public.pos_registers(id) on delete set null,
  register_session_id   uuid references public.pos_register_sessions(id) on delete set null,
  transfer_id           uuid references public.inventory_transfers(id) on delete set null,

  product_identity_id   uuid references public.product_identities(id) on delete set null,
  trade_unit_id         uuid references public.trade_units(id) on delete set null,
  listing_id            uuid references public.listings(id) on delete set null,
  channel_id            uuid references public.channels(id) on delete set null,
  sku_assignment_id     uuid references public.sku_assignments(id) on delete set null,
  identifier_id         uuid references public.identity_identifiers(id) on delete set null,
  product_id            uuid references public.products(id) on delete set null,
  variant_id            uuid references public.product_variants(id) on delete set null,

  sku                   text,
  quantity              integer check (quantity is null or quantity > 0),
  storage_location_code text,
  reason_code           text,
  reference             text,

  adjustment_id         uuid references public.inventory_adjustments(id) on delete set null,
  payload               jsonb not null default '{}',
  result                jsonb not null default '{}',
  error_message         text,

  occurred_at           timestamptz not null default now(),
  processed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_pos_inventory_events_workspace
  on public.pos_inventory_events(workspace_id, created_at desc);

create index if not exists idx_pos_inventory_events_status
  on public.pos_inventory_events(workspace_id, status, created_at desc);

create index if not exists idx_pos_inventory_events_product
  on public.pos_inventory_events(product_id, created_at desc)
  where product_id is not null;

create unique index if not exists idx_pos_inventory_events_idempotency
  on public.pos_inventory_events(workspace_id, idempotency_key)
  where idempotency_key is not null;

alter table public.pos_inventory_events enable row level security;

create policy "Members can view POS inventory events"
  on public.pos_inventory_events for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage POS inventory events"
  on public.pos_inventory_events for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.pos_inventory_events
  for each row execute function public.update_updated_at();


-- ============================================================
-- Receive inventory transfer
-- ============================================================

create or replace function public.receive_inventory_transfer(
  p_transfer_id uuid,
  p_receipts jsonb,
  p_created_by uuid default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.inventory_transfers%rowtype;
  v_line public.inventory_transfer_lines%rowtype;
  v_receipt jsonb;
  v_qty int;
  v_all_done boolean;
begin
  select * into v_transfer
  from public.inventory_transfers
  where id = p_transfer_id;

  if not found then
    raise exception 'Inventory transfer not found';
  end if;

  if auth.role() <> 'service_role'
    and v_transfer.workspace_id not in (
    select workspace_id from public.workspace_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ) then
    raise exception 'Access denied';
  end if;

  if v_transfer.status not in ('in_transit','partially_received') then
    raise exception 'Transfer must be in transit before receiving';
  end if;

  for v_receipt in select * from jsonb_array_elements(p_receipts)
  loop
    select * into v_line
    from public.inventory_transfer_lines
    where id = (v_receipt->>'line_id')::uuid
      and transfer_id = p_transfer_id;

    if not found then
      raise exception 'Transfer line % not found', v_receipt->>'line_id';
    end if;

    v_qty := (v_receipt->>'qty')::int;
    if v_qty <= 0 then continue; end if;

    if v_line.received_qty + v_qty > v_line.requested_qty then
      raise exception 'Receipt qty % exceeds remaining on transfer line %', v_qty, v_line.id;
    end if;

    update public.inventory_transfer_lines
    set received_qty = received_qty + v_qty,
        updated_at = now()
    where id = v_line.id;

    perform public.upsert_inventory_level(
      v_transfer.workspace_id, v_line.product_id, v_line.variant_id,
      v_transfer.to_location_id,
      'in_transit', -v_qty,
      'transfer_received', 'inventory_transfer', p_transfer_id, v_line.id,
      'Received transfer ' || v_transfer.transfer_number, p_created_by
    );

    perform public.upsert_inventory_level(
      v_transfer.workspace_id, v_line.product_id, v_line.variant_id,
      v_transfer.to_location_id,
      'on_hand', v_qty,
      'transfer_received', 'inventory_transfer', p_transfer_id, v_line.id,
      'Received transfer ' || v_transfer.transfer_number, p_created_by
    );
  end loop;

  select bool_and(received_qty >= requested_qty) into v_all_done
  from public.inventory_transfer_lines
  where transfer_id = p_transfer_id;

  update public.inventory_transfers
  set status = case when v_all_done then 'received' else 'partially_received' end,
      updated_at = now()
  where id = p_transfer_id;

  return json_build_object(
    'success', true,
    'status', case when v_all_done then 'received' else 'partially_received' end
  );
end;
$$;
