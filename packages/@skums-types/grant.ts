/**
 * Grant — a verifiable, scoped, revocable authorization from one
 * entity (granter) to another (grantee) to act on a set of SKUs.
 *
 * Grants form a chain. A brand grants a distributor; that distributor
 * sub-grants a retailer; that retailer grants a channel seller. Every
 * SKU listing on every channel can be traced back to a verified brand
 * via its grant chain — that traceability is the moat.
 *
 * In the permissionless model, anyone can sign up and operate. Grants
 * become valuable when a brand reaches verification tier 1 or 2 — at
 * that point, downstream entities in the grant chain inherit the
 * "verified" trust signal.
 *
 * Light enforcement at first (data structure + UI for visibility);
 * full enforcement (block API actions outside the grant chain) comes
 * later once grant management UX is proven.
 */

import type { ChannelId, MarketCode } from './perspective'

export type EntityId = string  // workspace_id of the participating entity

export type GrantStatus = 'active' | 'expired' | 'revoked' | 'pending'

export type Exclusivity =
  | 'exclusive'      // No other grants for this scope
  | 'non_exclusive'  // Multiple grantees allowed
  | 'preferred'      // Multiple allowed but this one has preference

export type SkuScope =
  | { mode: 'all_skus' }                       // All current and future SKUs of granter
  | { mode: 'specific_skus'; sku_ids: string[] }
  | { mode: 'category'; category_ids: string[] }
  | { mode: 'brand'; brand_ids: string[] }

export interface PricingConstraints {
  min_price?: number     // floor — grantee cannot list below this
  max_price?: number     // ceiling
  map_price?: number     // minimum advertised price (display floor)
  currency?: string      // currency these constraints are denominated in
}

export interface GrantPermissions {
  can_subgrant: boolean              // Can the grantee further grant downstream?
  can_edit_fields: string[]           // Field paths the grantee may override (e.g., ['retail_price', 'short_description'])
  can_view_cost: boolean              // Visibility of cost_price
  can_view_margin: boolean
  can_publish_to_channels: ChannelId[] // Channels the grantee is authorized to list on
}

export interface Grant {
  id: string

  // The chain
  granted_by: EntityId      // upstream entity issuing the grant
  granted_to: EntityId      // downstream recipient
  parent_grant_id: string | null  // null = root grant from brand; otherwise links upstream

  // Scope
  sku_scope: SkuScope
  territories: MarketCode[]            // empty = no territorial restriction
  channel_scope: ChannelId[]            // which channels the grant applies to
  exclusivity: Exclusivity

  // Constraints
  pricing_constraints?: PricingConstraints
  permissions: GrantPermissions

  // Lifecycle
  status: GrantStatus
  effective_from: Date
  expires_at: Date | null   // null = no expiry
  revocable: boolean         // Some grants (e.g., long-term distributor contracts) may be irrevocable
  revoked_at: Date | null
  revoked_by: EntityId | null
  revocation_reason: string | null

  // Audit
  created_at: Date
  signed_at: Date            // When grantee accepted (signed receipt)
  signed_by_user_id: string | null

  // Optional human-readable label
  label?: string             // e.g., "Japan Distribution Agreement 2026"
  notes?: string
}

/**
 * Result of walking a grant chain from a downstream entity back to the brand.
 * Used to verify whether a given action (list this SKU on this channel in this territory)
 * is authorized.
 */
export interface GrantChainTrace {
  sku_id: string
  acting_entity: EntityId
  chain: Grant[]                       // ordered: brand → ... → acting_entity
  is_complete: boolean                  // chain reaches a verified brand
  brand_entity_id: EntityId | null
  brand_verification_tier: number       // 0/1/2
  effective_permissions: GrantPermissions  // intersection across the chain (most restrictive wins)
  effective_pricing: PricingConstraints | null
  effective_exclusivity: Exclusivity | null
  authorized_channels: ChannelId[]
  authorized_territories: MarketCode[]
}

/**
 * The result of an authorization check.
 */
export interface AuthorizationResult {
  authorized: boolean
  reason?: string                       // populated when authorized=false
  trace?: GrantChainTrace                // populated when chain was inspected
}
