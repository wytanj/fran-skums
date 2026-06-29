import type { AuthCredentials, ChannelAdapter, ChannelError, ProjectedSku, ValidationResult } from '../_types'
import {
  fetchWooCommerceProductsPage,
  mapWooCommerceProductToSkumsProduct,
  skumsToWooCommerceProduct,
  testWooCommerceCredentials,
} from './client'

function notImplemented(operation: string) {
  return {
    ok: false,
    errors: [
      {
        code: 'woocommerce_write_not_configured',
        message: `WooCommerce ${operation} is not connected to the write API yet.`,
        fixable: true,
      },
    ],
  }
}

function validateWooCommerceSku(sku: ProjectedSku): ValidationResult {
  const errors: ChannelError[] = []
  const warnings: string[] = []

  if (!sku.name) {
    errors.push({ field: 'name', code: 'required', message: 'WooCommerce product name is required.', fixable: true })
  }
  if (!sku.sku) {
    warnings.push('WooCommerce products can sync without SKU, but SKUMS reconciliation is stronger when SKU is present.')
  }
  if ((sku.sale_price ?? sku.retail_price) === undefined) {
    warnings.push('WooCommerce products without a price will be imported as catalog data but may not be sellable.')
  }

  return { ok: errors.length === 0, errors, warnings }
}

const woocommerceAdapter: ChannelAdapter = {
  id: 'woocommerce',
  name: 'WooCommerce',
  vendor: 'WooCommerce',
  market: 'multi',
  direction: 'bidirectional',

  auth: {
    flow: {
      type: 'api_key',
      required_fields: ['site_url', 'consumer_key', 'consumer_secret'],
    },
    async initiate(workspace_id: string) {
      return {
        status: 'manual_credentials_required',
        redirect_url: `/integrations?node=woocommerce&workspace_id=${encodeURIComponent(workspace_id)}`,
      }
    },
    async complete(_workspace_id: string, params: Record<string, string>) {
      return {
        site_url: params.site_url,
        consumer_key: params.consumer_key,
        consumer_secret: params.consumer_secret,
        currency: params.currency,
      }
    },
    async test(credentials: AuthCredentials) {
      return testWooCommerceCredentials(credentials)
    },
  },

  push: {
    async create() {
      return notImplemented('product create')
    },
    async update() {
      return notImplemented('product update')
    },
    async delete() {
      return notImplemented('product delete')
    },
    async update_inventory() {
      return notImplemented('inventory update')
    },
    async update_price() {
      return notImplemented('price update')
    },
  },

  pull: {
    async orders() {
      return { deltas: [] }
    },
    async inventory(credentials, cursor) {
      const page = cursor ? Math.max(Number.parseInt(cursor, 10), 1) : 1
      const result = await fetchWooCommerceProductsPage(credentials, { page, perPage: 100, status: 'any' })
      return {
        deltas: result.data.map(product => ({
          type: 'inventory_change',
          channel_listing_id: String(product.id),
          payload: {
            sku: product.sku || null,
            stock_quantity: product.stock_quantity ?? null,
            stock_status: product.stock_status ?? null,
            manage_stock: Boolean(product.manage_stock),
          },
          occurred_at: product.date_modified ? new Date(product.date_modified) : new Date(),
        })),
        next_cursor: result.next_page ? String(result.next_page) : undefined,
      }
    },
  },

  validate: validateWooCommerceSku,

  mapping: {
    skums_to_channel(sku: ProjectedSku) {
      return skumsToWooCommerceProduct(sku)
    },
    channel_to_skums(raw: Record<string, unknown>) {
      return mapWooCommerceProductToSkumsProduct(raw as any)
    },
  },
}

export default woocommerceAdapter
