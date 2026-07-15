-- ============================================================
-- 062 — Ensure at least one store inventory location + POS bind
-- Fran Demo and similar workspaces had only LOFT/WH codes, no store.
-- ============================================================

-- For every workspace missing a store location, seed ST-MAIN
insert into public.inventory_locations (workspace_id, name, code, location_type, is_active, is_default)
select w.id, 'Main store', 'ST-MAIN', 'store', true, false
from public.workspaces w
where not exists (
  select 1 from public.inventory_locations il
  where il.workspace_id = w.id and il.location_type = 'store'
)
on conflict (workspace_id, code) do nothing;

-- POS location FRAN01 / ST-MAIN bind when pos_locations empty or missing bind
insert into public.pos_locations (workspace_id, code, name, inventory_location_id, is_active)
select
  w.id,
  'FRAN01',
  'Main register store',
  il.id,
  true
from public.workspaces w
join public.inventory_locations il
  on il.workspace_id = w.id and il.code = 'ST-MAIN'
where not exists (
  select 1 from public.pos_locations p where p.workspace_id = w.id
)
on conflict (workspace_id, code) do nothing;

-- If pos_locations exist without inventory bind, attach ST-MAIN or first store
update public.pos_locations p
set inventory_location_id = il.id
from public.inventory_locations il
where p.workspace_id = il.workspace_id
  and il.location_type = 'store'
  and p.inventory_location_id is null
  and il.code = (
    select il2.code from public.inventory_locations il2
    where il2.workspace_id = p.workspace_id and il2.location_type = 'store'
    order by case when il2.code = 'ST-MAIN' then 0 else 1 end, il2.created_at
    limit 1
  );
