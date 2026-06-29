/**
 * FulfillmentAdapter - contract for warehouse, 3PL, WMS, and logistics apps.
 *
 * This is separate from ChannelAdapter. Channels publish and reconcile
 * listings/orders against sales surfaces. Fulfillment adapters move inventory
 * through warehouses, stores, inbound shipments, and outbound replenishment.
 */

export type FulfillmentDirection = 'inbound' | 'outbound' | 'bidirectional'

export type FulfillmentMode =
  | 'retail_replenishment'
  | 'ecommerce_fulfillment'
  | 'inbound_warehouse'
  | 'returns'
  | 'stock_visibility'

export interface FulfillmentCredentials {
  access_token?: string
  refresh_token?: string
  expires_at?: string
  token_type?: string
  [key: string]: unknown
}

export interface FulfillmentAuthFlow {
  type: 'api_key' | 'basic_token' | 'oauth2' | 'edi_credentials' | 'partner_token'
  required_fields: string[]
}

export interface FulfillmentAuth {
  flow: FulfillmentAuthFlow
  initiate: (workspace_id: string) => Promise<{ redirect_url?: string; status: string }>
  complete: (workspace_id: string, params: Record<string, string>) => Promise<FulfillmentCredentials>
  refresh?: (credentials: FulfillmentCredentials) => Promise<FulfillmentCredentials>
  test: (credentials: FulfillmentCredentials) => Promise<{ ok: boolean; details?: string }>
}

export interface FulfillmentPage<T> {
  records: T[]
  next_cursor?: string
  has_more: boolean
  raw?: unknown
}

export interface FulfillmentInventoryRecord {
  external_product_id?: string
  sku?: string
  name?: string
  available_quantity: number
  ordered_quantity?: number
  processing_quantity?: number
  picked_quantity?: number
  stockout_quantity?: number
  delivered_quantity?: number
  damaged_quantity?: number
  alert_quantity?: number
  raw: Record<string, unknown>
}

export interface FulfillmentProductRecord {
  external_product_id: string
  sku?: string
  upc?: string
  name?: string
  status?: string
  raw: Record<string, unknown>
}

export interface FulfillmentAddress {
  name: string
  telephone?: string
  company?: string
  address: string
  city: string
  postcode: string
  country_id?: string | number
  zone_id?: string | number
  raw?: Record<string, unknown>
}

export interface FulfillmentOrderLine {
  external_product_id?: string | number
  sku: string
  quantity: number
  name?: string
  raw?: Record<string, unknown>
}

export interface StoreReplenishmentOrder {
  reference_no: string
  destination_store_code?: string
  delivery_method_id?: string | number
  shipping_address: FulfillmentAddress
  lines: FulfillmentOrderLine[]
  comment?: string
  tracking_no?: string
  airwaybill_url?: string
  metadata?: Record<string, unknown>
}

export interface InboundShipmentLine {
  external_product_id?: string | number
  sku: string
  quantity: number
  product_name?: string
  product_price?: string | number
  product_dimension?: string
  product_weight?: string | number
  product_description?: string
  raw?: Record<string, unknown>
}

export interface InboundShipmentRequest {
  reference_no?: string
  tracking_number: string
  date_estimate: string
  lines: InboundShipmentLine[]
  metadata?: Record<string, unknown>
}

export interface FulfillmentMutationResult {
  ok: boolean
  external_id?: string
  external_ids?: string[]
  status?: string
  raw?: unknown
  errors?: FulfillmentError[]
  warnings?: string[]
}

export interface FulfillmentError {
  field?: string
  code: string
  message: string
  fixable?: boolean
}

export interface FulfillmentAdapter {
  id: string
  name: string
  vendor: string
  direction: FulfillmentDirection
  modes: FulfillmentMode[]
  auth: FulfillmentAuth
  referenceData?: {
    sync: (credentials: FulfillmentCredentials) => Promise<Record<string, unknown>>
  }
  products?: {
    list: (credentials: FulfillmentCredentials, cursor?: string) => Promise<FulfillmentPage<FulfillmentProductRecord>>
  }
  inventory?: {
    list: (credentials: FulfillmentCredentials, cursor?: string) => Promise<FulfillmentPage<FulfillmentInventoryRecord>>
    get?: (credentials: FulfillmentCredentials, lookup: { external_product_id?: string; sku?: string }) => Promise<FulfillmentInventoryRecord | null>
  }
  storeReplenishmentOrders?: {
    create: (credentials: FulfillmentCredentials, order: StoreReplenishmentOrder) => Promise<FulfillmentMutationResult>
    get?: (credentials: FulfillmentCredentials, external_id: string) => Promise<Record<string, unknown>>
    list?: (credentials: FulfillmentCredentials, cursor?: string) => Promise<FulfillmentPage<Record<string, unknown>>>
    cancel?: (credentials: FulfillmentCredentials, external_id: string, reason: string) => Promise<FulfillmentMutationResult>
  }
  inboundShipments?: {
    create: (credentials: FulfillmentCredentials, shipment: InboundShipmentRequest) => Promise<FulfillmentMutationResult>
    get?: (credentials: FulfillmentCredentials, external_id: string) => Promise<Record<string, unknown>>
    list?: (credentials: FulfillmentCredentials, cursor?: string) => Promise<FulfillmentPage<Record<string, unknown>>>
    cancel?: (credentials: FulfillmentCredentials, external_id: string) => Promise<FulfillmentMutationResult>
  }
}
