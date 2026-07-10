/**
 * Internal PO operations for MCP (service-role Supabase).
 */
import {
  canDecidePo,
  canSubmitPo,
  exportPoPayload,
  makePoNumber,
  recomputePoTotals,
} from '../../../intelligence/po/service.mjs'
import {
  suggestOrderQty,
  suggestWeeklyUnitsFromSold,
} from '../../../intelligence/projection/engine.mjs'
import { getDb } from '../context.mjs'

async function loadPo(workspaceId, poId) {
  const db = getDb()
  const { data: po, error } = await db
    .from('internal_purchase_orders')
    .select('*')
    .eq('id', poId)
    .eq('workspace_id', workspaceId)
    .single()
  if (error || !po) return null
  const { data: lines } = await db
    .from('internal_purchase_order_lines')
    .select('*')
    .eq('po_id', poId)
    .order('line_number', { ascending: true })
  return { po, lines: lines ?? [] }
}

async function persistTotals(poId, workspaceId, lines) {
  const db = getDb()
  const { subtotal, line_count } = recomputePoTotals(lines)
  await db
    .from('internal_purchase_orders')
    .update({ subtotal, line_count })
    .eq('id', poId)
    .eq('workspace_id', workspaceId)
  return { subtotal, line_count }
}

export async function createDraft(input) {
  const db = getDb()
  if (input.idempotency_key) {
    const { data: existing } = await db
      .from('internal_purchase_orders')
      .select('*')
      .eq('workspace_id', input.workspace_id)
      .eq('idempotency_key', input.idempotency_key)
      .maybeSingle()
    if (existing) {
      const pack = await loadPo(input.workspace_id, existing.id)
      return { ...pack, deduped: true }
    }
  }

  const rawLines = Array.isArray(input.lines) ? input.lines : []
  const prepared = recomputePoTotals(
    rawLines.map((l) => ({
      title: String(l.title || 'Line').slice(0, 500),
      sku: l.sku || null,
      quantity: l.quantity,
      unit_cost: l.unit_cost ?? 0,
      currency: l.currency || input.currency || 'SGD',
      product_id: l.product_id || null,
      listing_id: l.listing_id || null,
      marketplace: l.marketplace || null,
      shop_id: l.shop_id || null,
      item_id: l.item_id || null,
      listing_url: l.listing_url || null,
      notes: l.notes || null,
      metadata: l.metadata || {},
    })),
  )

  const { data: po, error } = await db
    .from('internal_purchase_orders')
    .insert({
      workspace_id: input.workspace_id,
      po_number: makePoNumber('IPO'),
      status: 'draft',
      supplier_name: input.supplier_name || null,
      currency: input.currency || 'SGD',
      needed_by: input.needed_by || null,
      notes: input.notes || null,
      study_session_id: input.study_session_id || null,
      pipeline_candidate_id: input.pipeline_candidate_id || null,
      subtotal: prepared.subtotal,
      line_count: prepared.line_count,
      idempotency_key: input.idempotency_key || null,
      metadata: input.metadata || {},
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  if (prepared.lines.length) {
    const rows = prepared.lines.map((l) => ({
      po_id: po.id,
      workspace_id: input.workspace_id,
      line_number: l.line_number,
      product_id: l.product_id,
      listing_id: l.listing_id,
      title: l.title,
      sku: l.sku,
      quantity: l.quantity,
      unit_cost: l.unit_cost,
      currency: l.currency || po.currency,
      line_total: l.line_total,
      marketplace: l.marketplace,
      shop_id: l.shop_id,
      item_id: l.item_id,
      listing_url: l.listing_url,
      notes: l.notes,
      metadata: l.metadata || {},
    }))
    const { data: inserted, error: lineErr } = await db
      .from('internal_purchase_order_lines')
      .insert(rows)
      .select('*')
    if (lineErr) throw new Error(lineErr.message)
    return { po, lines: inserted ?? [], deduped: false }
  }
  return { po, lines: [], deduped: false }
}

export async function getPo(workspaceId, poId) {
  return loadPo(workspaceId, poId)
}

export async function listPos(workspaceId, filters = {}) {
  const db = getDb()
  let q = db
    .from('internal_purchase_orders')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200))
  if (filters.status) q = q.eq('status', filters.status)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function updateDraft(workspaceId, poId, patch) {
  const pack = await loadPo(workspaceId, poId)
  if (!pack) throw new Error('PO not found')
  if (pack.po.status !== 'draft') throw new Error('Only draft POs can be updated')
  const db = getDb()
  const update = {}
  for (const k of ['supplier_name', 'currency', 'needed_by', 'notes', 'metadata']) {
    if (patch[k] !== undefined) update[k] = patch[k]
  }
  if (Object.keys(update).length) {
    const { error } = await db
      .from('internal_purchase_orders')
      .update(update)
      .eq('id', poId)
      .eq('workspace_id', workspaceId)
    if (error) throw new Error(error.message)
  }
  return loadPo(workspaceId, poId)
}

export async function addLines(workspaceId, poId, newLines) {
  const pack = await loadPo(workspaceId, poId)
  if (!pack) throw new Error('PO not found')
  if (pack.po.status !== 'draft') throw new Error('Only draft POs can add lines')
  const db = getDb()
  const start = pack.lines.length
  const prepared = recomputePoTotals(
    (newLines || []).map((l, i) => ({
      title: String(l.title || 'Line').slice(0, 500),
      sku: l.sku || null,
      quantity: l.quantity,
      unit_cost: l.unit_cost ?? 0,
      currency: l.currency || pack.po.currency,
      product_id: l.product_id || null,
      listing_id: l.listing_id || null,
      marketplace: l.marketplace || null,
      shop_id: l.shop_id || null,
      item_id: l.item_id || null,
      listing_url: l.listing_url || null,
      notes: l.notes || null,
      metadata: l.metadata || {},
      line_number: start + i + 1,
    })),
  )
  if (prepared.lines.length) {
    const rows = prepared.lines.map((l) => ({
      po_id: poId,
      workspace_id: workspaceId,
      line_number: l.line_number,
      product_id: l.product_id,
      listing_id: l.listing_id,
      title: l.title,
      sku: l.sku,
      quantity: l.quantity,
      unit_cost: l.unit_cost,
      currency: l.currency,
      line_total: l.line_total,
      marketplace: l.marketplace,
      shop_id: l.shop_id,
      item_id: l.item_id,
      listing_url: l.listing_url,
      notes: l.notes,
      metadata: l.metadata || {},
    }))
    const { error } = await db.from('internal_purchase_order_lines').insert(rows)
    if (error) throw new Error(error.message)
  }
  const all = await loadPo(workspaceId, poId)
  await persistTotals(poId, workspaceId, all.lines)
  return loadPo(workspaceId, poId)
}

export async function submit(workspaceId, poId) {
  const pack = await loadPo(workspaceId, poId)
  if (!pack) throw new Error('PO not found')
  if (!canSubmitPo(pack.po.status)) throw new Error(`Cannot submit from status ${pack.po.status}`)
  if (!pack.lines.length) throw new Error('PO has no lines')
  const db = getDb()
  const { data, error } = await db
    .from('internal_purchase_orders')
    .update({ status: 'pending_approval', submitted_at: new Date().toISOString() })
    .eq('id', poId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return { po: data, lines: pack.lines }
}

export async function decide(input) {
  const pack = await loadPo(input.workspace_id, input.po_id)
  if (!pack) throw new Error('PO not found')
  if (!canDecidePo(pack.po.status, input.decision)) {
    throw new Error(`Cannot decide from status ${pack.po.status}`)
  }
  const db = getDb()
  const { data, error } = await db
    .from('internal_purchase_orders')
    .update({
      status: input.decision,
      approved_at: new Date().toISOString(),
      decision_note: input.decision_note || null,
    })
    .eq('id', input.po_id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return { po: data, lines: pack.lines }
}

export function exportPo(po, lines) {
  return exportPoPayload(po, lines)
}

export function suggestQty(input) {
  let weekly = input.units_per_week_high
  let basis = 'provided_weekly_high'
  if (weekly == null) {
    const s = suggestWeeklyUnitsFromSold(input.sold_lower_bounds || [])
    weekly = s.units_per_week_high
    basis = s.basis
  }
  return {
    suggested_quantity: suggestOrderQty(weekly, input.cover_weeks ?? 8),
    units_per_week_high: weekly,
    cover_weeks: input.cover_weeks ?? 8,
    basis,
    binding: false,
  }
}
