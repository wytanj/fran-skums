import type {
  FulfillmentInventoryRecord,
  FulfillmentMutationResult,
  FulfillmentProductRecord,
  InboundShipmentRequest,
  StoreReplenishmentOrder,
} from '../_types'
import type { WorldsyntechCredentials, WorldsyntechInventoryRecord, WorldsyntechProduct } from './types'

function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(String(value).replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function text(value: unknown): string | undefined {
  const trimmed = String(value ?? '').trim()
  return trimmed || undefined
}

export function mapWorldsyntechProduct(product: WorldsyntechProduct): FulfillmentProductRecord {
  return {
    external_product_id: String(product.product_id ?? product.sku ?? ''),
    sku: text(product.sku),
    upc: text(product.upc),
    name: text(product.product_name),
    status: text(product.status),
    raw: product as Record<string, unknown>,
  }
}

export function mapWorldsyntechInventory(record: WorldsyntechInventoryRecord): FulfillmentInventoryRecord {
  const detail = record.inventory_detail || {}
  return {
    external_product_id: text(record.product_id),
    sku: text(record.sku),
    name: text(record.product_name),
    available_quantity: toNumber(detail.available_quantity),
    ordered_quantity: toNumber(detail.ordered_quantity),
    processing_quantity: toNumber(detail.process_quantity),
    picked_quantity: toNumber(detail.picked_quantity),
    stockout_quantity: toNumber(detail.stockout_quantity),
    delivered_quantity: toNumber(detail.delivered_quantity),
    damaged_quantity: toNumber(detail.damaged_quantity),
    alert_quantity: toNumber(record.stock_alert_quantity),
    raw: record as Record<string, unknown>,
  }
}

export function mapStoreReplenishmentToWorldsyntechPayload(
  order: StoreReplenishmentOrder,
  credentials: WorldsyntechCredentials = {},
) {
  const defaultCountryId = credentials.default_country_id
  const defaultZoneId = credentials.default_zone_id
  const shipping = order.shipping_address
  const shippingAddress = {
    address_id: Number((shipping.raw as any)?.address_id || 0),
    address: shipping.address,
    name: shipping.name,
    city: shipping.city,
    postcode: shipping.postcode,
    country_id: Number(shipping.country_id ?? defaultCountryId ?? 0),
    zone_id: Number(shipping.zone_id ?? defaultZoneId ?? 0),
    company: shipping.company || '',
    telephone: shipping.telephone || '',
  }

  return {
    orders: [
      {
        reference_no: order.reference_no,
        atomic_order_id: order.metadata?.source_order_id || '',
        marketplace_code: order.metadata?.source_channel || 'retail_replenishment',
        shipping_address_detail: shippingAddress,
        payment_address_detail: shippingAddress,
        order_products: order.lines.map(line => ({
          product_id: Number(line.external_product_id || 0),
          sku: line.sku,
          quantity: line.quantity,
        })),
        delivery_method_id: Number(order.delivery_method_id ?? credentials.default_delivery_method_id ?? 0),
        order_comment: order.comment || `Store replenishment${order.destination_store_code ? ` to ${order.destination_store_code}` : ''}`,
        cod_total: 0,
        tracking_no: order.tracking_no || '',
        airwaybill: order.airwaybill_url || '',
      },
    ],
  }
}

export function mapInboundShipmentToWorldsyntechPayload(shipment: InboundShipmentRequest) {
  return {
    shipments: [
      {
        products: shipment.lines.map(line => ({
          product_id: Number(line.external_product_id || 0),
          sku: line.sku,
          quantity: line.quantity,
          product_name: line.product_name || line.sku,
          product_price: line.product_price !== undefined ? String(line.product_price) : '0',
          product_dimension: line.product_dimension || '',
          product_weight: line.product_weight !== undefined ? String(line.product_weight) : '',
          product_description: line.product_description || '',
        })),
        tracking_number: shipment.tracking_number,
        date_estimate: shipment.date_estimate,
      },
    ],
  }
}

export function mapWorldsyntechOrderCreateResult(raw: Record<string, unknown>): FulfillmentMutationResult {
  const orderIds = Array.isArray((raw as any)?.order_id)
    ? (raw as any).order_id.map(String)
    : []
  return {
    ok: true,
    external_id: orderIds[0],
    external_ids: orderIds,
    status: 'created',
    raw,
  }
}

export function mapWorldsyntechInboundCreateResult(raw: Record<string, unknown>[]): FulfillmentMutationResult {
  const externalIds = raw.flatMap(row => {
    const ids = (row as any).stock_incoming_id
    return Array.isArray(ids) ? ids.map(String) : ids ? [String(ids)] : []
  })
  return {
    ok: true,
    external_id: externalIds[0],
    external_ids: externalIds,
    status: 'created',
    raw,
  }
}
