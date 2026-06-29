/**
 * Skincare Intelligence — App Manifest
 *
 * The first vertical app on the SKUMS platform. Provides
 * skincare-specific intelligence on top of the canonical SKU master:
 *
 *   - Ingredient Profile Score (IPS) 0-100
 *   - Skin type fit (dry, oily, combination, sensitive, acne)
 *   - Concern tagging (hydration, brightening, anti-aging, etc.)
 *   - Cross-sensitivity / usage conflict detection
 *   - Lifecycle stage classification
 *   - Ingredient trend signal
 *
 * This manifest declares what the app is. It does not yet drive
 * runtime behavior — the app registry that consumes manifests is
 * planned for Phase C of the structural migration. For now, this
 * file documents the app's identity and contract.
 */

import type { AppManifest } from '../../packages/@skums-types/app-manifest'

const manifest: AppManifest = {
  id: 'skincare',
  name: 'Skincare Intelligence',
  short_description: 'Ingredient analysis, IPS scoring, skin type fit, and conflict detection for skincare and cosmetics SKUs.',
  long_description: `
Skincare Intelligence enriches every skincare/cosmetics SKU with:

• Ingredient Profile Score (IPS) 0-100 — based on ingredient tier (gold-standard
  actives like retinol, vitamin C, niacinamide), Hwahae blacklist penalties,
  and EWG hazard scores.

• Skin type fit — how well the product serves dry, oily, combination,
  sensitive, and acne-prone skin, derived from ingredient analysis and review
  sentiment.

• Concern coverage — which of the eight Hwahae-aligned skincare concerns
  (hydration, soothing, brightening, anti-aging, pore care, acne,
  exfoliation, moisturizing) the product addresses.

• Conflict detection — flags products containing ingredients in known
  cross-sensitivity families (formaldehyde releasers, isothiazolinones,
  fragrance allergens, asteraceae botanicals, etc.) and pairwise usage
  conflicts (retinol + AHA, vitamin C + benzoyl peroxide, etc.).

• Lifecycle stage — classifies products as launch/rising/mature/hall-of-fame/
  declining/revived based on age, review momentum, and rating trend.

Reference data is sourced from the Hwahae taxonomy (Korea's #1 beauty data
platform), EWG Skin Deep, and dermatological cross-reactivity research.
`.trim(),
  vendor: 'SKUMS Official',
  version: '0.2.0',

  industries: ['skincare', 'cosmetics'],

  extends: {
    products: {
      ips_score: {
        type: 'number',
        description: 'Ingredient Profile Score 0-100. Higher = cleaner formulation.',
        readonly: true,
        scope: 'sku',
      },
      skin_type_fit: {
        type: 'jsonb',
        description: 'Per-skin-type fit scores 0.0-1.0: { dry, oily, combination, sensitive, acne }.',
        readonly: true,
        scope: 'sku',
      },
      concern_tags: {
        type: 'array',
        description: 'Skincare concerns this product addresses, drawn from the Hwahae taxonomy.',
        readonly: true,
        scope: 'sku',
      },
      top_tier_ingredient: {
        type: 'string',
        description: 'Highest-tier proven active found in the formulation: tier1, tier2, tier3, or tier4.',
        readonly: true,
        scope: 'sku',
      },
      lifecycle_stage: {
        type: 'string',
        description: 'launch | rising | mature | hall_of_fame | declining | revived',
        readonly: true,
        scope: 'sku',
      },
      ingredient_trend_signal: {
        type: 'string',
        description: 'rising | stable | declining — based on the strongest active in the formulation.',
        readonly: true,
        scope: 'sku',
      },
      conflict_flags: {
        type: 'jsonb',
        description: 'Array of detected ingredient conflicts: [{ family, ingredients }]',
        readonly: true,
        scope: 'sku',
      },
    },
  },

  provides: {
    routes: {
      ui: ['/apps/skincare', '/apps/skincare/url-analyse', '/apps/skincare/methodology'],
      api: [
        '/api/apps/skincare/products',
        '/api/apps/skincare/product/[id]',
        '/api/apps/skincare/stats',
        '/api/apps/skincare/url-analyse',
      ],
    },
    capabilities: {
      scoring_engines: ['ips', 'skin-type-fit', 'conflict-detection', 'lifecycle-stage'],
      enrichments: ['ingredient_safety', 'concern_tagging', 'pairwise_conflict_check'],
      // Scrapers are deferred — they currently only run locally and are not
      // production-deployable on Vercel. Will be re-added once the scraping
      // architecture is resolved (see docs/SCRAPING_DEPLOYMENT_OPTIONS.md
      // and docs/SCRAPE_WITH_GSTACK.md).
      scrapers: [],
    },
  },

  requires: {
    core_version: '>=0.1.0',
    permissions: ['products:read', 'products:enrich'],
    reference_data: true,  // requires ingredient_safety + concerns + conflict tables seeded
  },

  availability: 'all_tiers',
}

export default manifest
