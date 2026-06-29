# SKUMS Channels

Channel adapters are the **last mile** that delivers SKU data from the
canonical master out to marketplaces, storefronts, and B2B systems.

Each adapter implements the `ChannelAdapter` contract (defined in
`@skums/types`) and self-registers into the channel registry.

## Channels vs Scrapers

These are **different concepts**. Don't confuse them.

| | Channel Adapter | Scraper |
|---|---|---|
| **API source** | Official partner API (OAuth, REST, EDI) | Scraping HTML pages |
| **Direction** | Bidirectional (push + pull) | Read-only |
| **Reliability** | Production-grade (TOS-compliant) | Best-effort (breaks on layout changes) |
| **Where it lives** | `channels/` | `server/utils/scrapers/` (current location, may relocate) |
| **Use case** | Listing publication, order sync, inventory updates, feed generation | Competitive monitoring, catalog discovery, grey market detection |

A channel might have **both** an adapter (for partners with API access)
and a scraper (for monitoring listings on the same channel that aren't
ours). They serve different purposes.

## Adapter Layout

Each adapter lives in its own directory:

```
channels/<id>/
├── index.ts             # Default export of the adapter object
├── adapter.ts           # Implements ChannelAdapter contract
├── auth.ts              # OAuth flow / credential management
├── sync/
│   ├── push.ts          # SKUMS → channel
│   ├── pull.ts          # channel → SKUMS
│   └── conflict.ts      # Conflict resolution rules
├── feed.ts              # Feed generation (for downstream sellers)
├── mapping.ts           # SKUMS → channel field mapping (and reverse)
├── validation.ts        # Pre-publish validation rules
└── webhooks.ts          # Inbound webhook handlers (if applicable)
```

## How to Build a New Adapter

1. Create a directory under `channels/<id>/` (snake-case, market-suffixed if applicable: `shopee_sg`, `shopee_tw`).
2. Implement the `ChannelAdapter` contract from `@skums/types`.
3. Export the implementation as the default from `index.ts`.
4. Add an import + register call in `_imports.ts` (one line).
5. Document any channel-specific quirks in a `<id>/README.md`.

## Validation Rules

Every adapter must implement `validate(sku: ProjectedSku): ValidationResult`.
This pre-publish check should catch:

- Required fields missing (Amazon needs UPC, Shopify needs handle, etc.)
- Field length / format violations
- Image quality / count requirements
- Pricing constraints (min/max, currency mismatch)
- Channel-specific compliance (Shopee Mall requires brand certificate, etc.)

A push without passing validation should never be attempted.

## Authentication

Each channel has its own auth flow. Common types:

| Type | Used by |
|------|---------|
| OAuth 2.0 | Shopify, Shopee, Amazon SP-API, Lazada Open Platform |
| API key (static) | Some Shopify private apps, custom integrations |
| EDI credentials | B2B retailer EDI gateways (NTUC, Cold Storage, etc.) |
| Partner token | TikTok Shop |

Credentials are stored in the existing `integration_credentials` table
(see `core/db/012_integration_framework.sql`) — encrypted, scoped per
workspace.

## First Adapter: Shopee

Shopee will be the first deeply-built adapter. Justification:

- **Validating customer (healthy food brand)** ships into both SG and
  TW Shopee storefronts.
- **Skincare retailer** also relies heavily on Shopee.
- Shopee has comprehensive Open Platform APIs for both product management
  and Brand Protection.
- Doing one channel deeply sets the bar for every future adapter.

See `channels/shopee/` (to be created) for the implementation plan.

## Planned Adapters

Order driven by validating customer needs:

1. **Shopee SG / TW** — first, both healthy food brand and skincare retailer use it
2. **Shopify** — D2C side for healthy food brand
3. **B2B EDI (NTUC / supermarket spec)** — supermarket side for healthy food brand
4. **TikTok Shop** — high-growth, both verticals
5. **Lazada SG / TW** — companion to Shopee
6. **Amazon SG / JP** — enterprise customers

## Status

**Scaffolding only.** No adapters implemented yet. The contract
(`_types.ts`) and registry (`_registry.ts`) are in place. First real
adapter (Shopee) is Phase E of the structural migration.
