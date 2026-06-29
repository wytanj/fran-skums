/**
 * AppManifest — the declaration a vertical app makes about itself.
 *
 * Vertical apps (Skincare Intelligence, Healthy Food Intelligence,
 * Supplements Intelligence, Mechanical Keyboards Intelligence, etc.)
 * are pluggable modules that enrich the canonical SKU master with
 * industry-specific fields, scoring, and reference data.
 *
 * An app is opt-in per workspace. When enabled, its enrichments
 * appear in projections for relevant industries; when disabled, the
 * app contributes nothing.
 *
 * Apps deliver code via Nuxt layers: pages, components, server
 * routes, and SQL migrations are colocated under apps/<id>/.
 */

import type { IndustryId } from './perspective'

/**
 * A field this app contributes to the canonical SKU when enabled.
 * Apps cannot redefine core fields — only add to or read from them.
 */
export interface AppFieldExtension {
  type: 'string' | 'number' | 'boolean' | 'jsonb' | 'array'
  description?: string
  readonly?: boolean       // computed by app, user cannot edit
  default?: unknown
  scope?: 'sku' | 'variant' | 'batch'  // which entity the field attaches to
}

export interface AppRoutes {
  ui: string[]              // page route patterns mounted under /apps/<id>/...
  api: string[]             // API route patterns mounted under /api/apps/<id>/...
  webhooks?: string[]       // webhook event types this app emits
}

export interface AppCapabilities {
  scrapers?: string[]              // ids of scrapers this app provides
  scoring_engines?: string[]       // ids of scoring engines this app provides
  enrichments?: string[]           // names of enrichment passes this app applies
  channel_adapters?: string[]      // (rare) channel adapters bundled with this app
}

export interface AppRequirements {
  core_version: string             // semver range, e.g. ">=1.0.0"
  permissions: string[]             // required scopes ('products:read', 'products:enrich', etc.)
  reference_data?: boolean          // requires global reference data (must be seeded)
}

export type AppAvailability =
  | 'all_tiers'        // Available to any workspace, including unverified.
  | 'verified_only'    // Requires verification tier ≥ 1.
  | 'enterprise_only'  // Requires verification tier 2 + paid plan.

export interface AppManifest {
  id: string                       // 'skincare', 'healthy_food', 'supplements', etc.
  name: string                     // Display name
  short_description: string
  long_description?: string
  icon?: string                    // path or URL
  vendor?: string                  // 'SKUMS Official' or third-party

  // Which industries this app is relevant for. A workspace's perspective
  // includes one or more IndustryIds; only apps whose `industries` overlap
  // contribute to the projection.
  industries: IndustryId[]

  // What this app extends in core
  extends?: {
    products?: Record<string, AppFieldExtension>
    variants?: Record<string, AppFieldExtension>
    batches?: Record<string, AppFieldExtension>
  }

  // What this app provides
  provides: {
    routes: AppRoutes
    capabilities?: AppCapabilities
  }

  // What this app needs from core
  requires: AppRequirements

  // Pricing / availability
  availability: AppAvailability

  // App version
  version: string                  // semver
}
