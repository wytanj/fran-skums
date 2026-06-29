import type { FulfillmentCredentials } from '../_types'

export interface WorldsyntechCredentials extends FulfillmentCredentials {
  base_url?: string
  basic_token?: string
  user_name?: string
  password?: string
  language_id?: number | string
  default_country_id?: number | string
  default_zone_id?: number | string
  default_delivery_method_id?: number | string
}

export interface NormalizedWorldsyntechCredentials {
  baseUrl: URL
  basicToken: string
  userName: string
  password: string
  languageId: number
  accessToken?: string
  expiresAt?: Date
}

export interface WorldsyntechEnvelope<T> {
  success: number | string | boolean
  error: unknown
  data: T
}

export interface WorldsyntechTokenData {
  access_token?: string
  expires_in?: number | string
  token_type?: string
  customer_id?: string
  username?: string
  email?: string
  [key: string]: unknown
}

export interface WorldsyntechProduct {
  product_id?: string | number
  main_product_id?: string | number
  product_kitting_id?: string | number
  sku?: string
  upc?: string
  product_name?: string
  product_variation_name?: string
  status?: string
  price?: string | number
  cost?: string | number
  date_added?: string
  date_modified?: string
  [key: string]: unknown
}

export interface WorldsyntechInventoryRecord {
  product_id?: string | number
  sku?: string
  product_name?: string
  product_variation_name?: string
  inventory_detail?: {
    available_quantity?: string | number
    ordered_quantity?: string | number
    process_quantity?: string | number
    picked_quantity?: string | number
    stockout_quantity?: string | number
    delivered_quantity?: string | number
    damaged_quantity?: string | number
    [key: string]: unknown
  }
  stock_alert_quantity?: string | number
  [key: string]: unknown
}

export interface WorldsyntechReferenceData {
  addresses: Record<string, unknown>[]
  countries: Record<string, unknown>[]
  zones: Record<string, unknown>[]
  delivery_methods: Record<string, unknown>[]
}

export interface WorldsyntechPageOptions {
  offset?: number
  limit?: number
  maxPages?: number
  language_id?: number
  status?: number | boolean
}
