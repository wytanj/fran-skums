import type { FulfillmentAdapter } from '../_types'
import {
  createWorldsyntechInboundShipment,
  createWorldsyntechStoreReplenishmentOrder,
  fetchWorldsyntechInventoryPage,
  fetchWorldsyntechProductsPage,
  fetchWorldsyntechReferenceData,
  testWorldsyntechCredentials,
  type WorldsyntechCredentials,
} from './client'
import {
  mapWorldsyntechInboundCreateResult,
  mapWorldsyntechInventory,
  mapWorldsyntechOrderCreateResult,
  mapWorldsyntechProduct,
} from './mapping'

const worldsyntechOfsAdapter: FulfillmentAdapter = {
  id: 'worldsyntech_ofs',
  name: 'WorldSyntech OFS',
  vendor: 'WorldSyntech',
  direction: 'bidirectional',
  modes: ['inbound_warehouse', 'retail_replenishment', 'stock_visibility', 'ecommerce_fulfillment'],

  auth: {
    flow: {
      type: 'basic_token',
      required_fields: ['base_url', 'basic_token', 'user_name', 'password'],
    },
    async initiate(workspace_id: string) {
      return {
        status: 'manual_credentials_required',
        redirect_url: `/integrations?node=worldsyntech-ofs&workspace_id=${encodeURIComponent(workspace_id)}`,
      }
    },
    async complete(_workspace_id: string, params: Record<string, string>) {
      return {
        base_url: params.base_url,
        basic_token: params.basic_token,
        user_name: params.user_name,
        password: params.password,
        language_id: params.language_id || '1',
        default_country_id: params.default_country_id,
        default_zone_id: params.default_zone_id,
        default_delivery_method_id: params.default_delivery_method_id,
      }
    },
    async refresh(credentials) {
      const result = await testWorldsyntechCredentials(credentials as WorldsyntechCredentials)
      return result.credentials
    },
    async test(credentials) {
      const result = await testWorldsyntechCredentials(credentials as WorldsyntechCredentials)
      return { ok: result.ok, details: result.details }
    },
  },

  referenceData: {
    async sync(credentials) {
      const result = await fetchWorldsyntechReferenceData(credentials as WorldsyntechCredentials)
      return result.data
    },
  },

  products: {
    async list(credentials, cursor) {
      const page = await fetchWorldsyntechProductsPage(credentials as WorldsyntechCredentials, {
        offset: cursor ? Number.parseInt(cursor, 10) : 0,
      })
      return {
        records: page.records.map(mapWorldsyntechProduct),
        next_cursor: page.next_cursor,
        has_more: page.has_more,
        raw: page.raw,
      }
    },
  },

  inventory: {
    async list(credentials, cursor) {
      const page = await fetchWorldsyntechInventoryPage(credentials as WorldsyntechCredentials, {
        offset: cursor ? Number.parseInt(cursor, 10) : 0,
      })
      return {
        records: page.records.map(mapWorldsyntechInventory),
        next_cursor: page.next_cursor,
        has_more: page.has_more,
        raw: page.raw,
      }
    },
  },

  storeReplenishmentOrders: {
    async create(credentials, order) {
      const result = await createWorldsyntechStoreReplenishmentOrder(credentials as WorldsyntechCredentials, order)
      return mapWorldsyntechOrderCreateResult(result.data)
    },
  },

  inboundShipments: {
    async create(credentials, shipment) {
      const result = await createWorldsyntechInboundShipment(credentials as WorldsyntechCredentials, shipment)
      return mapWorldsyntechInboundCreateResult(Array.isArray(result.data) ? result.data : [])
    },
  },
}

export default worldsyntechOfsAdapter
