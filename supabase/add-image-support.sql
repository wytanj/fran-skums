-- ============================================================
-- SKUMS — Image Support
-- Enhances product_images with rich metadata, adds a
-- renditions table for platform-specific image variants
-- (Amazon, Shopify, eBay, etc.), and seeds per-platform
-- image requirements onto integration_node_definitions.
--
-- Run AFTER: schema.sql, integration-framework.sql
-- ============================================================


-- ============================================================
-- 1. ENHANCE product_images
--    Add metadata columns to the existing table.
--    Existing rows are unaffected (all new columns nullable
--    or have safe defaults).
-- ============================================================
alter table public.product_images
  -- Supabase Storage location (populated when user uploads via app)
  add column if not exists storage_path      text,
  add column if not exists storage_bucket    text default 'product-images',

  -- Original source URL (set when image is imported from an external system)
  add column if not exists source_url        text,

  -- Image dimensions and file metadata (populated after upload/processing)
  add column if not exists width             int,
  add column if not exists height            int,
  add column if not exists file_size         bigint,        -- bytes
  add column if not exists mime_type         text default 'image/jpeg',

  -- Semantic role of the image within the product
  add column if not exists image_type        text not null default 'gallery'
    check (image_type in (
      'main',         -- primary hero shot (white/clean background)
      'gallery',      -- additional product views
      'lifestyle',    -- in-context / lifestyle photography
      'swatch',       -- colour / pattern swatch for variant selection
      'diagram',      -- technical diagram or exploded view
      'packaging',    -- box / retail packaging shot
      'certificate',  -- compliance cert, award badge, etc.
      '360'           -- frame from a 360° spin set
    )),

  -- Async processing state (set by background job after upload)
  add column if not exists processing_status text not null default 'ready'
    check (processing_status in ('pending', 'processing', 'ready', 'error')),
  add column if not exists processing_error  text,

  -- Mutable, so track changes
  add column if not exists updated_at        timestamptz not null default now();

-- updated_at trigger
create trigger set_updated_at
  before update on public.product_images
  for each row execute function public.update_updated_at();

-- Performance indexes
create index if not exists idx_product_images_product
  on public.product_images(product_id);

create index if not exists idx_product_images_type
  on public.product_images(product_id, image_type);

create index if not exists idx_product_images_primary
  on public.product_images(product_id)
  where is_primary = true;

create index if not exists idx_product_images_processing
  on public.product_images(processing_status)
  where processing_status in ('pending', 'processing');


-- ============================================================
-- 2. PRODUCT IMAGE RENDITIONS
--    Platform/integration-specific processed versions of a
--    master image.  The background worker reads this table,
--    applies the transform_config to the source image, uploads
--    the result to storage, and sets status = 'ready'.
--
--    Examples:
--      integration_slug  rendition_key   meaning
--      ───────────────── ─────────────── ──────────────────────────
--      'amazon'          'MAIN'          2000×2000 white-bg JPEG
--      'amazon'          'PT01'          2000×2000 alternate view
--      'amazon'          'SWCH'          100×100 swatch
--      'shopify'         'product'       2048×2048 square crop
--      'shopify'         'variant'       variant-specific image
--      'shopify'         'thumbnail'     800×800 for collection page
--      'woocommerce'     'featured'      WooCommerce featured image
--      'ebay'            'primary'       eBay primary listing image
--      null              'thumbnail'     Generic 400×400 thumbnail
--      null              'medium'        Generic 800×800
--      null              'large'         Generic 1600×1600
-- ============================================================
create table if not exists public.product_image_renditions (
  id                uuid primary key default uuid_generate_v4(),

  -- Parent master image
  image_id          uuid not null
    references public.product_images(id) on delete cascade,

  -- Target integration (null = generic / not platform-specific)
  integration_slug  text,

  -- Rendition role within that platform (see table above)
  rendition_key     text not null,

  -- Where the processed image lives
  url               text,
  storage_path      text,
  storage_bucket    text default 'product-images',

  -- Output dimensions & file info (filled after processing)
  width             int,
  height            int,
  file_size         bigint,
  mime_type         text,

  -- Instructions used to produce this rendition.
  -- The background job reads this; the app writes it when
  -- queuing a new rendition.
  -- e.g. {
  --   "resize": {"w": 2000, "h": 2000, "fit": "contain"},
  --   "background": "#FFFFFF",
  --   "format": "jpeg",
  --   "quality": 90
  -- }
  transform_config  jsonb not null default '{}',

  -- Lifecycle
  status            text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'error')),
  error_message     text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (image_id, integration_slug, rendition_key)
);

create index if not exists idx_renditions_image
  on public.product_image_renditions(image_id);

create index if not exists idx_renditions_slug
  on public.product_image_renditions(integration_slug)
  where integration_slug is not null;

create index if not exists idx_renditions_status
  on public.product_image_renditions(status)
  where status in ('pending', 'processing');

alter table public.product_image_renditions enable row level security;

-- Renditions inherit access from their parent product
create policy "Renditions follow product access"
  on public.product_image_renditions for select
  using (
    image_id in (
      select pi.id
      from   public.product_images pi
      join   public.products p on p.id = pi.product_id
      where  p.workspace_id in (select public.get_my_workspace_ids())
    )
  );

create policy "Renditions follow product management"
  on public.product_image_renditions for all
  using (
    image_id in (
      select pi.id
      from   public.product_images pi
      join   public.products p on p.id = pi.product_id
      where  p.workspace_id in (select public.get_my_writable_workspace_ids())
    )
  );

create trigger set_updated_at
  before update on public.product_image_renditions
  for each row execute function public.update_updated_at();


-- ============================================================
-- 3. LINK VARIANTS TO IMAGES
--    product_variants already has image_url (free-text).
--    Add a proper FK reference so variants can point at a
--    managed product_images row.  image_url is kept for
--    backwards compatibility with external URLs.
-- ============================================================
alter table public.product_variants
  add column if not exists image_id uuid
    references public.product_images(id) on delete set null;

create index if not exists idx_variants_image
  on public.product_variants(image_id)
  where image_id is not null;


-- ============================================================
-- 4. IMAGE REQUIREMENTS ON INTEGRATION NODE DEFINITIONS
--    Declarative spec of what images each platform expects.
--    The app uses this to:
--      • Show per-channel image checklists in the product editor
--      • Auto-queue the right renditions when an image is uploaded
--      • Validate images before pushing to an integration
-- ============================================================
alter table public.integration_node_definitions
  add column if not exists image_requirements jsonb not null default '[]';
-- Schema of each element:
-- {
--   "key":                  string,   -- rendition_key used in product_image_renditions
--   "label":                string,   -- human-readable name
--   "description":          string,
--   "required":             boolean,
--   "min_width":            int,      -- pixels
--   "min_height":           int,
--   "recommended_width":    int,
--   "recommended_height":   int,
--   "aspect_ratio":         string,   -- e.g. "1:1", "4:3"
--   "background":           string,   -- required background colour (hex) if any
--   "max_file_size_mb":     number,
--   "allowed_mime_types":   string[],
--   "notes":                string
-- }


-- ── Amazon ────────────────────────────────────────────────────
update public.integration_node_definitions
set image_requirements = '[
  {
    "key": "MAIN",
    "label": "Main Image",
    "description": "Primary product image. Pure white (#FFFFFF) background. Product must fill ≥85% of the frame. No text, watermarks, or borders.",
    "required": true,
    "min_width": 1000,
    "min_height": 1000,
    "recommended_width": 2000,
    "recommended_height": 2000,
    "aspect_ratio": "1:1",
    "background": "#FFFFFF",
    "max_file_size_mb": 10,
    "allowed_mime_types": ["image/jpeg", "image/tiff", "image/gif"],
    "notes": "JPEG strongly preferred. Amazon uses this image for zoom (requires ≥1000px). Accepted colour space: sRGB or CMYK."
  },
  {
    "key": "PT01",
    "label": "Product Image 1",
    "description": "Alternate view — angle, back, or detail shot.",
    "required": false,
    "min_width": 1000,
    "min_height": 1000,
    "recommended_width": 2000,
    "recommended_height": 2000,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 10,
    "allowed_mime_types": ["image/jpeg", "image/tiff", "image/gif", "image/png"]
  },
  {
    "key": "PT02",
    "label": "Product Image 2",
    "description": "Alternate view.",
    "required": false,
    "min_width": 1000,
    "min_height": 1000,
    "recommended_width": 2000,
    "recommended_height": 2000,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 10,
    "allowed_mime_types": ["image/jpeg", "image/tiff", "image/gif", "image/png"]
  },
  {
    "key": "PT03",
    "label": "Product Image 3",
    "description": "Alternate view.",
    "required": false,
    "min_width": 1000,
    "min_height": 1000,
    "recommended_width": 2000,
    "recommended_height": 2000,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 10,
    "allowed_mime_types": ["image/jpeg", "image/tiff", "image/gif", "image/png"]
  },
  {
    "key": "PT04",
    "label": "Product Image 4",
    "description": "Alternate view.",
    "required": false,
    "min_width": 1000,
    "min_height": 1000,
    "recommended_width": 2000,
    "recommended_height": 2000,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 10,
    "allowed_mime_types": ["image/jpeg", "image/tiff", "image/gif", "image/png"]
  },
  {
    "key": "PT05",
    "label": "Product Image 5",
    "description": "Alternate view.",
    "required": false,
    "min_width": 1000,
    "min_height": 1000,
    "recommended_width": 2000,
    "recommended_height": 2000,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 10,
    "allowed_mime_types": ["image/jpeg", "image/tiff", "image/gif", "image/png"]
  },
  {
    "key": "PT06",
    "label": "Product Image 6",
    "description": "Alternate view.",
    "required": false,
    "min_width": 1000,
    "min_height": 1000,
    "recommended_width": 2000,
    "recommended_height": 2000,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 10,
    "allowed_mime_types": ["image/jpeg", "image/tiff", "image/gif", "image/png"]
  },
  {
    "key": "PT07",
    "label": "Product Image 7",
    "description": "Alternate view.",
    "required": false,
    "min_width": 1000,
    "min_height": 1000,
    "recommended_width": 2000,
    "recommended_height": 2000,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 10,
    "allowed_mime_types": ["image/jpeg", "image/tiff", "image/gif", "image/png"]
  },
  {
    "key": "PT08",
    "label": "Product Image 8",
    "description": "Alternate view.",
    "required": false,
    "min_width": 1000,
    "min_height": 1000,
    "recommended_width": 2000,
    "recommended_height": 2000,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 10,
    "allowed_mime_types": ["image/jpeg", "image/tiff", "image/gif", "image/png"]
  },
  {
    "key": "SWCH",
    "label": "Swatch Image",
    "description": "Colour or pattern swatch displayed on the variant selector.",
    "required": false,
    "min_width": 30,
    "min_height": 30,
    "recommended_width": 100,
    "recommended_height": 100,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 1,
    "allowed_mime_types": ["image/jpeg", "image/png"]
  }
]'::jsonb
where slug = 'amazon';


-- ── Shopify ───────────────────────────────────────────────────
update public.integration_node_definitions
set image_requirements = '[
  {
    "key": "product",
    "label": "Product Image",
    "description": "Main product image displayed on the product detail page.",
    "required": true,
    "recommended_width": 2048,
    "recommended_height": 2048,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 20,
    "allowed_mime_types": ["image/jpeg", "image/png", "image/gif", "image/webp"],
    "notes": "Square images recommended. Shopify centre-crops non-square images in collection grids. Max 1 GB total per product."
  },
  {
    "key": "variant",
    "label": "Variant Image",
    "description": "Image displayed when a specific variant (size/colour) is selected.",
    "required": false,
    "recommended_width": 2048,
    "recommended_height": 2048,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 20,
    "allowed_mime_types": ["image/jpeg", "image/png", "image/gif", "image/webp"]
  },
  {
    "key": "thumbnail",
    "label": "Thumbnail",
    "description": "Small image used in collection pages, search results, and cart.",
    "required": false,
    "recommended_width": 800,
    "recommended_height": 800,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 5,
    "allowed_mime_types": ["image/jpeg", "image/png", "image/webp"]
  }
]'::jsonb
where slug = 'shopify';


-- ── WooCommerce ───────────────────────────────────────────────
update public.integration_node_definitions
set image_requirements = '[
  {
    "key": "featured",
    "label": "Featured Image",
    "description": "Main product image — equivalent to WooCommerce ''Product Image''.",
    "required": true,
    "recommended_width": 1200,
    "recommended_height": 1200,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 10,
    "allowed_mime_types": ["image/jpeg", "image/png", "image/webp"],
    "notes": "Optimal size depends on your theme. Square is safest."
  },
  {
    "key": "gallery",
    "label": "Gallery Image",
    "description": "Additional product images shown in the gallery carousel.",
    "required": false,
    "recommended_width": 1200,
    "recommended_height": 1200,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 10,
    "allowed_mime_types": ["image/jpeg", "image/png", "image/webp"]
  }
]'::jsonb
where slug = 'woocommerce';


-- ── eBay ──────────────────────────────────────────────────────
update public.integration_node_definitions
set image_requirements = '[
  {
    "key": "primary",
    "label": "Primary Image",
    "description": "First image shown in search results and at the top of the listing.",
    "required": true,
    "min_width": 500,
    "min_height": 500,
    "recommended_width": 1600,
    "recommended_height": 1600,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 7,
    "allowed_mime_types": ["image/jpeg", "image/png", "image/gif", "image/tiff", "image/bmp", "image/webp"],
    "notes": "No borders, watermarks, or text overlays. Pure white background recommended."
  },
  {
    "key": "gallery",
    "label": "Gallery Image",
    "description": "Additional listing images (eBay allows up to 24 images per listing).",
    "required": false,
    "min_width": 500,
    "min_height": 500,
    "recommended_width": 1600,
    "recommended_height": 1600,
    "aspect_ratio": "1:1",
    "max_file_size_mb": 7,
    "allowed_mime_types": ["image/jpeg", "image/png", "image/gif", "image/tiff", "image/bmp", "image/webp"]
  }
]'::jsonb
where slug = 'ebay';


-- ============================================================
-- 5. HELPER VIEW: product images with their readiness per channel
--    Useful for the product editor image panel.
--    Returns one row per (product_image × integration_slug).
-- ============================================================
create or replace view public.v_product_image_channel_status as
select
  pi.id                   as image_id,
  pi.product_id,
  pi.url                  as master_url,
  pi.image_type,
  pi.is_primary,
  pi.sort_order,
  pi.width                as master_width,
  pi.height               as master_height,
  pi.mime_type            as master_mime_type,
  pi.processing_status    as master_status,
  r.integration_slug,
  r.rendition_key,
  r.url                   as rendition_url,
  r.width                 as rendition_width,
  r.height                as rendition_height,
  r.status                as rendition_status,
  r.error_message         as rendition_error
from      public.product_images pi
left join public.product_image_renditions r on r.image_id = pi.id;
