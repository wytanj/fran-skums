-- Fix categories RLS: the "for all" policy needs WITH CHECK for inserts
-- Without it, INSERT is silently denied.

-- Drop the old policy
drop policy if exists "Workspace members can manage categories" on public.categories;

-- Recreate with both USING (for select/update/delete) and WITH CHECK (for insert)
create policy "Workspace members can manage categories"
  on public.categories for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

-- Also fix brands (same issue)
drop policy if exists "Workspace members can manage brands" on public.brands;

create policy "Workspace members can manage brands"
  on public.brands for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

-- Fix products
drop policy if exists "Workspace members can manage products" on public.products;

create policy "Workspace members can manage products"
  on public.products for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

-- Fix product_images
drop policy if exists "Workspace members can manage images" on public.product_images;

create policy "Workspace members can manage images"
  on public.product_images for all
  using (
    product_id in (
      select id from public.products
      where workspace_id in (select public.get_my_writable_workspace_ids())
    )
  )
  with check (
    product_id in (
      select id from public.products
      where workspace_id in (select public.get_my_writable_workspace_ids())
    )
  );

-- Fix product_variants
drop policy if exists "Workspace members can manage variants" on public.product_variants;

create policy "Workspace members can manage variants"
  on public.product_variants for all
  using (
    product_id in (
      select id from public.products
      where workspace_id in (select public.get_my_writable_workspace_ids())
    )
  )
  with check (
    product_id in (
      select id from public.products
      where workspace_id in (select public.get_my_writable_workspace_ids())
    )
  );

-- Fix custom_field_definitions
drop policy if exists "Workspace members can manage field definitions" on public.custom_field_definitions;

create policy "Workspace members can manage field definitions"
  on public.custom_field_definitions for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

-- Fix integrations
drop policy if exists "Admins can manage integrations" on public.integrations;

create policy "Admins can manage integrations"
  on public.integrations for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));
