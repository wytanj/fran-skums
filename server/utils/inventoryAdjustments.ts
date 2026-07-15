import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAudit } from './audit'

export type AdjustmentStatus = 'draft' | 'pending' | 'approved' | 'applied' | 'rejected'
export type AdjustmentType =
  | 'correction'
  | 'stocktake'
  | 'damage'
  | 'theft'
  | 'expiry'
  | 'found'
  | 'return'

export async function listInventoryAdjustments(
  client: SupabaseClient,
  params: {
    workspaceId: string
    status?: string | string[] | null
    limit?: number
  },
) {
  const limit = Math.min(Math.max(params.limit || 50, 1), 200)
  let q = client
    .from('inventory_adjustments')
    .select(`
      *,
      location:inventory_locations(id, code, name, location_type),
      lines:inventory_adjustment_lines(
        id, product_id, variant_id, system_qty, counted_qty, reason, sort_order,
        product:products(id, sku, name)
      )
    `)
    .eq('workspace_id', params.workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (params.status) {
    const statuses = Array.isArray(params.status) ? params.status : [params.status]
    q = q.in('status', statuses)
  }

  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function applyInventoryAdjustment(
  client: SupabaseClient,
  params: {
    workspaceId: string
    adjustmentId: string
    appliedBy?: string | null
    note?: string | null
    channel?: 'ui' | 'api' | 'system'
  },
) {
  const { data: before, error: beforeErr } = await client
    .from('inventory_adjustments')
    .select('*, lines:inventory_adjustment_lines(*)')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.adjustmentId)
    .maybeSingle()

  if (beforeErr) throw beforeErr
  if (!before) throw Object.assign(new Error('Adjustment not found'), { statusCode: 404 })
  if (!['pending', 'approved'].includes(before.status)) {
    throw Object.assign(new Error(`Cannot apply adjustment in status ${before.status}`), { statusCode: 409 })
  }

  const { data: rpcResult, error: rpcError } = await client.rpc('apply_inventory_adjustment', {
    p_adjustment_id: params.adjustmentId,
    p_created_by: params.appliedBy || null,
    p_notes: params.note || null,
  })

  if (rpcError) {
    throw Object.assign(new Error(rpcError.message || 'Apply adjustment failed'), { statusCode: 500 })
  }

  const { data: after } = await client
    .from('inventory_adjustments')
    .select('*, lines:inventory_adjustment_lines(*)')
    .eq('id', params.adjustmentId)
    .maybeSingle()

  await recordAudit(client, {
    workspace_id: params.workspaceId,
    entity_type: 'inventory_adjustment',
    entity_id: params.adjustmentId,
    event_type: 'inventory.adjustment.applied',
    operation: 'UPDATE',
    channel: params.channel || 'ui',
    actor_user_id: params.appliedBy || null,
    actor_kind: params.appliedBy ? 'user' : 'system',
    before_data: before,
    after_data: after || rpcResult,
    metadata: {
      adjustment_type: before.adjustment_type,
      location_id: before.location_id,
      rpc: rpcResult,
    },
    idempotency_key: `inventory_adjustment:${params.adjustmentId}:applied`,
  }, { strict: false })

  // Domain event for bus / attention close
  const domainKey = `inventory-adjustment:${params.adjustmentId}:applied`
  await client.from('domain_events').insert({
    workspace_id: params.workspaceId,
    event_type: 'inventory.adjustment.applied',
    source_type: 'app',
    source_app_key: 'store-ops',
    aggregate_type: 'inventory_adjustment',
    aggregate_id: params.adjustmentId,
    idempotency_key: domainKey,
    payload: { adjustment: after, rpc: rpcResult },
    metadata: { applied_by: params.appliedBy || null },
  }).then(() => {}, () => {})

  // Close related attention items
  await client
    .from('product_attention_items')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('workspace_id', params.workspaceId)
    .eq('status', 'open')
    .contains('metadata', { adjustment_id: params.adjustmentId })
    .then(() => {}, () => {})

  return { adjustment: after, rpc: rpcResult }
}

export async function rejectInventoryAdjustment(
  client: SupabaseClient,
  params: {
    workspaceId: string
    adjustmentId: string
    rejectedBy?: string | null
    note?: string | null
    channel?: 'ui' | 'api' | 'system'
  },
) {
  const { data: before, error: beforeErr } = await client
    .from('inventory_adjustments')
    .select('*, lines:inventory_adjustment_lines(*)')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.adjustmentId)
    .maybeSingle()

  if (beforeErr) throw beforeErr
  if (!before) throw Object.assign(new Error('Adjustment not found'), { statusCode: 404 })
  if (!['draft', 'pending', 'approved'].includes(before.status)) {
    throw Object.assign(new Error(`Cannot reject adjustment in status ${before.status}`), { statusCode: 409 })
  }

  const { data: rpcResult, error: rpcError } = await client.rpc('reject_inventory_adjustment', {
    p_adjustment_id: params.adjustmentId,
    p_created_by: params.rejectedBy || null,
    p_notes: params.note || null,
  })

  if (rpcError) {
    throw Object.assign(new Error(rpcError.message || 'Reject adjustment failed'), { statusCode: 500 })
  }

  const { data: after } = await client
    .from('inventory_adjustments')
    .select('*, lines:inventory_adjustment_lines(*)')
    .eq('id', params.adjustmentId)
    .maybeSingle()

  await recordAudit(client, {
    workspace_id: params.workspaceId,
    entity_type: 'inventory_adjustment',
    entity_id: params.adjustmentId,
    event_type: 'inventory.adjustment.rejected',
    operation: 'UPDATE',
    channel: params.channel || 'ui',
    actor_user_id: params.rejectedBy || null,
    actor_kind: params.rejectedBy ? 'user' : 'system',
    before_data: before,
    after_data: after || rpcResult,
    metadata: {
      adjustment_type: before.adjustment_type,
      note: params.note || null,
    },
    idempotency_key: `inventory_adjustment:${params.adjustmentId}:rejected`,
  }, { strict: false })

  await client
    .from('product_attention_items')
    .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
    .eq('workspace_id', params.workspaceId)
    .eq('status', 'open')
    .contains('metadata', { adjustment_id: params.adjustmentId })
    .then(() => {}, () => {})

  return { adjustment: after, rpc: rpcResult }
}
