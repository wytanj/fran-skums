-- ============================================================
-- 065 — Inventory Manager schema (display + alias)
--
-- inventory_ops already seeded in 055. Rename for product language
-- "Inventory Manager" and add inventory_manager slug alias with same
-- permissions (HQ approve/verify/write; no execute_3pl / credentials).
-- ============================================================

-- Rename primary default schema for Team UI
update public.permission_schemas
set
  name = 'Inventory Manager',
  description = 'HQ inventory manager: approve/defer store requests, verify receipt exceptions, apply floor stock. No Loft credentials or send-to-Loft (execute_3pl). Assign to ops staff who are not full admin.',
  updated_at = now()
where workspace_id is null and slug = 'inventory_ops';

-- Alias slug for role packages / MCP defaultMcpPackageForRole
insert into public.permission_schemas (id, workspace_id, name, slug, description, is_default, permissions)
select
  '00000000-0000-0000-0001-000000000012',
  null,
  'Inventory Manager',
  'inventory_manager',
  'Alias of inventory_ops — HQ inventory manager seat (approve/verify; no execute_3pl).',
  true,
  p.permissions
from public.permission_schemas p
where p.workspace_id is null and p.slug = 'inventory_ops'
  and not exists (
    select 1 from public.permission_schemas
    where workspace_id is null and slug = 'inventory_manager'
  );

-- Keep alias permissions in sync with inventory_ops
update public.permission_schemas im
set
  name = 'Inventory Manager',
  permissions = io.permissions,
  description = 'Alias of inventory_ops — HQ inventory manager seat (approve/verify; no execute_3pl).',
  is_default = true,
  updated_at = now()
from public.permission_schemas io
where im.workspace_id is null
  and im.slug = 'inventory_manager'
  and io.workspace_id is null
  and io.slug = 'inventory_ops';

comment on table public.permission_schemas is
  'Role templates. Platform defaults include owner/admin/member/viewer, store_associate, inventory_ops|inventory_manager (HQ ops without Loft send).';
