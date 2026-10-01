-- 088 - Fran WH-only packlist path (Loft ditched)
-- Lock fill/transfer source to WH-MAIN; add XFER-WH-STORE; deprecate LOFT-SG labels.
-- Does NOT delete LOFT-SG rows (historical ledger). No stock migration.

-- Rename display + notes for Fran WH
update public.inventory_locations
set
  name = 'Fran Warehouse',
  notes = 'Fran-owned warehouse. Sole packlist / fill / transfer source (store → BOH → Fran WH). Loft ditched.'
where code = 'WH-MAIN';

-- Soft-deprecate Loft 3PL location labels (keep code for history)
update public.inventory_locations
set
  name = 'Loft Logistics (retired)',
  notes = 'RETIRED — Fran owns WH. Do not use for packlist fill. Historical LOFT-SG balances only.'
where code = 'LOFT-SG';

update public.inventory_locations
set
  name = 'Fran WH → Store In Transit',
  notes = 'RETIRED code label kept for old rows. Prefer XFER-WH-STORE for new transfers.'
where code = 'XFER-LOFT-STORE';

-- Seed Fran WH→store transit on all workspaces
insert into public.inventory_locations
  (workspace_id, name, code, location_type, is_default, notes)
select
  w.id,
  'Fran WH → Store In Transit',
  'XFER-WH-STORE',
  'in_transit',
  false,
  'Goods released from Fran WH not yet store-received.'
from public.workspaces w
where not exists (
  select 1 from public.inventory_locations il
  where il.workspace_id = w.id and il.code = 'XFER-WH-STORE'
);

-- Keep seed function aligned for new workspaces
create or replace function public.seed_workspace_inventory_locations(
  p_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_locations
    (workspace_id, name, code, location_type, is_default, notes)
  values
    (p_workspace_id,
     'Fran Warehouse',  'WH-MAIN',     'warehouse',  true,
     'Fran-owned warehouse. Sole packlist / fill / transfer source (store → BOH → Fran WH).'),

    (p_workspace_id,
     'Loft Logistics (retired)', 'LOFT-SG', '3pl', false,
     'RETIRED — Fran owns WH. Historical only.'),

    (p_workspace_id,
     'Fran WH → Store In Transit', 'XFER-WH-STORE', 'in_transit', false,
     'Goods released from Fran WH not yet store-received.'),

    (p_workspace_id,
     'Loft → Store In Transit (retired)', 'XFER-LOFT-STORE', 'in_transit', false,
     'RETIRED transit code. Prefer XFER-WH-STORE.'),

    (p_workspace_id,
     'Ready to Ship',   'READY-SHIP',  'virtual',    false,
     'Stock picked and packed awaiting carrier pickup.'),

    (p_workspace_id,
     'In Transit',      'IN-TRANSIT',  'in_transit', false,
     'Generic in-transit bucket (supplier or inter-site).'),

    (p_workspace_id,
     'Damaged Goods',   'DAMAGED',     'damaged',    false,
     'QC fail / damaged. Excluded from ATS.'),

    (p_workspace_id,
     'Returns',         'RETURNS',     'returns',    false,
     'Returns awaiting inspection.')

  on conflict (workspace_id, code) do nothing;
end;
$$;
