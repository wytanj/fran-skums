-- ============================================================
-- 058 — Inventory adjustment apply + floor hygiene (Phase E)
--
-- - apply_inventory_adjustment: pending/approved → ledger via upsert
-- - reject_inventory_adjustment: pending → rejected (no qty change)
-- - Cycle-count POS event type on pos_inventory_events
-- - Align last_counted_at on stocktake apply
-- ============================================================

-- Allow cycle count reports through POS inventory events
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'pos_inventory_events'
  ) then
    alter table public.pos_inventory_events
      drop constraint if exists pos_inventory_events_event_type_check;
    alter table public.pos_inventory_events
      add constraint pos_inventory_events_event_type_check
      check (event_type in (
        'inventory.damage.reported',
        'inventory.found_stock.reported',
        'inventory.transfer_receive.reported',
        'inventory.cycle_count.reported'
      ));
  end if;
end $$;

-- ------------------------------------------------------------
-- Apply pending/approved adjustment → inventory_ledger
-- ------------------------------------------------------------
create or replace function public.apply_inventory_adjustment(
  p_adjustment_id uuid,
  p_created_by    uuid default null,
  p_notes         text default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_adj       public.inventory_adjustments%rowtype;
  v_line      public.inventory_adjustment_lines%rowtype;
  v_delta     int;
  v_movement  text;
  v_lines     int := 0;
  v_total_delta int := 0;
begin
  select * into v_adj
  from public.inventory_adjustments
  where id = p_adjustment_id
  for update;

  if not found then
    raise exception 'Adjustment not found: %', p_adjustment_id;
  end if;

  if v_adj.status not in ('pending', 'approved') then
    raise exception 'Adjustment cannot be applied in status: %', v_adj.status;
  end if;

  v_movement := case v_adj.adjustment_type
    when 'damage' then 'damage'
    when 'theft' then 'damage'
    when 'expiry' then 'damage'
    else 'adjustment'
  end;

  for v_line in
    select * from public.inventory_adjustment_lines
    where adjustment_id = p_adjustment_id
    order by sort_order, created_at
  loop
    -- counted - system; if system null, delta = counted - current on_hand
    if v_line.system_qty is null then
      select coalesce(il.on_hand, 0) into v_delta
      from public.inventory_levels il
      where il.product_id = v_line.product_id
        and coalesce(il.variant_id::text, '') = coalesce(v_line.variant_id::text, '')
        and il.location_id = v_adj.location_id;

      v_delta := v_line.counted_qty - coalesce(v_delta, 0);
    else
      v_delta := v_line.counted_qty - v_line.system_qty;
    end if;

    if v_delta = 0 then
      continue;
    end if;

    perform public.upsert_inventory_level(
      p_workspace_id      => v_adj.workspace_id,
      p_product_id        => v_line.product_id,
      p_variant_id        => v_line.variant_id,
      p_location_id       => v_adj.location_id,
      p_quantity_type     => 'on_hand',
      p_delta             => v_delta,
      p_movement_type     => v_movement,
      p_reference_type    => 'inventory_adjustment',
      p_reference_id      => v_adj.id,
      p_reference_line_id => v_line.id,
      p_notes             => coalesce(p_notes, v_line.reason, v_adj.notes, v_adj.adjustment_type),
      p_created_by        => p_created_by
    );

    v_lines := v_lines + 1;
    v_total_delta := v_total_delta + v_delta;
  end loop;

  if v_adj.adjustment_type = 'stocktake' then
    update public.inventory_levels
    set last_counted_at = now(),
        updated_at = now()
    where location_id = v_adj.location_id
      and product_id in (
        select product_id from public.inventory_adjustment_lines where adjustment_id = p_adjustment_id
      );
  end if;

  update public.inventory_adjustments
  set status = 'applied',
      approved_by = coalesce(p_created_by, approved_by),
      approved_at = coalesce(approved_at, now()),
      notes = case
        when p_notes is not null and p_notes <> '' then
          trim(both from coalesce(notes, '') || E'\n' || p_notes)
        else notes
      end,
      updated_at = now()
  where id = p_adjustment_id;

  -- Linked POS events → applied
  update public.pos_inventory_events
  set status = 'applied',
      processed_at = now(),
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
        'applied_at', now(),
        'applied_by', p_created_by,
        'lines_applied', v_lines,
        'total_delta', v_total_delta
      )
  where adjustment_id = p_adjustment_id
    and status in ('pending_approval', 'received');

  return json_build_object(
    'ok', true,
    'adjustment_id', p_adjustment_id,
    'status', 'applied',
    'lines_applied', v_lines,
    'total_delta', v_total_delta,
    'movement_type', v_movement
  );
end;
$$;

-- ------------------------------------------------------------
-- Reject pending adjustment (no ledger)
-- ------------------------------------------------------------
create or replace function public.reject_inventory_adjustment(
  p_adjustment_id uuid,
  p_created_by    uuid default null,
  p_notes         text default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_adj public.inventory_adjustments%rowtype;
begin
  select * into v_adj
  from public.inventory_adjustments
  where id = p_adjustment_id
  for update;

  if not found then
    raise exception 'Adjustment not found: %', p_adjustment_id;
  end if;

  if v_adj.status not in ('draft', 'pending', 'approved') then
    raise exception 'Adjustment cannot be rejected in status: %', v_adj.status;
  end if;

  update public.inventory_adjustments
  set status = 'rejected',
      approved_by = p_created_by,
      approved_at = now(),
      notes = case
        when p_notes is not null and p_notes <> '' then
          trim(both from coalesce(notes, '') || E'\n[reject] ' || p_notes)
        else notes
      end,
      updated_at = now()
  where id = p_adjustment_id;

  update public.pos_inventory_events
  set status = 'rejected',
      processed_at = now(),
      error_message = coalesce(p_notes, 'Rejected by inventory ops'),
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
        'rejected_at', now(),
        'rejected_by', p_created_by
      )
  where adjustment_id = p_adjustment_id
    and status in ('pending_approval', 'received');

  return json_build_object(
    'ok', true,
    'adjustment_id', p_adjustment_id,
    'status', 'rejected'
  );
end;
$$;

grant execute on function public.apply_inventory_adjustment(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.reject_inventory_adjustment(uuid, uuid, text) to authenticated, service_role;

comment on function public.apply_inventory_adjustment is
  'Phase E: apply pending inventory adjustment to inventory_ledger via upsert_inventory_level';
comment on function public.reject_inventory_adjustment is
  'Phase E: reject pending inventory adjustment without ledger mutation';
