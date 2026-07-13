-- ============================================================
-- Help articles (platform product help)
--
-- Global, published articles for in-app Help + Catalog AI
-- resolve_help tool. Update via new seed upserts or SQL as
-- features ship.
--
-- Run AFTER: 052
-- ============================================================

create table if not exists public.help_articles (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  summary       text,
  body_md       text not null,
  category      text not null default 'general'
                  check (char_length(category) between 1 and 64),
  primary_path  text,
  related_paths text[] not null default '{}',
  intent_tags   text[] not null default '{}',
  sort_order    int not null default 100,
  published     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_help_articles_published_category
  on public.help_articles (published, category, sort_order);

create index if not exists idx_help_articles_intent_tags
  on public.help_articles using gin (intent_tags);

create index if not exists idx_help_articles_slug_trgm
  on public.help_articles using gin (slug gin_trgm_ops);

create index if not exists idx_help_articles_title_trgm
  on public.help_articles using gin (title gin_trgm_ops);

comment on table public.help_articles is
  'Platform help articles for in-app Help center and assistant resolve_help';

alter table public.help_articles enable row level security;

drop policy if exists "Authenticated users read published help" on public.help_articles;
create policy "Authenticated users read published help"
  on public.help_articles for select
  to authenticated
  using (published = true);

-- Service role / migrations write freely (bypass RLS)

-- ------------------------------------------------------------
-- Seed / upsert core articles (idempotent by slug)
-- ------------------------------------------------------------

insert into public.help_articles (
  slug, title, summary, body_md, category, primary_path, related_paths, intent_tags, sort_order
) values
(
  'getting-started',
  'Getting started with Fran SKUMS',
  'Where to land after login and what the main areas of the app do.',
  $md$
## Overview

Fran SKUMS is your product catalog, inventory, and operations hub. After login you work inside a **workspace**.

## Start here

1. Confirm the correct **workspace** in the left sidebar.
2. Open **Dashboard** for queue counts and shortcuts.
3. Use **Products** for catalog master data (titles, SKUs, prices).
4. Use **Inventory** for stock quantities and warehouse POs.
5. Use **Actions** to review AI/MCP drafts (decision POs and pipeline).

## Catalog AI vs Help

- **Help** (this section) — deterministic how-to articles and links.
- **Catalog AI** (sidebar / floating button) — live questions on *your* data (counts, search, inventory).
- **MCP** (Cursor / `npm run mcp`) — external agents that draft work; humans still approve in **Actions**.

## Next reads

- [Edit products](/help/edit-products)
- [Import a catalog](/help/import-catalog)
- [Approve drafts in Actions](/help/actions-inbox)
$md$,
  'getting-started',
  '/',
  array['/products', '/actions', '/help'],
  array['start', 'intro', 'overview', 'home', 'dashboard', 'where', 'begin', 'onboarding'],
  10
),
(
  'edit-products',
  'Edit products',
  'Find and change product master data (title, SKU, price, status).',
  $md$
## Where to go

**Sidebar → Products** → open a product → edit → **Save changes**.

| Goal | Path |
|------|------|
| List / search products | [/products](/products) |
| Create product | [/products/new](/products/new) |
| Edit one product | `/products/{id}` (open from the list) |

## Steps

1. Open **Products** in the left sidebar.
2. Search by title, SKU, or filter by status.
3. Click a row to open the product detail page.
4. Change fields (details, identifiers, pricing, status).
5. Click **Save changes**.

## POS note

Imports and pipeline-created products often stay **draft** with **POS off**. Use **Activate for POS** on the product page when the item should appear on the register catalog.

## Not here

- **Stock quantities / ATS** → [Inventory](/help/inventory-stock)
- **Bulk CSV/XLSX load** → [Import a catalog](/help/import-catalog)
- **Brand list only** → [Brands](/help/brands-categories)
$md$,
  'products',
  '/products',
  array['/products/new', '/import-export'],
  array['edit', 'product', 'products', 'change', 'update', 'catalog', 'sku', 'price', 'title', 'where', 'go', 'page'],
  20
),
(
  'import-catalog',
  'Import a catalog',
  'Bulk load supplier CSVs/XLSX into the product catalog.',
  $md$
## Where to go

**Sidebar → Import / Export** → [/import-export](/import-export)

## Steps

1. Open **Import / Export**.
2. Upload a CSV or XLSX (ABW and generic formats supported).
3. Map columns (title is required).
4. Preview, then run the import.
5. Review results; large jobs show progress on the import job.

## Defaults (important)

New import rows are created as **draft** with **POS off**. They will not appear on the POS catalog until you [activate products for POS](/help/activate-for-pos).

## After import

- Ask **Catalog AI**: “How many products?” or “Break down by status”.
- Edit individual rows under **Products**.
- Re-import upserts by SKU / catalog number when configured.
$md$,
  'products',
  '/import-export',
  array['/products'],
  array['import', 'export', 'csv', 'xlsx', 'upload', 'bulk', 'supplier', 'abw', 'dump', 'wholesale'],
  30
),
(
  'activate-for-pos',
  'Activate a product for POS',
  'Promote draft / POS-off products so they appear on the POS catalog.',
  $md$
## Where to go

Open the product → **Activate for POS**.

Path: [/products](/products) → product detail.

## Steps

1. Open **Products** and find the item (often status **draft** after import).
2. Open the product.
3. Click **Activate for POS** (sets status=active and POS sellable flags).
4. Confirm. The product can appear in the POS catalog API for active + POS-enabled items.

## Remove from POS

Use **Remove from POS** on the same page to clear POS flags without deleting the product.
$md$,
  'products',
  '/products',
  array['/products'],
  array['pos', 'activate', 'register', 'sellable', 'pos off', 'pos on', 'promote'],
  35
),
(
  'brands-categories',
  'Brands and categories',
  'Organize the catalog with brand and category masters.',
  $md$
## Where to go

| Area | Path |
|------|------|
| Brands | [/brands](/brands) |
| Categories | [/categories](/categories) |

## Steps

1. Open **Brands** or **Categories** in the sidebar.
2. Add or edit names (and brand website if needed).
3. Assign brands/categories on the product detail page.

Products can also receive brand/category from import column mapping.
$md$,
  'products',
  '/brands',
  array['/categories', '/products'],
  array['brand', 'brands', 'category', 'categories', 'organize', 'taxonomy'],
  40
),
(
  'inventory-stock',
  'Inventory and stock',
  'See on-hand, reserved, available, and warehouse purchase orders.',
  $md$
## Where to go

**Sidebar → Inventory** → [/inventory](/inventory)

## What you can do

- View inventory summary (on hand, reserved, available, in transit, on order).
- Manage **warehouse / inventory POs** (different from decision POs in Actions).
- Transfers and receiving flows live here.

## Not the same as Actions

| Surface | Purpose |
|---------|---------|
| **Inventory** | Physical stock and warehouse POs |
| **Actions** | Decision-layer internal POs from AI/MCP (approve buying intent) |

See [Actions inbox](/help/actions-inbox).
$md$,
  'inventory',
  '/inventory',
  array['/actions', '/store-ops'],
  array['inventory', 'stock', 'on hand', 'ats', 'warehouse', 'po', 'purchase order', 'transfer', 'low stock'],
  50
),
(
  'actions-inbox',
  'Actions inbox (drafts and approvals)',
  'Review MCP/AI drafts: internal POs and pipeline candidates.',
  $md$
## Where to go

**Sidebar → Actions** → [/actions](/actions)

## Tabs

- **Draft POs** — decision POs not yet submitted
- **Pending approval** — waiting for owner/admin
- **Pipeline proposed / ready to execute** — study pipeline candidates

## Roles

- **Member**: view, edit draft, submit for approval
- **Owner / admin**: approve or reject

## MCP flow

1. Agent creates a **draft** (e.g. clone PO, drop brands).
2. You open the deep link under **Actions**.
3. Review lines → Submit → Approve (if privileged).

Catalog AI can list the queue but does not silently approve for you.
$md$,
  'actions',
  '/actions',
  array['/inventory'],
  array['actions', 'approve', 'approval', 'draft', 'pending', 'mcp', 'pipeline', 'decision po', 'internal po', 'inbox'],
  60
),
(
  'store-ops',
  'Store operations',
  'Replenishment requests and store-floor ops workflows.',
  $md$
## Where to go

**Sidebar → Store Ops** → [/store-ops](/store-ops)

Use this for store replenishment requests, receiving-related workflows, and exceptions tied to store operations—not for editing product master data.
$md$,
  'operations',
  '/store-ops',
  array['/inventory', '/fran'],
  array['store', 'store ops', 'replenishment', 'store floor', 'request'],
  70
),
(
  'expiry',
  'Expiry tracking',
  'Batch expiry, LIFO, and microsites.',
  $md$
## Where to go

**Sidebar → Expiry** → [/expiry](/expiry)

Track batches, plan LIFO, and publish transparency microsites for selected products.
$md$,
  'operations',
  '/expiry',
  array['/products'],
  array['expiry', 'expire', 'batch', 'lifo', 'shelf life', 'best before'],
  80
),
(
  'forecasting',
  'Forecasting',
  'Demand forecasting views.',
  $md$
## Where to go

**Sidebar → Forecasting** → [/forecasting](/forecasting)

Use forecasting tools for demand signals. Catalog master data remains under **Products**.
$md$,
  'operations',
  '/forecasting',
  array['/inventory', '/products'],
  array['forecast', 'forecasting', 'demand'],
  90
),
(
  'product-quality',
  'Product quality',
  'Marketplace quality scoring and findings.',
  $md$
## Where to go

**Sidebar → Product Quality** → [/product-quality](/product-quality)

Review quality scores and marketplace-oriented findings for products.
$md$,
  'operations',
  '/product-quality',
  array['/products'],
  array['quality', 'scoring', 'marketplace quality'],
  100
),
(
  'schema-builder',
  'Schema builder',
  'Dynamic product field schemas per channel or use case.',
  $md$
## Where to go

**Sidebar → Schema Builder** → [/schema](/schema)

Define or assign JSON schemas that drive extra product fields. Assign a schema on the product detail page under **Schema & Data**.
$md$,
  'products',
  '/schema',
  array['/products'],
  array['schema', 'fields', 'dynamic schema', 'attributes'],
  110
),
(
  'integrations',
  'Integrations',
  'Connect Shopify, WooCommerce, fulfillment, and other nodes.',
  $md$
## Where to go

**Sidebar → Integrations** → [/integrations](/integrations)

Connect external systems, manage credentials, and run syncs. POS-facing catalog still comes from product status + POS flags.
$md$,
  'integrations',
  '/integrations',
  array['/api-explorer', '/settings'],
  array['integration', 'integrations', 'shopify', 'woocommerce', 'connect', 'sync', 'webhook'],
  120
),
(
  'api-explorer',
  'API Explorer',
  'Browse and try workspace API endpoints.',
  $md$
## Where to go

**Sidebar → API Explorer** → [/api-explorer](/api-explorer)

Use with API keys from **Settings** to call headless/POS/product APIs.
$md$,
  'integrations',
  '/api-explorer',
  array['/settings', '/integrations'],
  array['api', 'api key', 'openapi', 'developer', 'headless'],
  130
),
(
  'settings-team',
  'Settings, team, and AI',
  'Workspace profile, members, API keys, and Catalog AI preferences.',
  $md$
## Where to go

**Sidebar → Settings** → [/settings](/settings)

| Tab | Use |
|-----|-----|
| Profile / workspace | Names and workspace basics |
| Team | Invite members, roles |
| API keys | Keys for POS/API |
| AI Assistant | Catalog AI model, role framing, Slack webhook |

Owner/admin rights are required for sensitive team and approval actions.
$md$,
  'settings',
  '/settings',
  array['/help'],
  array['settings', 'team', 'invite', 'api key', 'assistant', 'ai settings', 'slack', 'role'],
  140
),
(
  'catalog-ai',
  'Catalog AI (in-app assistant)',
  'Ask live questions about your catalog and inventory inside SKUMS.',
  $md$
## Where to go

- Sidebar **Catalog AI**, or
- Floating sparkle button (bottom-right)

## Good questions

- “How many products are in this catalog?”
- “Break down products by status”
- “Search draft products for brand X”
- “What is in my Actions queue?”

## Rules of thumb

- Counts come from live tools (never invented).
- For **where do I click?** prefer **Help** articles — Catalog AI will point you here.
- MCP in Cursor is a different surface; see [MCP vs Catalog AI](/help/mcp-vs-catalog-ai).
$md$,
  'ai',
  '/help',
  array['/help', '/settings'],
  array['assistant', 'catalog ai', 'chat', 'ask', 'ai', 'grok', 'help me'],
  150
),
(
  'mcp-vs-catalog-ai',
  'MCP vs Catalog AI',
  'When to use the in-app assistant vs external MCP agents.',
  $md$
## Two AI surfaces

| Surface | Where | Best for |
|---------|--------|----------|
| **Catalog AI** | In-app drawer | Live catalog/inventory Q&A on your workspace |
| **MCP** | Cursor / Claude / `npm run mcp` | Study, draft POs, pipeline, marketplace BI |
| **Actions** | [/actions](/actions) | Human submit/approve of agent drafts |
| **Help** | [/help](/help) | How-to and navigation (this site) |

Both AI surfaces use the same Supabase data and xAI key where configured. They do not replace each other.
$md$,
  'ai',
  '/help',
  array['/actions', '/settings'],
  array['mcp', 'cursor', 'claude', 'agent', 'external', 'vs assistant'],
  160
),
(
  'fran-ops',
  'Fran Ops',
  'Fran-specific operations entry point.',
  $md$
## Where to go

**Sidebar → Fran Ops** → [/fran](/fran)

Fran-facing ops and shortcuts. Generic catalog work still uses **Products**, **Inventory**, and **Store Ops**.
$md$,
  'operations',
  '/fran',
  array['/store-ops', '/products'],
  array['fran', 'fran ops', 'loyalty', 'crm'],
  170
)
on conflict (slug) do update set
  title = excluded.title,
  summary = excluded.summary,
  body_md = excluded.body_md,
  category = excluded.category,
  primary_path = excluded.primary_path,
  related_paths = excluded.related_paths,
  intent_tags = excluded.intent_tags,
  sort_order = excluded.sort_order,
  published = true,
  updated_at = now();
