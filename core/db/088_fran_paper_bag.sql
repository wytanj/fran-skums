-- 088. FRANBAG paper bag on every workspace.
-- Run AFTER: 045_fran_product_metadata.sql
--
-- Non-stock checkout line. track_inventory stays false.
-- A second run leaves an existing FRANBAG row alone.

create or replace function public.ensure_fran_paper_bag(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.products (
    workspace_id,
    sku,
    title,
    retail_price,
    sale_price,
    cost_price,
    track_inventory,
    status,
    product_data
  )
  select
    p_workspace_id,
    'FRANBAG',
    'Paper Bag',
    0.00,
    0.00,
    0.00,
    false,
    'active',
    jsonb_build_object(
      'fran_reward_eligible', false,
      'fran_reward_exclusion_reason', 'non_stock',
      'fran_sample_eligible', false,
      'fran_store_pickup_eligible', false,
      'pos_enabled', true
    )
  where not exists (
    select 1
    from public.products existing
    where existing.workspace_id = p_workspace_id
      and lower(existing.sku) = 'franbag'
  );
end;
$$;

revoke execute on function public.ensure_fran_paper_bag(uuid) from public, anon, authenticated;

create or replace function public.handle_workspace_fran_paper_bag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_fran_paper_bag(new.id);
  return new;
end;
$$;

revoke execute on function public.handle_workspace_fran_paper_bag() from public, anon, authenticated;

drop trigger if exists on_workspace_created_fran_paper_bag on public.workspaces;

create trigger on_workspace_created_fran_paper_bag
  after insert on public.workspaces
  for each row execute function public.handle_workspace_fran_paper_bag();

select public.ensure_fran_paper_bag(w.id)
from public.workspaces w;
