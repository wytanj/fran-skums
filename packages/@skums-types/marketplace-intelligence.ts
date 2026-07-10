/**
 * Marketplace intelligence contracts — competitive observation warehouse
 * (Shopee first). Separate from authorized channel adapters.
 */

export type MarketplaceId = 'shopee' | 'lazada' | 'tiktok' | 'other'

export type MarketplaceCountryCode = string // ISO-ish lowercase: sg, ph, my

export type MarketplaceCrawlMode =
  | 'keyword'
  | 'shop'
  | 'listing'
  | 'brand_portfolio'

export type MarketplaceScheduleKind = 'daily' | 'weekly' | 'cron' | 'manual_only'

export type SellerType =
  | 'mall'
  | 'preferred_plus'
  | 'preferred'
  | 'official_brand'
  | 'normal'
  | 'unknown'

export type MarketplaceCrawlJobStatus =
  | 'pending'
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type MarketplaceListingStatus = 'active' | 'inactive' | 'unknown'

export type MarketplaceAvailability = 'in_stock' | 'out_of_stock' | 'unknown'

export type SessionHealth = 'ok' | 'login_required' | 'blocked' | 'unknown'

export interface MarketplaceCrawlSeed {
  id: string
  workspace_id: string
  marketplace: MarketplaceId
  country: MarketplaceCountryCode
  mode: MarketplaceCrawlMode
  target: string
  enabled: boolean
  schedule_kind: MarketplaceScheduleKind
  schedule_cron: string | null
  timezone: string
  preferred_hour: number
  weekly_day: number | null
  max_pages: number
  max_listings: number
  detail_top_n: number
  priority: number
  collector_id: string
  last_enqueued_at: string | null
  last_success_at: string | null
  last_error: string | null
  next_run_at: string | null
  consecutive_failures: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface MarketplaceCrawlJob {
  id: string
  workspace_id: string
  seed_id: string | null
  marketplace: MarketplaceId
  country: MarketplaceCountryCode
  crawl_type: MarketplaceCrawlMode | 'manual'
  target: string
  status: MarketplaceCrawlJobStatus
  priority: number
  collector_id: string
  scheduled_for: string
  claimed_at: string | null
  claimed_by: string | null
  started_at: string | null
  completed_at: string | null
  total_targets: number
  processed_targets: number
  failed_targets: number
  summary: Record<string, unknown>
  error: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface MarketplaceShop {
  id: string
  workspace_id: string
  marketplace: MarketplaceId
  country: MarketplaceCountryCode
  shop_id: string
  shop_name: string | null
  seller_type: SellerType
  is_official_seed: boolean
  shop_url: string | null
  raw_identity: Record<string, unknown>
  first_seen_at: string
  last_seen_at: string
  metadata: Record<string, unknown>
}

export interface MarketplaceListing {
  id: string
  workspace_id: string
  marketplace: MarketplaceId
  country: MarketplaceCountryCode
  shop_id: string
  item_id: string
  listing_url: string | null
  title: string | null
  shop_name: string | null
  seller_type: SellerType
  brand_name_raw: string | null
  category_path: string | null
  image_url: string | null
  status: MarketplaceListingStatus
  marketplace_shop_row_id: string | null
  raw_identity: Record<string, unknown>
  first_seen_at: string
  last_seen_at: string
  metadata: Record<string, unknown>
}

export interface MarketplaceListingSnapshot {
  id: string
  workspace_id: string
  listing_id: string
  crawl_job_id: string | null
  crawled_at: string
  price: number | null
  original_price: number | null
  currency: string
  price_sgd: number | null
  rating: number | null
  review_count: number | null
  sold_label: string | null
  sold_count_lower_bound: number | null
  favourite_count: number | null
  available_quantity: number | null
  availability: MarketplaceAvailability
  rank_position: number | null
  search_query: string | null
  category_id: string | null
  voucher_labels: string[]
  shipping_labels: string[]
  preorder_days: number | null
  seller_type: SellerType | null
  signals: Record<string, unknown>
  raw_observation: Record<string, unknown>
  created_at: string
}

/** Card observed by a collect adapter before warehouse upsert */
export interface ObservedListingCard {
  shop_id: string
  item_id: string
  title: string
  listing_url: string
  shop_name?: string
  seller_type: SellerType
  price?: number
  original_price?: number
  currency: string
  rating?: number
  review_count?: number
  sold_label?: string
  sold_count_lower_bound?: number
  rank_position: number
  search_query?: string
  image_url?: string
  signals?: Record<string, boolean | number | string>
  raw: Record<string, unknown>
}

export interface CollectSeedInput {
  id: string
  workspace_id: string
  marketplace: MarketplaceId
  country: MarketplaceCountryCode
  mode: MarketplaceCrawlMode
  target: string
  max_pages: number
  max_listings: number
  detail_top_n: number
  metadata?: Record<string, unknown>
}

export interface CollectResult {
  cards: ObservedListingCard[]
  details?: Record<string, unknown>[]
  session_health: SessionHealth
  raw_pages?: Record<string, unknown>[]
}

export interface CollectAdapter {
  id: string
  scrapeSeed(seed: CollectSeedInput, jobId: string): Promise<CollectResult>
}
