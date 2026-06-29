const POS_INVENTORY_EVENT_TYPES = [
  'inventory.damage.reported',
  'inventory.found_stock.reported',
  'inventory.transfer_receive.reported',
] as const

type PosInventoryEventType = (typeof POS_INVENTORY_EVENT_TYPES)[number]

function isPosInventoryEventType(value: unknown): value is PosInventoryEventType {
  return typeof value === 'string' && POS_INVENTORY_EVENT_TYPES.includes(value as PosInventoryEventType)
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function positiveInt(value: unknown) {
  const parsed = Math.floor(Number(value) || 0)
  return parsed > 0 ? parsed : 0
}

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function newAdjustmentNumber(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`
}

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'pos:write')
  const client = getAdminClient()
  const body = await readBody(event)
  const eventType = body.event_type || body.event

  if (!isPosInventoryEventType(eventType)) {
    throw createError({ statusCode: 400, statusMessage: 'event_type must be a supported POS inventory event' })
  }

  const idempotencyKey = trimString(body.idempotency_key)
  if (idempotencyKey) {
    const { data: existing, error: existingError } = await client
      .from('pos_inventory_events')
      .select('*')
      .eq('workspace_id', ctx.workspaceId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    if (existingError) throw createError({ statusCode: 500, statusMessage: existingError.message })
    if (existing) return { data: existing, duplicate: true }
  }

  const productInput = asRecord(body.product)
  const storeInput = asRecord(body.store)
  const locationInput = asRecord(body.location)
  const quantity = positiveInt(body.quantity)
  const sku = trimString(body.sku || productInput.sku)
  const posLocationCode = trimString(body.pos_location_code || storeInput.code)
  const storageLocationCode = trimString(body.storage_location_code || locationInput.storage_location_code)
  const reference = trimString(body.reference)
  const reasonCode = trimString(body.reason_code || body.reason || body.adjustment_type)

  const { data: posLocation, error: posLocationError } = posLocationCode
    ? await client
        .from('pos_locations')
        .select('id, inventory_location_id')
        .eq('workspace_id', ctx.workspaceId)
        .eq('code', posLocationCode)
        .maybeSingle()
    : { data: null, error: null }

  if (posLocationError) throw createError({ statusCode: 500, statusMessage: posLocationError.message })

  const explicitInventoryLocationId = trimString(body.inventory_location_id || storeInput.inventory_location_id)
  const inventoryLocationId = explicitInventoryLocationId || posLocation?.inventory_location_id || null

  let productId = trimString(body.product_id || productInput.product_id || productInput.id) || null
  const variantId = trimString(body.variant_id || productInput.variant_id) || null

  if (!productId && sku) {
    const { data: product, error: productError } = await client
      .from('products')
      .select('id')
      .eq('workspace_id', ctx.workspaceId)
      .eq('sku', sku)
      .maybeSingle()

    if (productError) throw createError({ statusCode: 500, statusMessage: productError.message })
    productId = product?.id || null
  }

  let status: 'received' | 'pending_approval' | 'applied' | 'failed' = 'received'
  let adjustmentId: string | null = null
  let transferId = trimString(body.transfer_id) || null
  let result: Record<string, any> = {}
  let errorMessage: string | null = null

  try {
    if (eventType === 'inventory.damage.reported' || eventType === 'inventory.found_stock.reported') {
      status = 'pending_approval'

      if (!productId || !inventoryLocationId || quantity <= 0) {
        errorMessage = 'Pending product, location, or quantity resolution before adjustment can be created'
      } else {
        const { data: level, error: levelError } = await client
          .from('inventory_levels')
          .select('on_hand')
          .eq('workspace_id', ctx.workspaceId)
          .eq('product_id', productId)
          .eq('location_id', inventoryLocationId)
          .maybeSingle()

        if (levelError) throw levelError

        const systemQty = Number(level?.on_hand || 0)
        const countedQty = eventType === 'inventory.found_stock.reported'
          ? systemQty + quantity
          : Math.max(0, systemQty - quantity)
        const adjustmentType = eventType === 'inventory.found_stock.reported' ? 'found' : 'damage'
        const adjustmentNumber = newAdjustmentNumber(adjustmentType === 'found' ? 'POS-FOUND' : 'POS-DMG')

        const { data: adjustment, error: adjustmentError } = await client
          .from('inventory_adjustments')
          .insert({
            workspace_id: ctx.workspaceId,
            adjustment_number: adjustmentNumber,
            location_id: inventoryLocationId,
            adjustment_type: adjustmentType,
            status: 'pending',
            notes: body.note || body.notes || null,
          })
          .select('id, adjustment_number, status')
          .single()

        if (adjustmentError) throw adjustmentError

        const { error: lineError } = await client
          .from('inventory_adjustment_lines')
          .insert({
            adjustment_id: adjustment.id,
            product_id: productId,
            variant_id: variantId,
            system_qty: systemQty,
            counted_qty: countedQty,
            reason: reasonCode || adjustmentType,
          })

        if (lineError) throw lineError

        adjustmentId = adjustment.id
        result = { adjustment }
      }
    }

    if (eventType === 'inventory.transfer_receive.reported') {
      if (!transferId) {
        const transferNumber = trimString(body.transfer_number || reference)
        if (transferNumber) {
          const { data: transfer, error: transferError } = await client
            .from('inventory_transfers')
            .select('id')
            .eq('workspace_id', ctx.workspaceId)
            .eq('transfer_number', transferNumber)
            .maybeSingle()

          if (transferError) throw transferError
          transferId = transfer?.id || null
        }
      }

      if (!transferId) {
        status = 'pending_approval'
        errorMessage = 'Pending transfer resolution before receipt can be applied'
      } else {
        const receiptsInput = Array.isArray(body.receipts) ? body.receipts : []
        const itemsInput = Array.isArray(body.items) ? body.items : []
        let receipts = receiptsInput
          .map((item: any) => ({ line_id: trimString(item.line_id), qty: positiveInt(item.qty ?? item.quantity) }))
          .filter((item: any) => item.line_id && item.qty > 0)

        if (receipts.length === 0 && itemsInput.length > 0) {
          const { data: lines, error: linesError } = await client
            .from('inventory_transfer_lines')
            .select('id, product_id, requested_qty, received_qty, product:products(sku)')
            .eq('transfer_id', transferId)

          if (linesError) throw linesError

          receipts = itemsInput.flatMap((item: any) => {
            const itemSku = trimString(item.sku || item.product?.sku)
            const itemProductId = trimString(item.product_id || item.product?.product_id || item.product?.id)
            const match = (lines || []).find((line: any) =>
              (itemProductId && line.product_id === itemProductId) ||
              (itemSku && line.product?.sku === itemSku)
            )
            if (!match) return []
            const remaining = Math.max(0, Number(match.requested_qty || 0) - Number(match.received_qty || 0))
            const qty = Math.min(positiveInt(item.qty ?? item.quantity), remaining)
            return qty > 0 ? [{ line_id: match.id, qty }] : []
          })
        }

        if (receipts.length === 0) {
          status = 'pending_approval'
          errorMessage = 'Pending transfer line resolution before receipt can be applied'
        } else {
          const { data, error } = await client.rpc('receive_inventory_transfer', {
            p_transfer_id: transferId,
            p_receipts: receipts,
            p_created_by: null,
          })

          if (error) throw error
          status = 'applied'
          result = { transfer_id: transferId, receipts, rpc: data }
        }
      }
    }
  } catch (err: any) {
    status = 'failed'
    errorMessage = err?.message || 'Failed to process POS inventory event'
  }

  const { data: saved, error: saveError } = await client
    .from('pos_inventory_events')
    .insert({
      workspace_id: ctx.workspaceId,
      event_type: eventType,
      status,
      source: body.source || 'vantage_pos',
      idempotency_key: idempotencyKey || null,
      pos_location_id: posLocation?.id || null,
      inventory_location_id: inventoryLocationId,
      register_id: trimString(body.register_id) || null,
      register_session_id: trimString(body.register_session_id) || null,
      transfer_id: transferId,
      product_identity_id: trimString(body.product_identity_id || productInput.product_identity_id) || null,
      trade_unit_id: trimString(body.trade_unit_id || productInput.trade_unit_id) || null,
      listing_id: trimString(body.listing_id || productInput.listing_id) || null,
      channel_id: trimString(body.channel_id || productInput.channel_id) || null,
      sku_assignment_id: trimString(body.sku_assignment_id || productInput.sku_assignment_id) || null,
      identifier_id: trimString(body.identifier_id || productInput.identifier_id) || null,
      product_id: productId,
      variant_id: variantId,
      sku: sku || null,
      quantity: quantity || null,
      storage_location_code: storageLocationCode || null,
      reason_code: reasonCode || null,
      reference: reference || null,
      adjustment_id: adjustmentId,
      payload: body,
      result,
      error_message: errorMessage,
      occurred_at: body.occurred_at || new Date().toISOString(),
      processed_at: status === 'applied' || status === 'pending_approval' || status === 'failed' ? new Date().toISOString() : null,
    })
    .select('*')
    .single()

  if (saveError) throw createError({ statusCode: 500, statusMessage: saveError.message })

  const domainEventKey = idempotencyKey ? `${idempotencyKey}:domain_event` : `pos-inventory-event:${saved.id}:domain_event`
  const { data: domainEvent, error: domainEventError } = await client
    .from('domain_events')
    .insert({
      workspace_id: ctx.workspaceId,
      event_type: `pos.${eventType}`,
      source_type: 'app',
      source_app_key: 'pos',
      aggregate_type: 'pos_inventory_event',
      aggregate_id: saved.id,
      idempotency_key: domainEventKey,
      payload: {
        inventory_event: saved,
      },
      metadata: {
        status,
        sku: sku || null,
        reference: reference || null,
      },
    })
    .select()
    .maybeSingle()

  if (domainEventError && domainEventError.code !== '23505') {
    throw createError({ statusCode: 500, statusMessage: domainEventError.message })
  }

  let attentionItem: Record<string, any> | null = null
  if (status === 'pending_approval' || status === 'failed') {
    const attentionKey = idempotencyKey ? `${idempotencyKey}:attention` : `pos-inventory-event:${saved.id}:attention`
    const action = eventType === 'inventory.transfer_receive.reported'
      ? 'Resolve the reported transfer receipt against an open transfer and transfer lines.'
      : 'Review and approve the pending inventory adjustment from the POS floor event.'

    const { data: insertedAttention, error: attentionError } = await client
      .from('product_attention_items')
      .insert({
        workspace_id: ctx.workspaceId,
        attention_type: eventType,
        risk_level: status === 'failed' ? 'high' : eventType === 'inventory.damage.reported' ? 'medium' : 'low',
        status: 'open',
        source_type: 'pos',
        source_app_key: 'pos',
        source_event_id: domainEvent?.id || null,
        product_identity_id: saved.product_identity_id,
        trade_unit_id: saved.trade_unit_id,
        listing_id: saved.listing_id,
        channel_id: saved.channel_id,
        sku_assignment_id: saved.sku_assignment_id,
        identifier_id: saved.identifier_id,
        product_id: saved.product_id,
        variant_id: saved.variant_id,
        title: `POS inventory event needs attention: ${eventType}`,
        summary: errorMessage || `SKU ${sku || 'unknown'} requires inventory review from POS intake.`,
        recommended_action: action,
        evidence: {
          pos_inventory_event: saved,
          result,
        },
        metadata: {
          status,
          source: saved.source,
          adjustment_id: adjustmentId,
          transfer_id: transferId,
        },
        idempotency_key: attentionKey,
      })
      .select()
      .maybeSingle()

    if (attentionError && attentionError.code !== '23505') {
      throw createError({ statusCode: 500, statusMessage: attentionError.message })
    }
    attentionItem = insertedAttention || null
  }

  setResponseStatus(event, status === 'applied' ? 201 : 202)
  return { data: saved, event: domainEvent || null, attention_item: attentionItem }
})
