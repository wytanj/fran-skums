/**
 * Perspective — the multi-dimensional context that determines what
 * a user, API caller, or system sees when they look at a SKU.
 *
 * Same canonical SKU + different Perspective = different projection.
 *
 * Example: a Korean skincare retailer and a Japanese health-food
 * distributor querying the same SKU receive completely different
 * field shapes, locales, currencies, and authority levels — but
 * both projections derive deterministically from one canonical row.
 *
 * The Perspective is resolved at the auth boundary (API key / session)
 * and injected into every request. Endpoints and UI never have to
 * ask "which currency?" or "which language?" — they know.
 */

export type Locale = string  // BCP-47 tag: 'ko-KR', 'ja-JP', 'zh-TW', 'en-SG', etc.
export type MarketCode = string  // ISO 3166-1 alpha-2: 'KR', 'JP', 'TW', 'SG'
export type CurrencyCode = string  // ISO 4217: 'KRW', 'JPY', 'TWD', 'SGD'

export type Role =
  | 'brand'           // Owns the canonical SKU. Full edit authority.
  | 'distributor'     // Granted access by a brand. Manages allocation, regional pricing.
  | 'retailer'        // Granted by distributor or brand. Manages local channels.
  | 'channel_seller'  // Bottom of the chain. Consumes feeds, can list on specific channels.
  | 'ops_admin'       // Internal SKUMS staff. Cross-workspace.
  | 'guest'           // Read-only, unverified.

export type IndustryId = string  // 'skincare', 'healthy_food', 'supplements', 'mechanical_keyboards'

export type ChannelId = string  // 'shopee_sg', 'shopee_tw', 'shopify', 'amazon_jp', 'pchome_tw', 'b2b_edi_ntuc'

export type VerificationTier =
  | 0  // Unverified. Anyone can sign up. Permissionless operation.
  | 1  // Signal-verified. GTIN prefix lookup, domain DNS TXT, behavioral.
  | 2  // Manually verified. Business registration, trademark, GS1 verified.

export interface Perspective {
  // Identity
  user_id: string
  workspace_id: string
  organization_id: string | null

  // Localization
  locale: Locale
  market: MarketCode
  currency: CurrencyCode

  // Authority context
  role: Role
  verification_tier: VerificationTier

  // Scope
  channels: ChannelId[]   // channels this perspective cares about / has authorized
  industries: IndustryId[] // which industry-app enrichments are relevant

  // Optional preferences (for personalization later)
  preferences?: {
    units?: 'metric' | 'imperial'
    timezone?: string
    date_format?: string
  }
}

/**
 * A subset of Perspective used for resolving non-authenticated requests
 * (e.g., public catalog feeds, public product pages).
 */
export interface AnonymousPerspective {
  locale: Locale
  market: MarketCode
  currency: CurrencyCode
  channels?: ChannelId[]
  industries?: IndustryId[]
}

/**
 * The canonical "default" perspective for fallback when nothing is resolved.
 * Used in dev/test, never in production code paths that have an auth context.
 */
export const DEFAULT_PERSPECTIVE: AnonymousPerspective = {
  locale: 'en-SG',
  market: 'SG',
  currency: 'SGD',
  channels: [],
  industries: [],
}
