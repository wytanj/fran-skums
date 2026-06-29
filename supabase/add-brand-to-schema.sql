-- ============================================================
-- SKUMS — Add brand and manufacturer to global base schema
-- Run AFTER add-dynamic-schema.sql
-- ============================================================

-- Add brand and manufacturer fields to the core section of the global base schema.
-- brand = consumer-facing brand name
-- manufacturer = who actually makes it (may differ from brand)
-- manufacturer_id = external manufacturer code / account

update public.product_schemas
set schema = jsonb_set(
  jsonb_set(
    jsonb_set(
      schema,
      '{properties,core,properties,brand}',
      '{"type": "string", "description": "Brand name (auto-resolved to brands table)"}'::jsonb
    ),
    '{properties,core,properties,manufacturer}',
    '{"type": "string", "description": "Manufacturer / maker name (may differ from brand)"}'::jsonb
  ),
  '{properties,core,properties,manufacturer_id}',
  '{"type": "string", "description": "External manufacturer code or account ID"}'::jsonb
),
updated_at = now()
where id = '00000000-0000-0000-0000-000000000001';
