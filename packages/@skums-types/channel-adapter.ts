/**
 * ChannelAdapter — the contract every channel integration must implement.
 *
 * Channels are downstream consumers of the SKU master. Each channel
 * (Shopee, Shopify, Amazon, Lazada, TikTok Shop, B2B EDI, etc.) gets
 * its own adapter implementing this contract.
 *
 * Adapters use OFFICIAL APIs only. They are bidirectional: SKUMS
 * pushes SKU data outward; channels push order/inventory data back.
 *
 * Scrapers are a separate concept (tactical data acquisition,
 * read-only) and live elsewhere. Don't confuse the two — channels
 * are durable infrastructure, scrapers are best-effort.
 */

import type { Perspective, MarketCode } from './perspective'

// ── Core types ──────────────────────────────────────────────

export type ChannelDirection = 'push' | 'pull' | 'bidirectional'

export type FeedFormat = 'json' | 'xml' | 'csv' | 'edi_x12' | 'edi_edifact' | 'tsv'

export interface AuthFlow {
  type: 'oauth2' | 'api_key' | 'edi_credentials' | 'partner_token'
  authorize_url?: string             // for OAuth2
  callback_url?: string
  scopes?: string[]
  required_fields?: string[]         // for api_key/edi flows
}

export interface AuthCredentials {
  access_token?: string
  refresh_token?: string
  expires_at?: Date
  api_key?: string
  partner_id?: string
  shop_id?: string
  // Adapters store anything else they need in the credentials JSONB
  [key: string]: unknown
}

// ── Sync types ──────────────────────────────────────────────

/**
 * A SKU as projected through a perspective — what the channel adapter
 * actually receives. The adapter never sees raw canonical fields; it
 * sees the projected, perspective-aware view.
 */
export interface ProjectedSku {
  sku_id: string
  workspace_id: string

  // Identity
  sku: string
  gtin?: string
  upc?: string
  ean?: string

  // Localized content (already projected to perspective.locale)
  name: string
  description?: string
  short_description?: string

  // Pricing (already projected to perspective.currency)
  retail_price?: number
  sale_price?: number
  cost_price?: number     // only present if perspective.permissions.can_view_cost
  currency: string

  // Physical
  weight?: number
  weight_unit?: string
  dimensions?: { length: number; width: number; height: number; unit: string }

  // Channel-relevant fields, dynamic
  attributes?: Record<string, unknown>

  // Images (rendered for the target channel where applicable)
  images?: Array<{
    url: string
    role: 'main' | 'gallery' | 'lifestyle' | 'swatch' | 'diagram' | 'packaging' | 'certificate' | '360'
    alt?: string
  }>

  // Provenance — where each field came from
  _provenance?: Record<string, FieldProvenance>
}

export interface FieldProvenance {
  source: 'canonical' | 'localization' | 'market_override' | 'channel_override' | 'role_view' | 'app_enrichment' | 'computed'
  layer?: string  // e.g. 'ja-JP', 'TW-market', 'shopee-channel', 'skincare-app'
  computed_from?: string[]
}

// ── Sync results ────────────────────────────────────────────

export interface PushResult {
  ok: boolean
  channel_listing_id?: string  // ID assigned by the channel
  errors?: ChannelError[]
  warnings?: string[]
}

export interface PullDelta {
  type: 'order' | 'inventory_change' | 'review' | 'price_change' | 'listing_status'
  channel_listing_id: string
  sku_id?: string                 // resolved by adapter when possible
  payload: Record<string, unknown>
  occurred_at: Date
}

export interface PullResult {
  deltas: PullDelta[]
  next_cursor?: string             // for pagination across calls
  rate_limit_remaining?: number
}

export interface ValidationResult {
  ok: boolean
  errors: ChannelError[]
  warnings: string[]
}

export interface ChannelError {
  field?: string
  code: string
  message: string
  fixable?: boolean                // can SKUMS auto-remediate?
}

// ── Feed types (for channel sellers consuming feeds) ────────

export interface FeedDocument {
  format: FeedFormat
  content_type: string
  body: string | Buffer
  generated_at: Date
  expires_at?: Date
  sku_count: number
}

// ── The adapter contract ────────────────────────────────────

export interface ChannelAdapter {
  // Identity
  id: string                       // 'shopee_sg', 'shopee_tw', 'shopify', etc.
  name: string
  vendor: string                   // 'Shopee', 'Shopify', 'Amazon', etc.
  market: MarketCode | 'multi'    // single-market or multi-market adapter
  direction: ChannelDirection

  // Authentication
  auth: {
    flow: AuthFlow
    initiate: (workspace_id: string) => Promise<{ redirect_url?: string; status: string }>
    complete: (workspace_id: string, params: Record<string, string>) => Promise<AuthCredentials>
    refresh?: (credentials: AuthCredentials) => Promise<AuthCredentials>
    test: (credentials: AuthCredentials) => Promise<{ ok: boolean; details?: string }>
  }

  // Push: SKUMS → channel
  push?: {
    create: (sku: ProjectedSku, credentials: AuthCredentials) => Promise<PushResult>
    update: (sku: ProjectedSku, channel_listing_id: string, credentials: AuthCredentials) => Promise<PushResult>
    delete: (channel_listing_id: string, credentials: AuthCredentials) => Promise<PushResult>
    update_inventory: (channel_listing_id: string, qty: number, credentials: AuthCredentials) => Promise<PushResult>
    update_price: (channel_listing_id: string, price: number, credentials: AuthCredentials) => Promise<PushResult>
  }

  // Pull: channel → SKUMS
  pull?: {
    orders: (since: Date, credentials: AuthCredentials, cursor?: string) => Promise<PullResult>
    inventory: (credentials: AuthCredentials, cursor?: string) => Promise<PullResult>
    reviews?: (since: Date, credentials: AuthCredentials, cursor?: string) => Promise<PullResult>
  }

  // Feed generation (for channel sellers downstream)
  feed?: {
    formats: FeedFormat[]
    generate: (seller_id: string, perspective: Perspective, format: FeedFormat) => Promise<FeedDocument>
  }

  // Validation (pre-push)
  validate: (sku: ProjectedSku) => ValidationResult

  // Field mapping (for debugging / inspection)
  mapping?: {
    skums_to_channel: (sku: ProjectedSku) => Record<string, unknown>
    channel_to_skums: (raw: Record<string, unknown>) => Partial<ProjectedSku>
  }

  // Conflict resolution: when SKUMS canonical and channel disagree on a field
  resolveConflict?: (
    skums_value: unknown,
    channel_value: unknown,
    field: string
  ) => unknown

  // Optional inbound webhook handler
  handleWebhook?: (
    headers: Record<string, string>,
    body: string,
    credentials: AuthCredentials
  ) => Promise<{ deltas: PullDelta[] }>
}
