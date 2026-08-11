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

/** OFS free-text fields are short/legacy — keep human label + compact SKUMS JSON. */
const OFS_REMARK_MAX_LEN = 1800

function compactEnrichment(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null || raw === '') continue
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      const nested = compactEnrichment(raw as Record<string, unknown>)
      if (Object.keys(nested).length) out[key] = nested
      continue
    }
    out[key] = raw
  }
  return out
}

/**
 * Build an OFS remark/comment/description value for old warehouse UI.
 * Warehouse staff see the human prefix; SKUMS can re-parse the trailing JSON.
 *
 * Example:
 *   Store replenishment to ST-ORCHARD
 *   {"v":1,"src":"skums","kind":"store_replenishment","reference_no":"RPL-1",...}
 */
export function buildWorldsyntechRemark(
  human: string | undefined,
  enrichment: Record<string, unknown> = {},
): string {
  const payload = compactEnrichment({
    v: 1,
    src: 'skums',
    ...enrichment,
  })
  const json = JSON.stringify(payload)
  const label = String(human || '').trim()
  const combined = label ? `${label}\n${json}` : json
  if (combined.length <= OFS_REMARK_MAX_LEN) return combined
  // Prefer keeping valid JSON; truncate human label if needed.
  const budget = Math.max(OFS_REMARK_MAX_LEN - json.length - 1, 0)
  const clipped = label.slice(0, budget).trim()
  return clipped ? `${clipped}\n${json}`.slice(0, OFS_REMARK_MAX_LEN) : json.slice(0, OFS_REMARK_MAX_LEN)
}

/** Recover SKUMS enrichment embedded by buildWorldsyntechRemark (best-effort). */
export function parseWorldsyntechRemark(value: unknown): {
  human: string
  enrichment: Record<string, unknown> | null
} {
  const raw = String(value ?? '')
  if (!raw.trim()) return { human: '', enrichment: null }

  // Prefer last JSON object in the string (human text may precede it).
  const start = raw.lastIndexOf('{"v":')
  const alt = start < 0 ? raw.lastIndexOf('{"src":"skums"') : start
  const idx = alt >= 0 ? alt : raw.lastIndexOf('{')
  if (idx < 0) return { human: raw.trim(), enrichment: null }

  const maybeJson = raw.slice(idx).trim()
  try {
    const parsed = JSON.parse(maybeJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { human: raw.trim(), enrichment: null }
    }
    const enrichment = parsed as Record<string, unknown>
    if (enrichment.src !== 'skums' && enrichment.v !== 1) {
      return { human: raw.trim(), enrichment: null }
    }
    return {
      human: raw.slice(0, idx).trim(),
      enrichment,
    }
  } catch {
    return { human: raw.trim(), enrichment: null }
  }
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

  const humanComment =
    order.comment ||
    `Store replenishment${order.destination_store_code ? ` to ${order.destination_store_code}` : ''}`

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
        // OFS UI is legacy — put structured SKUMS context in the free-text remark.
        order_comment: buildWorldsyntechRemark(humanComment, {
          kind: 'store_replenishment',
          reference_no: order.reference_no,
          destination_store_code: order.destination_store_code,
          delivery_method_id: order.delivery_method_id ?? credentials.default_delivery_method_id,
          line_count: order.lines.length,
          skus: order.lines.map((l) => l.sku).filter(Boolean).slice(0, 40),
          ...(order.metadata || {}),
        }),
        cod_total: 0,
        tracking_no: order.tracking_no || '',
        airwaybill: order.airwaybill_url || '',
      },
    ],
  }
}

export function mapInboundShipmentToWorldsyntechPayload(shipment: InboundShipmentRequest) {
  const shipmentMeta = shipment.metadata || {}
  return {
    shipments: [
      {
        products: shipment.lines.map((line, index) => {
          const lineRaw = (line.raw || {}) as Record<string, unknown>
          const human =
            line.product_description ||
            line.product_name ||
            `Inbound ${line.sku}`

          return {
            product_id: Number(line.external_product_id || 0),
            sku: line.sku,
            quantity: line.quantity,
            product_name: line.product_name || line.sku,
            product_price: line.product_price !== undefined ? String(line.product_price) : '0',
            product_dimension: line.product_dimension || '',
            product_weight: line.product_weight !== undefined ? String(line.product_weight) : '',
            // Native ASN fields lack UPC/expiry/carton — park them in description JSON.
            product_description: buildWorldsyntechRemark(human, {
              kind: 'inbound_line',
              reference_no: shipment.reference_no,
              tracking_number: shipment.tracking_number,
              line_index: index,
              sku: line.sku,
              upc: lineRaw.upc ?? lineRaw.barcode,
              expiry: lineRaw.expiry ?? lineRaw.expiry_date ?? lineRaw.best_before,
              batch: lineRaw.batch ?? lineRaw.lot,
              carton_count: lineRaw.carton_count,
              uom: lineRaw.uom,
              ...(typeof shipmentMeta === 'object' ? {
                shipment_palletization: shipmentMeta.palletization,
                shipment_pallet_count: shipmentMeta.pallet_count,
                po_number: shipmentMeta.po_number,
              } : {}),
            }),
          }
        }),
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
