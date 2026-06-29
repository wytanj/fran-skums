-- ============================================================
-- SKUMS Identity Graph Read Views
--
-- Purpose:
--   Provide a compatibility read projection for the new identity
--   spine without changing existing product APIs yet.
--
-- Run AFTER: 022_identity_spine_backfill.sql
-- ============================================================

create or replace view public.v_product_identity_graph
with (security_invoker = true)
as
select
  p.workspace_id,
  p.id as product_id,
  pi.id as product_identity_id,
  pi.name as identity_name,
  pi.description as identity_description,
  pi.identity_kind,
  pi.status as identity_status,
  pi.metadata as identity_metadata,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', tu.id,
          'product_id', tu.product_id,
          'variant_id', tu.variant_id,
          'parent_trade_unit_id', tu.parent_trade_unit_id,
          'unit_kind', tu.unit_kind,
          'label', tu.label,
          'quantity', tu.quantity,
          'base_unit', tu.base_unit,
          'conversion_factor', tu.conversion_factor,
          'is_default', tu.is_default,
          'metadata', tu.metadata
        )
        order by tu.is_default desc, tu.created_at
      )
      from public.trade_units tu
      where tu.product_identity_id = pi.id
    ),
    '[]'::jsonb
  ) as trade_units,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', ii.id,
          'product_identity_id', ii.product_identity_id,
          'trade_unit_id', ii.trade_unit_id,
          'identifier_type', ii.identifier_type,
          'identifier_value', ii.identifier_value,
          'issuer', ii.issuer,
          'source', ii.source,
          'is_primary', ii.is_primary,
          'metadata', ii.metadata
        )
        order by ii.is_primary desc, ii.identifier_type, ii.created_at
      )
      from public.identity_identifiers ii
      where ii.product_identity_id = pi.id
         or ii.trade_unit_id in (
           select tu.id from public.trade_units tu where tu.product_identity_id = pi.id
         )
    ),
    '[]'::jsonb
  ) as identifiers,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', sa.id,
          'sku', sa.sku,
          'scope_type', sa.scope_type,
          'scope_id', sa.scope_id,
          'scope_label', sa.scope_label,
          'product_identity_id', sa.product_identity_id,
          'trade_unit_id', sa.trade_unit_id,
          'product_id', sa.product_id,
          'variant_id', sa.variant_id,
          'assignment_kind', sa.assignment_kind,
          'is_primary', sa.is_primary,
          'is_active', sa.is_active,
          'metadata', sa.metadata
        )
        order by sa.is_primary desc, sa.scope_type, sa.created_at
      )
      from public.sku_assignments sa
      where sa.product_identity_id = pi.id
         or sa.product_id = p.id
         or sa.trade_unit_id in (
           select tu.id from public.trade_units tu where tu.product_identity_id = pi.id
         )
    ),
    '[]'::jsonb
  ) as sku_assignments
from public.products p
join public.product_identities pi
  on pi.product_id = p.id
 and pi.workspace_id = p.workspace_id;

comment on view public.v_product_identity_graph is
  'Read projection for product identity, trade units, first-class identifiers, and scoped SKU assignments.';
