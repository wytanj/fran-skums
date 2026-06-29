-- Fix infinite recursion in RLS policies
-- Run this in the Supabase SQL Editor

-- ============================================================
-- 1. Create a helper function that bypasses RLS to get
--    workspace IDs for the current user. This avoids all
--    self-referencing subqueries on workspace_members.
-- ============================================================
create or replace function public.get_my_workspace_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select workspace_id
  from public.workspace_members
  where user_id = auth.uid();
$$;

create or replace function public.get_my_writable_workspace_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select workspace_id
  from public.workspace_members
  where user_id = auth.uid()
    and role in ('owner','admin','member');
$$;

create or replace function public.get_my_admin_workspace_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select workspace_id
  from public.workspace_members
  where user_id = auth.uid()
    and role in ('owner','admin');
$$;

-- ============================================================
-- 2. Fix workspace_members policies (self-referencing)
-- ============================================================
drop policy if exists "Members can view membership" on public.workspace_members;
drop policy if exists "Admins can manage members" on public.workspace_members;
drop policy if exists "Owners can insert members" on public.workspace_members;
drop policy if exists "Owners can update members" on public.workspace_members;
drop policy if exists "Owners can delete members" on public.workspace_members;

create policy "Members can view membership"
  on public.workspace_members for select
  using (user_id = auth.uid());

create policy "Owners can insert members"
  on public.workspace_members for insert
  with check (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
    or user_id = auth.uid()
  );

create policy "Owners can update members"
  on public.workspace_members for update
  using (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  );

create policy "Owners can delete members"
  on public.workspace_members for delete
  using (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
    or user_id = auth.uid()
  );

-- ============================================================
-- 3. Fix workspaces policies
-- ============================================================
drop policy if exists "Members can view workspace" on public.workspaces;

create policy "Members can view workspace"
  on public.workspaces for select
  using (id in (select public.get_my_workspace_ids()));

-- ============================================================
-- 4. Fix brands policies
-- ============================================================
drop policy if exists "Workspace members can view brands" on public.brands;
drop policy if exists "Workspace members can manage brands" on public.brands;

create policy "Workspace members can view brands"
  on public.brands for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Workspace members can manage brands"
  on public.brands for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

-- ============================================================
-- 5. Fix categories policies
-- ============================================================
drop policy if exists "Workspace members can view categories" on public.categories;
drop policy if exists "Workspace members can manage categories" on public.categories;

create policy "Workspace members can view categories"
  on public.categories for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Workspace members can manage categories"
  on public.categories for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

-- ============================================================
-- 6. Fix products policies
-- ============================================================
drop policy if exists "Workspace members can view products" on public.products;
drop policy if exists "Workspace members can manage products" on public.products;

create policy "Workspace members can view products"
  on public.products for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Workspace members can manage products"
  on public.products for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

-- ============================================================
-- 7. Fix product_images policies
-- ============================================================
drop policy if exists "Product images follow product access" on public.product_images;
drop policy if exists "Product images follow product management" on public.product_images;

create policy "Product images follow product access"
  on public.product_images for select
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_workspace_ids()))
  );

create policy "Product images follow product management"
  on public.product_images for all
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_writable_workspace_ids()))
  );

-- ============================================================
-- 8. Fix product_variants policies
-- ============================================================
drop policy if exists "Variants follow product access" on public.product_variants;
drop policy if exists "Variants follow product management" on public.product_variants;

create policy "Variants follow product access"
  on public.product_variants for select
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_workspace_ids()))
  );

create policy "Variants follow product management"
  on public.product_variants for all
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_writable_workspace_ids()))
  );

-- ============================================================
-- 9. Fix custom fields policies
-- ============================================================
drop policy if exists "Workspace members can view custom fields" on public.custom_field_definitions;
drop policy if exists "Workspace members can manage custom fields" on public.custom_field_definitions;

create policy "Workspace members can view custom fields"
  on public.custom_field_definitions for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Workspace members can manage custom fields"
  on public.custom_field_definitions for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

drop policy if exists "Custom field values follow product access" on public.custom_field_values;
drop policy if exists "Custom field values follow product management" on public.custom_field_values;

create policy "Custom field values follow product access"
  on public.custom_field_values for select
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_workspace_ids()))
  );

create policy "Custom field values follow product management"
  on public.custom_field_values for all
  using (
    product_id in (select id from public.products where workspace_id in (select public.get_my_writable_workspace_ids()))
  );

-- ============================================================
-- 10. Fix integrations policies
-- ============================================================
drop policy if exists "Workspace members can view integrations" on public.integrations;
drop policy if exists "Admins can manage integrations" on public.integrations;

create policy "Workspace members can view integrations"
  on public.integrations for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Admins can manage integrations"
  on public.integrations for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()));

drop policy if exists "Mappings follow integration access" on public.integration_product_mappings;
drop policy if exists "Mappings follow integration management" on public.integration_product_mappings;

create policy "Mappings follow integration access"
  on public.integration_product_mappings for select
  using (
    integration_id in (select id from public.integrations where workspace_id in (select public.get_my_workspace_ids()))
  );

create policy "Mappings follow integration management"
  on public.integration_product_mappings for all
  using (
    integration_id in (select id from public.integrations where workspace_id in (select public.get_my_admin_workspace_ids()))
  );

-- ============================================================
-- 11. Fix activity_log policies
-- ============================================================
drop policy if exists "Workspace members can view activity" on public.activity_log;
drop policy if exists "System can insert activity" on public.activity_log;

create policy "Workspace members can view activity"
  on public.activity_log for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "System can insert activity"
  on public.activity_log for insert
  with check (workspace_id in (select public.get_my_workspace_ids()));
