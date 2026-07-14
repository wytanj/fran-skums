/**
 * MCP read-only store ops helpers (baseline / lift decision support).
 * Never approve or send to Loft.
 */
import { getDb, requireWorkspaceId } from '../context.mjs'

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
