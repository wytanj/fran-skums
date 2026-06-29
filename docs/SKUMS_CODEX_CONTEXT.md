# SKUMS Codex Context

## Project

**SKUMS** is a SKU / product identity management system intended to disrupt traditional PIMs, Shopify-like merchant product systems, and GS1-like product identity infrastructure.

The strategic ambition is not merely to build “another PIM.” The larger opportunity is to become the **open product identity graph and automation layer for commerce**.

Codex should treat this file as strategic/product context while studying the existing codebase.

---

## One-line thesis

SKUMS should become the canonical layer where products, SKUs, variants, barcodes, supplier records, marketplace listings, compliance data, and provenance events are modeled, synchronized, automated, and eventually verified.

---

## Core problem

Product data today is fragmented across many systems:

- Shopify
- Amazon
- TikTok Shop
- Shopee / Lazada
- ERPs
- WMS / warehouse systems
- Supplier spreadsheets
- Marketplaces
- GS1 / barcode registries
- Retailer portals
- Internal spreadsheets

A SKU in one system does not reliably map to a SKU, GTIN, listing, variant, pack, or supplier record in another system.

Current pain points:

- Duplicate SKUs
- Inconsistent variant structures
- Messy supplier catalogs
- Broken marketplace sync
- Manual attribute enrichment
- Weak provenance / verification
- Poor auditability
- Expensive or rigid PIMs
- GS1 identity is useful but static, centralized, and not developer-native

---

## Strategic positioning

Avoid positioning as:

> AI PIM for ecommerce brands

Better positioning:

> The programmable product graph for modern commerce

Alternative positioning:

> Open product identity and automation infrastructure for commerce

Or:

> The canonical SKU graph, sync engine, and verification layer for product data

---

## Lessons from Harvey, Legora, and Hargora / Mike OSS

The legal AI market shows an important pattern:

1. **Harvey** proved elite vertical AI can command massive enterprise value.
2. **Legora** proved fast product-led challengers can compete with better workspace UX and collaboration.
3. The **Hargora** meme showed category convergence: Harvey and Legora began to look like similar closed enterprise AI platforms.
4. **Mike OSS / hargora.ai** showed that the visible app layer can be open-sourced and commoditized.

Lesson for SKUMS:

> Do not rely on the UI app layer as the moat.

A product table, AI attribute generation, CSV import, Shopify sync, variant editor, and workflow templates can be copied.

The defensible layer should be:

- product graph model
- identity layer
- sync engine
- data validation
- audit logs
- permissions
- verification / attestations
- network effects
- app ecosystem
- trusted registry

---

## Open vs closed model

A fully closed SaaS may generate revenue faster but risks becoming just another PIM.

A fully open protocol is too hard to monetize and too slow to coordinate at the beginning.

Recommended model:

## Open-core + managed cloud

### Open layer

Should be free/open to encourage adoption:

- Product graph schema
- SKU / product identity format
- SDKs
- CLI
- Self-hosted local registry
- Basic import/export tools
- Connector framework
- Event format
- Basic UI
- BYO model key support for local AI workflows

### Paid layer

Should be monetized:

- Hosted cloud
- Team collaboration
- Permissions / RBAC
- Version history
- Approval workflows
- Audit logs
- High-scale API usage
- Managed sync engine
- AI enrichment workflows
- Marketplace connectors
- Supplier portal
- Compliance modules
- Verified product registry
- Enterprise SSO / SLAs
- Data intelligence

Strategic principle:

> Open the standard. Monetize the network, operations, trust, and managed infrastructure.

---

## Core vs apps

The core should be thin and stable.

The core should own:

- identity
- product graph
- relationships
- permissions
- events
- versioning
- sync primitives
- validation primitives

Everything else should be modular apps or extensions.

Examples of apps:

- Shopify connector
- Amazon connector
- TikTok Shop connector
- Shopee / Lazada connector
- ERP connector
- GS1 / barcode app
- AI enrichment app
- Supplier portal
- Compliance checker
- Nutrition label generator
- Product passport app
- Carbon tracking app
- Barcode printing app
- Image/media enrichment app

Reason:

A shoe SKU, cosmetic SKU, food SKU, electronic SKU, and pharma SKU have very different attributes and compliance needs.

Do not bloat the core with every vertical-specific attribute.

---

## Suggested domain model

SKUMS should likely be graph-based, not merely table-based.

Important entities:

- Organization
- Brand
- Product
- Variant
- SKU
- GTIN / barcode
- Listing
- Channel
- Supplier
- Manufacturer
- Factory
- Component
- Bundle
- Pack / case / pallet
- Inventory unit
- Media asset
- Taxonomy node
- Attribute definition
- Attribute value
- Certification
- Compliance document
- Claim
- Attestation
- Provenance event
- Price
- Market / region
- Translation / locale
- Sync job
- External mapping
- Audit event

Important relationships:

- Product has variants
- Variant has SKUs
- SKU maps to GTINs
- SKU maps to channel listings
- Product belongs to brand
- Product sourced from supplier
- Product manufactured at factory
- Product has components
- Product has compliance claims
- Product has media assets
- Product available in markets
- Listing derived from product/variant/SKU
- External system record maps to internal canonical identity
- Attribute belongs to schema/taxonomy/vertical
- Provenance event updates or verifies a claim

---

## Identity strategy

Possible identity layers:

1. Internal SKUMS ID
2. Organization-scoped SKU
3. Brand-scoped product ID
4. Public SKUMS Product ID
5. External IDs: GTIN, UPC, EAN, ASIN, Shopify product ID, marketplace listing ID, ERP item ID
6. Verified product identity

Recommended approach:

- Internal IDs should be free and easy.
- Public product identities should be cheap/free to encourage adoption.
- Verified identities should be paid.
- External mappings should be first-class.
- Never assume one SKU equals one product.
- Never assume one GTIN equals one internal SKU in all contexts.

---

## Blockchain stance

Do not make blockchain mandatory.

Blockchain should not be the product.

Useful blockchain-adjacent features:

- signed product records
- immutable audit logs
- verifiable credentials
- attestations
- optional on-chain anchoring
- product passports for high-trust categories

Useful categories:

- luxury goods
- pharma
- food traceability
- electronics
- regulated goods
- carbon/sustainability claims
- anti-counterfeit workflows

Default approach:

> Build cryptographic verification first; add blockchain anchoring only where it creates real customer value.

---

## Revenue options

SKUMS can monetize through multiple layers.

### 1. SaaS workspace

Customers:

- brands
- retailers
- distributors
- ecommerce operators

Pricing:

- per seat
- per company
- per SKU volume
- tiered plans

Example:

- Free: 100 SKUs, basic registry, CSV import
- Starter: $29–99/month
- Growth: $199–499/month
- Business: $999–2,500/month
- Enterprise: $25k–250k+/year

### 2. Product graph API

Customers:

- developers
- platforms
- marketplaces
- agencies

Pricing:

- usage-based API calls
- product lookups
- writes/updates
- sync events
- webhook events

### 3. Hosted product registry

Customers:

- brands
- suppliers
- marketplaces

Pricing:

- per active SKU
- per public product identity
- per verified product identity

Suggested principle:

- internal SKU IDs: free
- public product IDs: free/cheap
- verified product records: paid

### 4. AI enrichment

AI workflows:

- product title generation
- attribute extraction
- supplier spreadsheet normalization
- taxonomy mapping
- variant detection
- duplicate detection
- marketplace listing generation
- translations
- compliance warnings

Pricing:

- credits
- per SKU
- monthly included allowance
- premium workflows
- BYO model key for open/self-hosted users

### 5. Sync engine

Charge for:

- channels
- integrations
- sync volume
- premium connectors

Examples:

- Shopify connector
- Amazon connector
- TikTok Shop connector
- NetSuite connector
- SAP/Oracle connector

### 6. Verification and trust

Charge for:

- brand verification
- product identity verification
- supplier verification
- certificate attestation
- authenticity checks
- regulated product verification

This is one of the most defensible revenue lines.

### 7. Compliance modules

Vertical modules:

- food
- cosmetics
- electronics
- apparel
- pharma/medical
- sustainability

Pricing:

- monthly module fee
- regional compliance packs
- per-document validation
- enterprise workflows

### 8. Supplier network

Charge for:

- supplier portal
- supplier profiles
- verified supplier catalogs
- product data syndication
- network access

This creates marketplace/network effects.

### 9. App marketplace

Charge:

- app marketplace take rate
- developer platform fee
- certification fee
- enterprise app distribution

### 10. Services

Early revenue and learning:

- SKU cleanup
- migration
- custom connector development
- supplier onboarding
- taxonomy design
- compliance setup

Long term, these should move to partners.

### 11. Data intelligence

Later-stage revenue:

- category normalization intelligence
- product taxonomy data
- duplicate detection
- marketplace listing quality
- supplier reliability
- compliance risk scoring

Must be handled with privacy and permission controls.

### 12. Transaction revenue

Long-term upside:

- wholesale ordering
- supplier payments
- procurement
- trade financing referrals
- logistics referrals
- certification transactions

Do not start here; earn trust and data gravity first.

---

## Recommended monetization sequence

### Phase 1

SaaS + AI cleanup + Shopify sync

Goal:

- get users
- create revenue
- learn workflows

### Phase 2

API + sync engine + hosted product graph

Goal:

- become operational infrastructure
- support developers and platforms

### Phase 3

Verified product registry + supplier network

Goal:

- build GS1-like defensibility
- create trust network effects

### Phase 4

Apps + data syndication + transactions

Goal:

- become the product identity platform for commerce

---

## Suggested initial products

### SKUMS Cloud

For brands/operators.

Includes:

- product graph
- SKU / variant management
- AI cleanup
- Shopify sync
- CSV importer
- version history
- team workflows

### SKUMS API

For developers/platforms.

Includes:

- product identity API
- product lookup
- product graph writes
- webhooks
- sync API
- SDKs

### SKUMS Verify

For brands/suppliers/regulated categories.

Includes:

- verified brand namespace
- verified product records
- signed attestations
- product passport
- compliance evidence
- optional blockchain anchoring

Simple narrative:

> Manage product data. Connect product data. Verify product data.

---

## Product/engineering implications for Codex

When reviewing the existing codebase, look for whether the implementation supports the long-term thesis.

Important questions:

1. Is the data model graph-like or just a flat product/SKU table?
2. Are external IDs and mappings first-class?
3. Can different organizations maintain separate SKU namespaces?
4. Can one product have many variants, SKUs, packs, listings, and external mappings?
5. Is the schema extensible by vertical/category?
6. Are attributes typed and versioned?
7. Is there a clear event/audit log model?
8. Are sync jobs modeled explicitly?
9. Is there a plugin/app/connector architecture?
10. Is the API designed as infrastructure, or only as UI backend endpoints?
11. Are permissions/RBAC designed for supplier collaboration?
12. Is AI enrichment separated as workflows/actions rather than embedded ad hoc in UI code?
13. Is verification/attestation possible later without rewriting the system?
14. Are imports/exports treated as core infrastructure?
15. Can the system support both hosted and self-hosted/open-core modes later?

---

## What Codex should prioritize when studying the code

### First pass: map current architecture

Identify:

- frontend framework
- backend framework
- database
- ORM
- auth
- deployment assumptions
- existing entities/models
- API routes
- import/export logic
- AI integrations
- marketplace integrations
- sync logic
- test coverage

### Second pass: assess strategic fit

Classify code into:

- core product graph
- app/UI layer
- connector/sync layer
- AI workflow layer
- verification/trust layer
- infrastructure/auth/billing

### Third pass: find gaps

Look for missing abstractions:

- Organization
- Product
- Variant
- SKU
- ExternalMapping
- Channel
- Listing
- Supplier
- AttributeDefinition
- AttributeValue
- Taxonomy
- SyncJob
- AuditEvent
- Attestation
- ComplianceDocument

### Fourth pass: propose refactor plan

Prefer incremental refactors.

Avoid rewriting everything unless necessary.

Propose:

- model changes
- API boundary changes
- migration plan
- tests
- seed data
- developer docs
- next implementation milestone

---

## Good MVP direction

A strong MVP should probably include:

1. Organization-scoped product/SKU registry
2. Product → variant → SKU hierarchy
3. External mappings for Shopify/marketplace/GTIN/etc.
4. CSV import and cleanup
5. AI-assisted attribute extraction
6. Version history / audit events
7. Basic Shopify sync
8. Extensible attributes
9. API-first product graph endpoints
10. Early connector abstraction

Avoid overbuilding:

- blockchain
- app marketplace
- full supplier network
- complex compliance engine
- token economics
- complete GS1 replacement

---

## Strategic north star

SKUMS should move through this path:

1. Better SKU manager
2. AI product data cleanup tool
3. Product graph and sync engine
4. Open product identity schema
5. Verified product registry
6. Supplier/product data network
7. Commerce product identity infrastructure

---

## Key warning

If SKUMS is only:

- a product table
- AI-generated descriptions
- CSV importer
- Shopify sync

then it is easy to clone.

If SKUMS owns:

- canonical product identity
- graph relationships
- external mappings
- sync reliability
- verification
- supplier collaboration
- app ecosystem
- trusted product registry

then it can become infrastructure.

---

## Codex instruction

When analyzing the repository, do not only inspect for bugs. Evaluate whether the existing code can evolve into the architecture above.

Produce recommendations in this order:

1. Current architecture summary
2. Existing domain model summary
3. Strategic fit assessment
4. Major gaps
5. Recommended next refactors
6. Suggested data model / schema changes
7. Suggested API changes
8. Suggested tests
9. Next 1-week build plan
10. Longer-term product architecture plan
