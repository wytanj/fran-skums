-- ============================================================
-- SKUMS — Dynamic Product Schema System
-- Run this migration AFTER the base schema.sql
-- ============================================================

-- ============================================================
-- 1. PRODUCT_SCHEMAS
--    Stores JSON Schema definitions.
--    - workspace_id IS NULL  => global base schema (source of truth)
--    - workspace_id IS NOT NULL => workspace-level extension
-- ============================================================
create table if not exists public.product_schemas (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  name          text not null,
  slug          text not null,
  description   text,
  version       int not null default 1,

  -- The actual JSON Schema (draft-07 compatible)
  schema        jsonb not null default '{}',

  -- Which base schema this extends (null = root)
  extends_schema_id uuid references public.product_schemas(id) on delete set null,

  is_active     boolean not null default true,

  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (workspace_id, slug)
);

create index if not exists idx_product_schemas_workspace on public.product_schemas(workspace_id);
create index if not exists idx_product_schemas_extends on public.product_schemas(extends_schema_id);

alter table public.product_schemas enable row level security;

-- Everyone can read global schemas (workspace_id is null)
create policy "Anyone can view global schemas"
  on public.product_schemas for select
  using (workspace_id is null);

create policy "Members can view workspace schemas"
  on public.product_schemas for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Writers can manage workspace schemas"
  on public.product_schemas for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

-- ============================================================
-- 2. Add product_data JSONB column to products
--    This stores the actual dynamic field values per product,
--    validated against the schema at application level.
-- ============================================================
alter table public.products
  add column if not exists product_data jsonb not null default '{}';

alter table public.products
  add column if not exists schema_id uuid references public.product_schemas(id) on delete set null;

create index if not exists idx_products_schema on public.products(schema_id);
create index if not exists idx_products_data on public.products using gin (product_data);

-- ============================================================
-- 3. Seed the global base schema
--    Modeled after Swell's product model — extensible by any workspace
-- ============================================================
insert into public.product_schemas (id, workspace_id, name, slug, description, schema)
values (
  '00000000-0000-0000-0000-000000000001',
  null,
  'Global Base Product Schema',
  'global-base',
  'The canonical base schema for all products in SKUMS. Inspired by Swell, Shopify, and common PIM standards. Companies extend this with their own properties.',
  '{
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "properties": {
      "identifiers": {
        "type": "object",
        "description": "Product identification codes",
        "properties": {
          "sku": { "type": "string", "description": "Stock Keeping Unit" },
          "ean": { "type": "string", "description": "European Article Number (EAN-13)" },
          "upc": { "type": "string", "description": "Universal Product Code (UPC-A)" },
          "gtin": { "type": "string", "description": "Global Trade Item Number" },
          "isbn": { "type": "string", "description": "International Standard Book Number" },
          "asin": { "type": "string", "description": "Amazon Standard Identification Number" },
          "mpn": { "type": "string", "description": "Manufacturer Part Number" }
        }
      },
      "core": {
        "type": "object",
        "description": "Core product information",
        "properties": {
          "name": { "type": "string", "description": "Product name / title" },
          "slug": { "type": "string", "description": "URL-friendly identifier" },
          "description": { "type": "string", "description": "Full product description (may contain HTML)" },
          "short_description": { "type": "string", "description": "Brief summary" },
          "type": { "type": "string", "enum": ["standard", "subscription", "bundle", "giftcard", "digital", "service"], "description": "Product type" },
          "active": { "type": "boolean", "description": "Whether the product is visible in storefronts", "default": false },
          "virtual": { "type": "boolean", "description": "Non-physical product" },
          "discontinued": { "type": "boolean" }
        },
        "required": ["name"]
      },
      "pricing": {
        "type": "object",
        "description": "Pricing information",
        "properties": {
          "price": { "type": "number", "description": "List / retail price" },
          "sale_price": { "type": "number", "description": "Discounted sale price" },
          "cost_price": { "type": "number", "description": "Cost of goods (COGS)" },
          "currency": { "type": "string", "default": "USD", "description": "ISO 4217 currency code" },
          "on_sale": { "type": "boolean" },
          "tax_class": { "type": "string" },
          "tax_code": { "type": "string", "description": "Tax code for Avalara, TaxJar, etc." }
        }
      },
      "inventory": {
        "type": "object",
        "description": "Inventory and stock tracking",
        "properties": {
          "stock_tracking": { "type": "boolean", "default": true },
          "stock_quantity": { "type": "integer", "default": 0 },
          "stock_status": { "type": "string", "enum": ["in_stock", "out_of_stock", "backorder", "preorder", "discontinued"] },
          "low_stock_threshold": { "type": "integer", "default": 10 },
          "backorder_enabled": { "type": "boolean" },
          "preorder_enabled": { "type": "boolean" }
        }
      },
      "shipping": {
        "type": "object",
        "description": "Shipping and physical dimensions",
        "properties": {
          "weight": { "type": "number" },
          "weight_unit": { "type": "string", "enum": ["kg", "lb", "g", "oz"], "default": "kg" },
          "length": { "type": "number" },
          "width": { "type": "number" },
          "height": { "type": "number" },
          "dimension_unit": { "type": "string", "enum": ["cm", "in", "m", "ft"], "default": "cm" },
          "requires_shipping": { "type": "boolean", "default": true }
        }
      },
      "seo": {
        "type": "object",
        "description": "Search engine optimization",
        "properties": {
          "meta_title": { "type": "string", "maxLength": 60 },
          "meta_description": { "type": "string", "maxLength": 160 },
          "meta_keywords": { "type": "array", "items": { "type": "string" } },
          "canonical_url": { "type": "string", "format": "uri" },
          "og_image": { "type": "string", "format": "uri" },
          "og_title": { "type": "string" },
          "og_description": { "type": "string" }
        }
      },
      "media": {
        "type": "object",
        "description": "Product images and files",
        "properties": {
          "images": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "url": { "type": "string", "format": "uri" },
                "alt": { "type": "string" },
                "caption": { "type": "string" },
                "is_primary": { "type": "boolean" },
                "sort_order": { "type": "integer" }
              },
              "required": ["url"]
            }
          }
        }
      },
      "options": {
        "type": "array",
        "description": "Product options for variant generation (e.g., Size, Color)",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "input_type": { "type": "string", "enum": ["select", "toggle", "text", "color"] },
            "required": { "type": "boolean" },
            "values": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": { "type": "string" },
                  "price_modifier": { "type": "number" },
                  "description": { "type": "string" }
                },
                "required": ["name"]
              }
            }
          },
          "required": ["name"]
        }
      },
      "attributes": {
        "type": "object",
        "description": "Arbitrary key-value product attributes",
        "additionalProperties": true
      },
      "tags": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Searchable tags"
      },
      "purchase_options": {
        "type": "object",
        "description": "Purchase option configurations",
        "properties": {
          "standard": {
            "type": "object",
            "properties": {
              "active": { "type": "boolean" },
              "price": { "type": "number" },
              "sale_price": { "type": "number" },
              "on_sale": { "type": "boolean" },
              "account_groups": { "type": "array", "items": { "type": "string" } }
            }
          },
          "subscription": {
            "type": "object",
            "properties": {
              "active": { "type": "boolean" },
              "plans": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "name": { "type": "string" },
                    "price": { "type": "number" },
                    "billing_interval": { "type": "string", "enum": ["daily", "weekly", "monthly", "yearly"] },
                    "billing_interval_count": { "type": "integer" },
                    "trial_days": { "type": "integer" }
                  },
                  "required": ["name", "price", "billing_interval"]
                }
              }
            }
          }
        }
      },
      "related_products": {
        "type": "object",
        "description": "Cross-sell and up-sell relationships",
        "properties": {
          "cross_sells": { "type": "array", "items": { "type": "string" }, "description": "Product IDs for cross-selling" },
          "up_sells": { "type": "array", "items": { "type": "string" }, "description": "Product IDs for up-selling" }
        }
      }
    }
  }'::jsonb
)
on conflict (workspace_id, slug) do nothing;

-- ============================================================
-- 4. RPC: Resolve a schema with inheritance (merges base + workspace)
-- ============================================================
create or replace function public.resolve_product_schema(p_schema_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  current_schema jsonb;
  parent_id uuid;
  parent_schema jsonb;
begin
  select schema, extends_schema_id
  into current_schema, parent_id
  from public.product_schemas
  where id = p_schema_id;

  if current_schema is null then
    return '{}'::jsonb;
  end if;

  if parent_id is not null then
    parent_schema := public.resolve_product_schema(parent_id);
    -- Deep merge: parent properties first, then overlay child
    return parent_schema || current_schema;
  end if;

  return current_schema;
end;
$$;
