import { createInventoryAdjustment } from '../../utils/inventoryAdjustments'

/**
 * Report floor damage / found stock / cycle count from HQ UI (or API).
 * Creates a pending adjustment — does NOT change the ledger until Apply.
 *
 * Body:
 *   workspace_id, location_id | location_code
 *   adjustment_type: damage | found | stocktake
 *   sku | product_id
 *   quantity  (for damage/found = delta units; for stocktake = absolute count)
 *   notes?, submit? (default true → pending)
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({} as Record<string, unknown>))
  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const client = getServiceClient()
  await requireScope(event, 'store_ops:write', {
    workspaceId,
    client,
    accessLevel: 'member',
  }).catch(async () =>
    requireScope(event, 'inventory:write', { workspaceId, client, accessLevel: 'member' }),
  )

  const adjustmentTypeRaw = String(body.adjustment_type || body.type || 'damage').toLowerCase()
  const adjustmentType =
    adjustmentTypeRaw === 'found' || adjustmentTypeRaw === 'found_stock'
      ? 'found'
      : adjustmentTypeRaw === 'stocktake' || adjustmentTypeRaw === 'cycle_count' || adjustmentTypeRaw === 'count'
        ? 'stocktake'
        : 'damage'

  let locationId = body.location_id ? String(body.location_id) : ''
  const locationCode = String(body.location_code || body.store_code || 'ST-MAIN').trim().toUpperCase()

  if (!locationId) {
    const { data: loc, error: locErr } = await client
      .from('inventory_locations')
      .select('id, code')
      .eq('workspace_id', workspaceId)
      .eq('code', locationCode)
      .maybeSingle()
    if (locErr) throw createError({ statusCode: 500, statusMessage: locErr.message })
    if (!loc) {
      throw createError({
        statusCode: 404,
        statusMessage: `Location not found for code ${locationCode}`,
      })
    }
    locationId = loc.id
  }

  let productId = body.product_id ? String(body.product_id) : ''
  const sku = String(body.sku || '').trim()
  if (!productId && sku) {
    const { data: product, error: pErr } = await client
      .from('products')
      .select('id, sku, title')
      .eq('workspace_id', workspaceId)
      .eq('sku', sku)
      .maybeSingle()
    if (pErr) throw createError({ statusCode: 500, statusMessage: pErr.message })
    if (!product) {
      throw createError({ statusCode: 404, statusMessage: `Product not found for SKU ${sku}` })
    }
    productId = product.id
  }
  if (!productId) {
    throw createError({ statusCode: 400, statusMessage: 'sku or product_id is required' })
  }

  const quantity = Math.floor(Number(body.quantity ?? body.qty ?? 0))
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw createError({ statusCode: 400, statusMessage: 'quantity must be a non-negative integer' })
  }
  if (adjustmentType !== 'stocktake' && quantity <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'quantity must be > 0 for damage/found' })
  }

  const { data: level, error: levelErr } = await client
    .from('inventory_levels')
    .select('on_hand')
    .eq('workspace_id', workspaceId)
    .eq('product_id', productId)
    .eq('location_id', locationId)
    .maybeSingle()
  if (levelErr) throw createError({ statusCode: 500, statusMessage: levelErr.message })

  const systemQty = Number(level?.on_hand || 0)
  let countedQty: number
  if (adjustmentType === 'stocktake') {
    countedQty = quantity
  } else if (adjustmentType === 'found') {
    countedQty = systemQty + quantity
  } else {
    // damage: reduce on-hand by quantity
    countedQty = Math.max(0, systemQty - quantity)
  }

  const submit = body.submit !== false && body.dry_run !== true
  const status = submit ? 'pending' : 'draft'
  const notes =
    String(body.notes || body.note || body.reason || '').trim()
    || `${adjustmentType}: ${quantity} unit(s) of ${sku || productId}`

  if (body.dry_run === true) {
    return {
      dry_run: true,
      would_create: {
        adjustment_type: adjustmentType,
        location_id: locationId,
        status,
        system_qty: systemQty,
        counted_qty: countedQty,
        variance: countedQty - systemQty,
        notes,
      },
      message: 'Dry run — no write. Stock only changes after HQ Apply on the floor queue.',
    }
  }

  try {
    const result = await createInventoryAdjustment(client, {
      workspaceId,
      locationId,
      adjustmentType,
      status,
      notes,
      // created_by FK is profiles.id — omit rather than pass auth.users id
      createdBy: null,
      channel: 'ui',
      lines: [
        {
          product_id: productId,
          system_qty: systemQty,
          counted_qty: countedQty,
          reason: String(body.reason || adjustmentType),
        },
      ],
    })

    return {
      data: result.adjustment,
      lines: result.lines,
      system_qty: systemQty,
      counted_qty: countedQty,
      variance: countedQty - systemQty,
      ledger_pending: true,
      message:
        'Floor adjustment created as pending. HQ confirms on Actions → Floor / POS signals (or Store Ops → Floor). Stock does not change until Apply.',
      deep_link: '/actions?tab=floor',
      store_ops_link: '/store-ops?tab=floor',
    }
  } catch (e: any) {
    throw createError({
      statusCode: e?.statusCode || 500,
      statusMessage: e?.message || 'Failed to create floor adjustment',
    })
  }
})
