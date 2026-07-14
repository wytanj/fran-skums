/**
 * Inbound ASN: KR/HK → Loft (TODO-LOFT Phase D).
 * Create local ASN → send to OFS → poll receive → LISE confirm → promote LOFT-SG.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { InboundShipmentRequest } from '../../fulfillment/_types'
import {
  createWorldsyntechInboundShipment,
  fetchWorldsyntechApi,
  stableWorldsyntechHash,
  type WorldsyntechCredentials,
} from '../../fulfillment/worldsyntech-ofs/client'
import { mapWorldsyntechInboundCreateResult } from '../../fulfillment/worldsyntech-ofs/mapping'
import { upsertIntegrationEntityMapping } from './integrationActions'

export type InboundStatus =
  | 'draft'
  | 'asn_sent'
  | 'in_transit'
  | 'loft_receiving'
  | 'partial_received'
  | 'fully_received'
  | 'lise_confirmed'
  | 'available'
  | 'cancelled'
  | 'exception'

export type Palletization = 'full_pallet' | 'partial_pallet' | 'loose' | 'mixed'

function shipmentNumber() {
  return `ASN-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`
}

export async function resolveLoftLocationId(client: SupabaseClient, workspaceId: string) {
  const { data } = await client
    .from('inventory_locations')
    .select('id, code')
    .eq('workspace_id', workspaceId)
    .eq('code', 'LOFT-SG')
    .maybeSingle()
  return data?.id || null
}

export async function createInboundShipment(
  client: SupabaseClient,
  params: {
    workspaceId: string
    trackingNumber: string
    dateEstimate: string
    referenceNo?: string | null
    connectionId?: string | null
    localForwarder?: string | null
    offshoreForwarder?: string | null
    palletization?: Palletization | null
    cartonCount?: number | null
    palletCount?: number | null
    notes?: string | null
    createdBy?: string | null
    lines: Array<{
      sku: string
      quantity: number
      product_id?: string | null
      product_name?: string | null
      external_product_id?: string | null
      product_price?: string | number | null
      product_weight?: string | number | null
      product_dimension?: string | null
      product_description?: string | null
    }>
  },
) {
  if (!params.lines?.length) {
    throw Object.assign(new Error('lines required'), { statusCode: 400 })
  }

  const loftId = await resolveLoftLocationId(client, params.workspaceId)

  // Resolve product ids by SKU when missing
  const lines = []
  for (const line of params.lines) {
    const sku = String(line.sku || '').trim()
    if (!sku || !(line.quantity > 0)) continue
    let productId = line.product_id || null
    if (!productId) {
      const { data: product } = await client
        .from('products')
        .select('id, title')
        .eq('workspace_id', params.workspaceId)
        .eq('sku', sku)
        .maybeSingle()
      productId = product?.id || null
      if (!line.product_name && product?.title) {
        line.product_name = product.title
      }
    }
    // Prefer OFS product mapping by sku
    let externalProductId = line.external_product_id || null
    if (!externalProductId && params.connectionId) {
      const { data: mapping } = await client
        .from('integration_entity_mappings')
        .select('external_id')
        .eq('connection_id', params.connectionId)
        .eq('entity_type', 'product')
        .eq('external_secondary_id', sku)
        .maybeSingle()
      externalProductId = mapping?.external_id || null
    }
    lines.push({
      workspace_id: params.workspaceId,
      sku,
      quantity: line.quantity,
      product_id: productId,
      product_name: line.product_name || sku,
      external_product_id: externalProductId ? String(externalProductId) : null,
      product_price: line.product_price != null ? String(line.product_price) : null,
      product_weight: line.product_weight != null ? String(line.product_weight) : null,
      product_dimension: line.product_dimension || null,
      product_description: line.product_description || null,
      status: 'declared',
    })
  }

  if (!lines.length) {
    throw Object.assign(new Error('No valid lines (sku + quantity)'), { statusCode: 400 })
  }

  const { data: shipment, error } = await client
    .from('inbound_shipments')
    .insert({
      workspace_id: params.workspaceId,
      connection_id: params.connectionId || null,
      shipment_number: shipmentNumber(),
      status: 'draft',
      reference_no: params.referenceNo || null,
      tracking_number: params.trackingNumber,
      date_estimate: params.dateEstimate,
      local_forwarder: params.localForwarder || 'M&P',
      offshore_forwarder: params.offshoreForwarder || null,
      palletization: params.palletization || null,
      carton_count: params.cartonCount ?? null,
      pallet_count: params.palletCount ?? null,
      destination_location_id: loftId,
      notes: params.notes || null,
      created_by: params.createdBy || null,
      metadata: { origin: 'kr_hk_inbound' },
    })
    .select()
    .single()

  if (error) throw error

  const { data: insertedLines, error: lineError } = await client
    .from('inbound_shipment_lines')
    .insert(lines.map(l => ({ ...l, shipment_id: shipment.id })))
    .select()

  if (lineError) throw lineError

  return { shipment, lines: insertedLines || [] }
}

export async function sendInboundToLoft(
  client: SupabaseClient,
  params: {
    workspaceId: string
    shipmentId: string
    credentials: WorldsyntechCredentials
    connectionId: string
  },
) {
  const { data: shipment, error } = await client
    .from('inbound_shipments')
    .select('*, lines:inbound_shipment_lines(*)')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.shipmentId)
    .maybeSingle()

  if (error) throw error
  if (!shipment) throw Object.assign(new Error('Shipment not found'), { statusCode: 404 })
  if (!['draft', 'exception'].includes(shipment.status)) {
    throw Object.assign(new Error(`Cannot send ASN in status ${shipment.status}`), { statusCode: 409 })
  }

  const lines = Array.isArray(shipment.lines) ? shipment.lines : []
  const unmapped = lines.filter((l: any) => !l.external_product_id && !l.sku)
  if (unmapped.length) {
    throw Object.assign(new Error('All lines need sku or external_product_id'), { statusCode: 400 })
  }

  const request: InboundShipmentRequest = {
    reference_no: shipment.reference_no || shipment.shipment_number,
    tracking_number: shipment.tracking_number,
    date_estimate: String(shipment.date_estimate || '').slice(0, 10),
    lines: lines.map((l: any) => ({
      sku: l.sku,
      quantity: l.quantity,
      external_product_id: l.external_product_id || undefined,
      product_name: l.product_name || l.sku,
      product_price: l.product_price || '0',
      product_weight: l.product_weight || undefined,
      product_dimension: l.product_dimension || undefined,
      product_description: l.product_description || undefined,
    })),
    metadata: {
      local_forwarder: shipment.local_forwarder,
      offshore_forwarder: shipment.offshore_forwarder,
      palletization: shipment.palletization,
    },
  }

  const result = await createWorldsyntechInboundShipment(params.credentials, request)
  const mapped = mapWorldsyntechInboundCreateResult(Array.isArray(result.data) ? result.data : [])

  const mainId = Array.isArray(result.data) && result.data[0]
    ? String((result.data[0] as any).stock_incoming_main_id || '')
    : ''

  for (const externalId of mapped.external_ids || []) {
    await upsertIntegrationEntityMapping(client, {
      workspace_id: params.workspaceId,
      connection_id: params.connectionId,
      entity_type: 'inbound_shipment',
      local_entity_type: 'inbound_shipment',
      local_entity_id: shipment.id,
      external_id: externalId,
      external_secondary_id: shipment.tracking_number,
      external_data: {
        source: 'worldsyntech_ofs',
        shipment: request,
        response: result.data,
      },
      remote_hash: stableWorldsyntechHash(result.data),
    })
  }

  const { data: updated, error: upErr } = await client
    .from('inbound_shipments')
    .update({
      status: 'asn_sent',
      connection_id: params.connectionId,
      external_stock_incoming_main_id: mainId || null,
      external_stock_incoming_ids: mapped.external_ids || [],
      metadata: {
        ...(shipment.metadata || {}),
        loft_create: mapped.raw,
      },
    })
    .eq('id', shipment.id)
    .select()
    .single()

  if (upErr) throw upErr
  return { shipment: updated, result: mapped, credentials: result.credentials }
}

export async function pollInboundFromLoft(
  client: SupabaseClient,
  params: {
    workspaceId: string
    connectionId: string
    credentials: WorldsyntechCredentials
    offset?: number
    limit?: number
  },
) {
  const offset = Math.max(0, params.offset || 0)
  const limit = Math.min(Math.max(params.limit || 50, 1), 250)

  const page = await fetchWorldsyntechApi<Record<string, unknown>[]>(
    params.credentials,
    'rest_customer/ship_to_warehouse/get_list',
    { offset, limit },
  )

  const rows = Array.isArray(page.data) ? page.data : []
  let updated = 0

  for (const raw of rows) {
    const stockIds = (raw as any).stock_incoming_id
    const ids = Array.isArray(stockIds) ? stockIds.map(String) : stockIds ? [String(stockIds)] : []
    const mainId = String((raw as any).stock_incoming_main_id || '')
    const tracking = String((raw as any).tracking_number || (raw as any).tracking_no || '').trim()
    const remoteStatus = String((raw as any).status || (raw as any).status_id || '').trim()

    // Match local ASN by tracking or external ids
    let q = client
      .from('inbound_shipments')
      .select('id, status, metadata, external_stock_incoming_ids')
      .eq('workspace_id', params.workspaceId)

    if (tracking) {
      q = q.eq('tracking_number', tracking)
    } else if (mainId) {
      q = q.eq('external_stock_incoming_main_id', mainId)
    } else {
      continue
    }

    const { data: locals } = await q.limit(5)
    for (const local of locals || []) {
      const skumsStatus = mapInboundRemoteStatus(remoteStatus, local.status)
      const receivedQty = Number((raw as any).received_quantity ?? (raw as any).quantity_received ?? NaN)
      const pendingQty = Number((raw as any).pending_quantity ?? NaN)

      await client
        .from('inbound_shipments')
        .update({
          status: skumsStatus,
          external_status: remoteStatus || null,
          external_stock_incoming_main_id: mainId || undefined,
          external_stock_incoming_ids: ids.length ? ids : local.external_stock_incoming_ids,
          received_at: skumsStatus === 'fully_received' || skumsStatus === 'partial_received'
            ? new Date().toISOString()
            : undefined,
          metadata: {
            ...(local.metadata || {}),
            last_polled_at: new Date().toISOString(),
            last_remote: raw,
            received_quantity: Number.isFinite(receivedQty) ? receivedQty : null,
            pending_quantity: Number.isFinite(pendingQty) ? pendingQty : null,
          },
        })
        .eq('id', local.id)

      await upsertIntegrationEntityMapping(client, {
        workspace_id: params.workspaceId,
        connection_id: params.connectionId,
        entity_type: 'inbound_shipment',
        local_entity_type: 'inbound_shipment',
        local_entity_id: local.id,
        external_id: ids[0] || mainId || tracking,
        external_secondary_id: tracking || null,
        external_data: { source: 'worldsyntech_ofs', order: raw },
        remote_hash: stableWorldsyntechHash(raw),
      })
      updated += 1
    }
  }

  return {
    remote_count: rows.length,
    updated,
    has_more: rows.length >= limit,
    next_offset: rows.length >= limit ? offset + limit : null,
    credentials: page.credentials,
  }
}

function mapInboundRemoteStatus(remote: string, current: string): InboundStatus {
  const r = remote.toLowerCase()
  if (!r) return current as InboundStatus
  if (r.includes('cancel')) return 'cancelled'
  if (r.includes('partial')) return 'partial_received'
  if (r.includes('receiv') || r.includes('complete') || r.includes('close')) return 'fully_received'
  if (r.includes('arriv') || r.includes('dock')) return 'loft_receiving'
  if (r.includes('transit') || r.includes('ship')) return 'in_transit'
  return (current as InboundStatus) || 'asn_sent'
}

/**
 * LISE confirm: lock received qtys, optional expiry, promote to LOFT-SG on_hand.
 */
export async function confirmInboundAndPromote(
  client: SupabaseClient,
  params: {
    workspaceId: string
    shipmentId: string
    confirmedBy?: string | null
    lineUpdates?: Array<{
      line_id: string
      quantity_received?: number
      quantity_spoil?: number
      expiry_year?: number | null
      expiry_month?: number | null
      expiry_day?: number | null
    }>
    forcePromote?: boolean
  },
) {
  const { data: shipment, error } = await client
    .from('inbound_shipments')
    .select('*, lines:inbound_shipment_lines(*)')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.shipmentId)
    .maybeSingle()

  if (error) throw error
  if (!shipment) throw Object.assign(new Error('Shipment not found'), { statusCode: 404 })

  const allowed = ['partial_received', 'fully_received', 'loft_receiving', 'asn_sent', 'in_transit', 'lise_confirmed']
  if (!allowed.includes(shipment.status) && !params.forcePromote) {
    throw Object.assign(
      new Error(`Cannot confirm shipment in status ${shipment.status}`),
      { statusCode: 409 },
    )
  }

  // Apply line updates
  for (const upd of params.lineUpdates || []) {
    const patch: Record<string, unknown> = {}
    if (upd.quantity_received != null) {
      patch.quantity_received = upd.quantity_received
      patch.status = upd.quantity_received > 0 ? 'received' : 'declared'
    }
    if (upd.quantity_spoil != null) patch.quantity_spoil = upd.quantity_spoil
    if (upd.expiry_year != null) patch.expiry_year = upd.expiry_year
    if (upd.expiry_month != null) patch.expiry_month = upd.expiry_month
    if (upd.expiry_day != null) patch.expiry_day = upd.expiry_day
    if (Object.keys(patch).length) {
      await client
        .from('inbound_shipment_lines')
        .update(patch)
        .eq('id', upd.line_id)
        .eq('shipment_id', shipment.id)
    }
  }

  const { data: lines } = await client
    .from('inbound_shipment_lines')
    .select('*')
    .eq('shipment_id', shipment.id)

  const loftId = shipment.destination_location_id || await resolveLoftLocationId(client, params.workspaceId)
  if (!loftId) {
    throw Object.assign(new Error('LOFT-SG inventory location missing — run seed_workspace_inventory_locations'), { statusCode: 400 })
  }

  // New SKU gate: block promote if product unmapped
  const missingProduct = (lines || []).filter((l: any) => !l.product_id)
  if (missingProduct.length) {
    throw Object.assign(
      new Error(`${missingProduct.length} line(s) missing product_id — map SKUs before promote`),
      { statusCode: 400, data: { skus: missingProduct.map((l: any) => l.sku) } },
    )
  }

  const promoted = []
  const alreadyPromoted = Boolean((shipment.metadata as any)?.promoted_at)

  if (!alreadyPromoted) {
    for (const line of lines || []) {
      // Default: promote declared qty if received not set
      const qty = Number(line.quantity_received || 0) > 0
        ? Number(line.quantity_received)
        : Number(line.quantity || 0)
      const spoil = Number(line.quantity_spoil || 0)
      const good = Math.max(0, qty - spoil)
      if (good <= 0 || !line.product_id) continue

      await client.rpc('upsert_inventory_level', {
        p_workspace_id: params.workspaceId,
        p_product_id: line.product_id,
        p_variant_id: line.variant_id || null,
        p_location_id: loftId,
        p_quantity_type: 'on_hand',
        p_delta: good,
        p_movement_type: 'po_received',
        p_reference_type: 'inbound_shipment',
        p_reference_id: shipment.id,
        p_notes: `LISE confirm ASN ${shipment.shipment_number} ${line.sku}`,
        p_created_by: params.confirmedBy || null,
      })

      // Optional expiry batch (SOW parity when OFS lacks expiry fields)
      if (line.expiry_year && line.expiry_month) {
        try {
          const { data: batch } = await client
            .from('expiry_batches')
            .insert({
              workspace_id: params.workspaceId,
              batch_code: `${shipment.shipment_number}-${line.sku}`,
              received_at: new Date().toISOString().slice(0, 10),
              notes: `From inbound ${shipment.tracking_number}`,
              source: 'integration',
              source_ref: shipment.id,
            })
            .select('id')
            .single()

          if (batch?.id) {
            await client.from('expiry_items').insert({
              workspace_id: params.workspaceId,
              batch_id: batch.id,
              product_id: line.product_id,
              raw_sku: line.sku,
              quantity: good,
              remaining_qty: good,
              expiry_year: line.expiry_year,
              expiry_month: line.expiry_month,
              expiry_day: line.expiry_day || null,
              status: 'in_stock',
            })
          }
        } catch {
          // expiry optional — do not fail promote
        }
      }

      promoted.push({ sku: line.sku, product_id: line.product_id, qty: good })
    }
  }

  const now = new Date().toISOString()
  const { data: updated, error: upErr } = await client
    .from('inbound_shipments')
    .update({
      status: 'available',
      confirmed_at: now,
      confirmed_by: params.confirmedBy || null,
      metadata: {
        ...(shipment.metadata || {}),
        promoted_at: alreadyPromoted ? (shipment.metadata as any).promoted_at : now,
        promoted_lines: promoted,
      },
    })
    .eq('id', shipment.id)
    .select()
    .single()

  if (upErr) throw upErr

  return {
    shipment: updated,
    promoted,
    already_promoted: alreadyPromoted,
    message: alreadyPromoted
      ? 'Already promoted; status set to available'
      : `Promoted ${promoted.length} line(s) to LOFT-SG`,
  }
}
