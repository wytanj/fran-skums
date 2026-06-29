import type { AuthCredentials, ChannelAdapter, ChannelError, ProjectedSku, ValidationResult } from '../_types'
import { skumsToSquareCatalogObjects, squareCatalogObjectToSkums } from './mapping'
import { squareWebhookToDeltas, verifySquareWebhookHeaders } from './webhook'

function notImplemented(operation: string) {
  return {
    ok: false,
    errors: [
      {
        code: 'square_connector_not_configured',
        message: `Square ${operation} is scaffolded but not connected to Square's API client yet.`,
        fixable: true,
      },
    ],
  }
}

function validateSquareSku(sku: ProjectedSku): ValidationResult {
  const errors: ChannelError[] = []
  const warnings: string[] = []

  if (!sku.name) {
    errors.push({ field: 'name', code: 'required', message: 'Square item name is required.', fixable: true })
  }
  if (!sku.sku) {
    warnings.push('Square item variations work best with a SKU for cashier search and reconciliation.')
  }
  if ((sku.sale_price ?? sku.retail_price) === undefined) {
    errors.push({ field: 'retail_price', code: 'required', message: 'Square variation price_money is required.', fixable: true })
  }
  if (!sku.currency) {
    errors.push({ field: 'currency', code: 'required', message: 'Square price_money currency is required.', fixable: true })
  }

  return { ok: errors.length === 0, errors, warnings }
}

const squareAdapter: ChannelAdapter = {
  id: 'square',
  name: 'Square POS',
  vendor: 'Square',
  market: 'multi',
  direction: 'bidirectional',

  auth: {
    flow: {
      type: 'oauth2',
      authorize_url: 'https://connect.squareup.com/oauth2/authorize',
      scopes: [
        'ITEMS_READ',
        'ITEMS_WRITE',
        'INVENTORY_READ',
        'INVENTORY_WRITE',
        'ORDERS_READ',
      ],
    },
    async initiate(workspace_id: string) {
      return {
        status: 'pending_configuration',
        redirect_url: `/api/v1/channels/square/oauth/start?workspace_id=${encodeURIComponent(workspace_id)}`,
      }
    },
    async complete(_workspace_id: string, params: Record<string, string>) {
      return {
        access_token: params.access_token,
        refresh_token: params.refresh_token,
        expires_at: params.expires_at ? new Date(params.expires_at) : undefined,
        merchant_id: params.merchant_id,
      }
    },
    async refresh(credentials: AuthCredentials) {
      return credentials
    },
    async test(credentials: AuthCredentials) {
      return {
        ok: Boolean(credentials.access_token),
        details: credentials.access_token ? 'access token present' : 'missing access token',
      }
    },
  },

  push: {
    async create() {
      return notImplemented('catalog create')
    },
    async update() {
      return notImplemented('catalog update')
    },
    async delete() {
      return notImplemented('catalog delete')
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
    async inventory() {
      return { deltas: [] }
    },
  },

  validate: validateSquareSku,

  mapping: {
    skums_to_channel(sku: ProjectedSku) {
      return {
        objects: skumsToSquareCatalogObjects(sku),
      }
    },
    channel_to_skums(raw: Record<string, unknown>) {
      return squareCatalogObjectToSkums(raw)
    },
  },

  async handleWebhook(headers, body, credentials) {
    const verification = verifySquareWebhookHeaders(headers, credentials)
    if (!verification.ok) {
      throw new Error(verification.details)
    }
    return { deltas: squareWebhookToDeltas(body) }
  },
}

export default squareAdapter
