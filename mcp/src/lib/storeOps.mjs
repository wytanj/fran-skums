/**
 * MCP store ops helpers (read + draft request write).
 * Never approve or send to Loft (no execute_3pl).
 */
import { getDb, getMcpActorUserId, requireWorkspaceId } from '../context.mjs'

function trimString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveInt(value) {
  const parsed = Math.floor(Number(value) || 0)
  return parsed > 0 ? parsed : 0
}

function requestNumber() {
  return `MCP-REQ-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 9999)
    .toString()
    .padStart(4, '0')}`
}

/**
 * Resolve store inventory location (explicit id/code or first active store).
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {string} workspaceId
 * @param {{ store_location_id?: string|null, store_location_code?: string|null }} opts
 */
async function resolveStoreLocation(db, workspaceId, opts = {}) {
  if (opts.store_location_id) {
    const { data, error } = await db
      .from('inventory_locations')
      .select('id, code, name, location_type')
      .eq('workspace_id', workspaceId)
      .eq('id', opts.store_location_id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('store_location_id not found')
    return data
  }
  if (opts.store_location_code) {
    const code = String(opts.store_location_code).trim().toUpperCase()
    const { data, error } = await db
      .from('inventory_locations')
      .select('id, code, name, location_type')
      .eq('workspace_id', workspaceId)
      .eq('code', code)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error(`store location code ${code} not found`)
    return data
  }
  const { data, error } = await db
    .from('inventory_locations')
    .select('id, code, name, location_type')
    .eq('workspace_id', workspaceId)
    .eq('location_type', 'store')
    .eq('is_active', true)
    .order('code')
    .limit(1)
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    throw new Error(
      'No store inventory location — seed ST-MAIN (migration 062) or pass store_location_code',
    )
  }
  return row
}

/**
 * Resolve product_id for lines (optional enrichment).
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {string} workspaceId
 * @param {string[]} skus
 */
async function resolveProductsBySku(db, workspaceId, skus) {
  if (!skus.length) return new Map()
  const { data, error } = await db
    .from('products')
    .select('id, sku, title')
    .eq('workspace_id', workspaceId)
    .in('sku', skus.slice(0, 50))
  if (error) throw new Error(error.message)
  /** @type {Map<string, { id: string, sku: string|null, title: string }>} */
  const map = new Map()
  for (const p of data || []) {
    if (p.sku) map.set(String(p.sku), p)
  }
  return map
}

export async function listOpenRequests(opts = {}) {
  const workspace_id = requireWorkspaceId()
  const db = getDb()
  const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 100)
  let q = db
    .from('store_replenishment_requests')
    .select('id, request_number, status, priority, needed_by, reason, decision, wave_date, created_at, pos_location_id, store_location_id, metadata')
    .eq('workspace_id', workspace_id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (opts.status) {
    q = q.eq('status', String(opts.status))
  } else {
    q = q.in('status', ['submitted', 'in_review', 'deferred_to_wave'])
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return { requests: data || [], advisory_only: true }
}

export async function listWaves(opts = {}) {
  const workspace_id = requireWorkspaceId()
  const db = getDb()
  const { data: waves, error } = await db
    .from('store_replenishment_waves')
    .select('*')
    .eq('workspace_id', workspace_id)
    .order('wave_date', { ascending: true })
    .limit(Math.min(Math.max(Number(opts.limit) || 12, 1), 40))

  if (error) throw new Error(error.message)

  const { data: dates } = await db.rpc('next_replenishment_wave_dates', {
    p_workspace_id: workspace_id,
    p_from: new Date().toISOString().slice(0, 10),
    p_count: 6,
  })

  return {
    waves: waves || [],
    upcoming_dates: dates || [],
    cadence_note: 'Default Mon+Thu unless store_ops_settings.wave_weekdays overrides',
    advisory_only: true,
  }
}

export async function recommendDecision(requestId) {
  const workspace_id = requireWorkspaceId()
  const db = getDb()
  const { data: request, error } = await db
    .from('store_replenishment_requests')
    .select('*, lines:store_replenishment_request_lines(*)')
    .eq('workspace_id', workspace_id)
    .eq('id', requestId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!request) throw new Error('Request not found')

  const lines = Array.isArray(request.lines) ? request.lines : []
  const { data: dates } = await db.rpc('next_replenishment_wave_dates', {
    p_workspace_id: workspace_id,
    p_from: new Date().toISOString().slice(0, 10),
    p_count: 4,
  })
  const waves = dates || []

  const reasons = []
  let score = 0
  if (request.priority === 'critical') {
    score += 3
    reasons.push('Priority critical')
  } else if (request.priority === 'urgent') {
    score += 2
    reasons.push('Priority urgent')
  } else {
    reasons.push('Normal priority — weekly Mon/Thu wave may be sufficient')
  }

  if (request.needed_by && waves[0]?.wave_date) {
    if (new Date(request.needed_by) < new Date(waves[0].wave_date)) {
      score += 2
      reasons.push(`needed_by before next wave ${waves[0].wave_date}`)
    }
  }

  let lowStockLines = 0
  if (request.store_location_id) {
    for (const line of lines) {
      if (!line.product_id) continue
      const { data: level } = await db
        .from('inventory_levels')
        .select('on_hand, reserved')
        .eq('workspace_id', workspace_id)
        .eq('location_id', request.store_location_id)
        .eq('product_id', line.product_id)
        .maybeSingle()
      const available = Math.max(0, Number(level?.on_hand || 0) - Number(level?.reserved || 0))
      if (available < Number(line.requested_qty || 0)) lowStockLines += 1
    }
  }
  if (lowStockLines > 0) {
    score += 1
    reasons.push(`${lowStockLines} line(s) below requested qty at store`)
  }

  const recommendation = score >= 3 ? 'approve_now' : 'defer_to_wave'

  return {
    advisory_only: true,
    message: 'Human must call store-ops decide API with store_ops:approve. MCP cannot approve or send to Loft.',
    request_id: request.id,
    request_number: request.request_number,
    recommendation,
    reasons,
    baseline: {
      next_wave_dates: waves,
      line_count: lines.length,
      cadence: 'Monday + Thursday default',
    },
    lift: {
      priority: request.priority,
      needed_by: request.needed_by,
      low_stock_lines: lowStockLines,
      score,
    },
  }
}

/**
 * Create a store replenishment request from MCP.
 * Default status=draft (like internal PO). Optional submit=true → submitted (HQ queue, still no Loft).
 * Never approve / execute_3pl.
 *
 * @param {{
 *   lines: Array<{ sku?: string, product_id?: string, requested_qty?: number, quantity?: number, reason?: string }>,
 *   priority?: string,
 *   reason?: string|null,
 *   needed_by?: string|null,
 *   store_location_id?: string|null,
 *   store_location_code?: string|null,
 *   pos_location_id?: string|null,
 *   idempotency_key?: string|null,
 *   submit?: boolean,
 *   dry_run?: boolean,
 * }} opts
 */
export async function createDraftRequest(opts = {}) {
  const workspace_id = requireWorkspaceId()
  const db = getDb()
  const dry_run = opts.dry_run === true
  const submit = opts.submit === true
  const status = submit ? 'submitted' : 'draft'

  const rawLines = Array.isArray(opts.lines) ? opts.lines : []
  const normalized = rawLines
    .map((line) => ({
      sku: trimString(line.sku || line.barcode || line.identifier),
      product_id: line.product_id ? String(line.product_id) : null,
      requested_qty: positiveInt(line.requested_qty ?? line.quantity),
      reason: trimString(line.reason || opts.reason) || null,
    }))
    .filter((line) => (line.sku || line.product_id) && line.requested_qty > 0)

  if (!normalized.length) {
    throw new Error('lines must include at least one sku (or product_id) and positive quantity')
  }
  if (normalized.length > 40) {
    throw new Error('Max 40 lines per MCP store request')
  }

  // Fill SKU from product_id when needed
  const missingSkuIds = normalized.filter((l) => !l.sku && l.product_id).map((l) => l.product_id)
  if (missingSkuIds.length) {
    const { data: prods, error } = await db
      .from('products')
      .select('id, sku')
      .eq('workspace_id', workspace_id)
      .in('id', missingSkuIds)
    if (error) throw new Error(error.message)
    const byId = new Map((prods || []).map((p) => [p.id, p.sku]))
    for (const line of normalized) {
      if (!line.sku && line.product_id) line.sku = byId.get(line.product_id) || ''
    }
  }

  const stillMissing = normalized.filter((l) => !l.sku)
  if (stillMissing.length) {
    throw new Error('Every line needs a resolvable sku')
  }

  const store = await resolveStoreLocation(db, workspace_id, {
    store_location_id: opts.store_location_id,
    store_location_code: opts.store_location_code,
  })

  const productMap = await resolveProductsBySku(
    db,
    workspace_id,
    normalized.map((l) => l.sku),
  )

  const lineRows = normalized.map((line) => {
    const p = productMap.get(line.sku)
    return {
      sku: line.sku,
      product_id: line.product_id || p?.id || null,
      requested_qty: line.requested_qty,
      reason: line.reason,
      status: 'requested',
      metadata: {
        source: 'mcp',
        product_title: p?.title || null,
      },
    }
  })

  const unknown_skus = lineRows.filter((l) => !l.product_id).map((l) => l.sku)

  const priority = ['low', 'normal', 'urgent', 'critical'].includes(String(opts.priority || ''))
    ? String(opts.priority)
    : 'normal'

  const idempotency_key = trimString(opts.idempotency_key) || null
  if (idempotency_key && !dry_run) {
    const { data: existing, error: exErr } = await db
      .from('store_replenishment_requests')
      .select('id, request_number, status, priority, reason, created_at')
      .eq('workspace_id', workspace_id)
      .eq('idempotency_key', idempotency_key)
      .maybeSingle()
    if (exErr) throw new Error(exErr.message)
    if (existing) {
      return {
        duplicate: true,
        request: existing,
        lines: [],
        store_location: store,
        deep_link: '/store-ops',
        message: 'Idempotent hit — existing request returned. Not approved; not sent to Loft.',
        agent_hint: 'Do not create again. Human reviews at /store-ops.',
      }
    }
  }

  const headerPreview = {
    workspace_id,
    request_number: requestNumber(),
    request_type: 'manual',
    status,
    priority,
    source_type: 'skums',
    source_ref: 'mcp',
    idempotency_key,
    pos_location_id: opts.pos_location_id || null,
    store_location_id: store.id,
    needed_by: opts.needed_by || null,
    reason: opts.reason || null,
    metadata: {
      source_app: 'fran_mcp',
      created_via: 'store_ops_create_draft_request',
      submit_requested: submit,
      actor_user_id: getMcpActorUserId(),
    },
  }

  if (dry_run) {
    return {
      dry_run: true,
      would_create: {
        request: headerPreview,
        lines: lineRows,
        store_location: store,
        unknown_skus,
      },
      message:
        'Dry run only — no write. Call again without dry_run to create draft (or submit=true for HQ queue).',
      deep_link: '/store-ops',
      agent_hint: 'Confirm lines with user, then create. MCP still cannot approve or execute_3pl.',
    }
  }

  const { data: request, error: requestError } = await db
    .from('store_replenishment_requests')
    .insert(headerPreview)
    .select()
    .single()

  if (requestError) throw new Error(requestError.message)

  const { data: requestLines, error: lineError } = await db
    .from('store_replenishment_request_lines')
    .insert(
      lineRows.map((line) => ({
        ...line,
        workspace_id,
        request_id: request.id,
      })),
    )
    .select()

  if (lineError) {
    // best-effort cleanup
    await db.from('store_replenishment_requests').delete().eq('id', request.id)
    throw new Error(lineError.message)
  }

  return {
    duplicate: false,
    request,
    lines: requestLines || [],
    store_location: store,
    unknown_skus,
    hq_status: status === 'submitted' ? 'queued_for_review' : 'draft_not_in_queue',
    deep_link: '/store-ops',
    message:
      status === 'submitted'
        ? 'Request submitted to HQ queue. Human must approve and send to Loft — MCP will not execute_3pl.'
        : 'Draft request created. Not approved and not sent to Loft. Human opens /store-ops to submit/decide.',
    agent_hint:
      'Stop after create. Give request_number + /store-ops link. Never claim stock moved or Loft order placed.',
  }
}

function asnNumber() {
  return `ASN-MCP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 999)
    .toString()
    .padStart(3, '0')}`
}

function adjNumber() {
  return `ADJ-MCP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 999)
    .toString()
    .padStart(3, '0')}`
}

/**
 * Draft inbound ASN only — never send-to-loft / confirm.
 * @param {{
 *   tracking_number: string,
 *   date_estimate?: string|null,
 *   local_forwarder?: string|null,
 *   offshore_forwarder?: string|null,
 *   notes?: string|null,
 *   lines: Array<{ sku: string, quantity: number, product_id?: string }>,
 *   dry_run?: boolean,
 * }} opts
 */
export async function createInboundDraft(opts = {}) {
  const workspace_id = requireWorkspaceId()
  const db = getDb()
  const tracking = trimString(opts.tracking_number)
  if (!tracking) throw new Error('tracking_number required')

  const linesIn = Array.isArray(opts.lines) ? opts.lines : []
  const lines = linesIn
    .map((l) => ({
      sku: trimString(l.sku),
      quantity: positiveInt(l.quantity ?? l.requested_qty),
      product_id: l.product_id || null,
    }))
    .filter((l) => l.sku && l.quantity > 0)
  if (!lines.length) throw new Error('lines with sku + quantity required')

  const { data: loft } = await db
    .from('inventory_locations')
    .select('id, code')
    .eq('workspace_id', workspace_id)
    .eq('code', 'LOFT-SG')
    .maybeSingle()

  const header = {
    workspace_id,
    shipment_number: asnNumber(),
    status: 'draft',
    tracking_number: tracking,
    date_estimate: opts.date_estimate || null,
    local_forwarder: opts.local_forwarder || 'M&P',
    offshore_forwarder: opts.offshore_forwarder || null,
    notes: opts.notes || null,
    destination_location_id: loft?.id || null,
    metadata: { source: 'mcp', created_via: 'inbound_create_draft' },
    created_by: getMcpActorUserId(),
  }

  if (opts.dry_run === true) {
    return {
      dry_run: true,
      would_create: { shipment: header, lines },
      message: 'Dry run — no write. Call without dry_run to create draft ASN.',
      deep_link: '/store-ops',
      agent_hint: 'Human must send ASN to Loft and confirm receive. MCP never send-to-loft.',
    }
  }

  const { data: shipment, error } = await db
    .from('inbound_shipments')
    .insert(header)
    .select()
    .single()
  if (error) throw new Error(error.message)

  const { data: lineRows, error: lineErr } = await db
    .from('inbound_shipment_lines')
    .insert(
      lines.map((l) => ({
        workspace_id,
        shipment_id: shipment.id,
        sku: l.sku,
        product_id: l.product_id,
        quantity: l.quantity,
      })),
    )
    .select()

  if (lineErr) {
    await db.from('inbound_shipments').delete().eq('id', shipment.id)
    throw new Error(lineErr.message)
  }

  return {
    shipment,
    lines: lineRows || [],
    deep_link: '/store-ops',
    message: 'Draft ASN created. Not sent to Loft. Human uses Store Ops → Send to Loft / confirm.',
    agent_hint: 'Stop. Give shipment_number + tracking. Never claim inventory at LOFT-SG yet.',
  }
}

/**
 * Floor inventory adjustment draft/pending only — never apply to ledger.
 * @param {{
 *   location_code?: string|null,
 *   location_id?: string|null,
 *   adjustment_type?: string,
 *   notes?: string|null,
 *   lines: Array<{ sku?: string, product_id?: string, system_qty?: number, counted_qty: number, reason?: string }>,
 *   submit?: boolean,
 *   dry_run?: boolean,
 * }} opts
 */
export async function createFloorAdjustmentDraft(opts = {}) {
  const workspace_id = requireWorkspaceId()
  const db = getDb()
  const linesIn = Array.isArray(opts.lines) ? opts.lines : []
  if (!linesIn.length) throw new Error('lines required')

  let locationId = opts.location_id || null
  let locationCode = opts.location_code || 'ST-MAIN'
  if (!locationId) {
    const loc = await resolveStoreLocation(db, workspace_id, {
      store_location_code: locationCode,
    })
    locationId = loc.id
    locationCode = loc.code
  }

  const adjType = opts.adjustment_type || 'damage'
  const status = opts.submit === true ? 'pending' : 'draft'

  const resolvedLines = []
  for (const l of linesIn) {
    let productId = l.product_id || null
    const sku = trimString(l.sku)
    if (!productId && sku) {
      const { data: p } = await db
        .from('products')
        .select('id')
        .eq('workspace_id', workspace_id)
        .eq('sku', sku)
        .maybeSingle()
      productId = p?.id || null
    }
    if (!productId) continue
    resolvedLines.push({
      product_id: productId,
      system_qty: Number(l.system_qty ?? 0),
      counted_qty: Number(l.counted_qty),
      reason: l.reason || opts.notes || null,
    })
  }
  if (!resolvedLines.length) throw new Error('No resolvable product lines')

  const header = {
    workspace_id,
    adjustment_number: adjNumber(),
    location_id: locationId,
    adjustment_type: adjType,
    status,
    notes: opts.notes || `MCP floor adj (${locationCode})`,
    created_by: getMcpActorUserId(),
  }

  if (opts.dry_run === true) {
    return {
      dry_run: true,
      would_create: { adjustment: header, lines: resolvedLines },
      message: 'Dry run — no write. Create as draft/pending only; human Applies to ledger in Store Ops.',
      deep_link: '/store-ops',
      agent_hint: 'Never claim stock changed until HQ Apply to ledger.',
    }
  }

  const { data: adj, error } = await db.from('inventory_adjustments').insert(header).select().single()
  if (error) throw new Error(error.message)

  const { data: lines, error: lineErr } = await db
    .from('inventory_adjustment_lines')
    .insert(
      resolvedLines.map((l, i) => ({
        adjustment_id: adj.id,
        product_id: l.product_id,
        system_qty: l.system_qty,
        counted_qty: l.counted_qty,
        reason: l.reason,
        sort_order: i,
      })),
    )
    .select()

  if (lineErr) {
    await db.from('inventory_adjustments').delete().eq('id', adj.id)
    throw new Error(lineErr.message)
  }

  return {
    adjustment: adj,
    lines: lines || [],
    deep_link: '/store-ops',
    message: `Floor adjustment ${status}. NOT applied to ledger. Human must Apply under Floor adjustments.`,
    agent_hint: 'Stop. Link /store-ops. Never say inventory levels changed.',
  }
}
