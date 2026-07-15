import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureWave, listUpcomingWaveDates } from './storeReplenishment'

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
}

export async function getOrCreateStoreOpsSettings(
  client: SupabaseClient,
  workspaceId: string,
) {
  const { data: existing } = await client
    .from('store_ops_settings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (existing) return existing

  const { data, error } = await client
    .from('store_ops_settings')
    .insert({
      workspace_id: workspaceId,
      wave_weekdays: [1, 4],
      default_delivery_mode: 'delivery',
      wave_cutoff_hour_local: 14,
      default_receive_by_local: '10:00:00',
      wave_include_cutoff_hours: 24,
    })
    .select()
    .single()

  if (error) {
    const { data: again } = await client
      .from('store_ops_settings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (again) return again
    throw error
  }
  return data
}

export async function updateStoreOpsSettings(
  client: SupabaseClient,
  workspaceId: string,
  patch: Record<string, unknown>,
) {
  await getOrCreateStoreOpsSettings(client, workspaceId)
  const allowed: Record<string, unknown> = {}
  if (Array.isArray(patch.wave_weekdays)) {
    allowed.wave_weekdays = patch.wave_weekdays.map((n) => Number(n)).filter((n) => n >= 1 && n <= 7)
  }
  if (patch.default_delivery_mode === 'delivery' || patch.default_delivery_mode === 'self_collect') {
    allowed.default_delivery_mode = patch.default_delivery_mode
  }
  if (patch.wave_cutoff_hour_local != null) {
    allowed.wave_cutoff_hour_local = Math.min(23, Math.max(0, Number(patch.wave_cutoff_hour_local)))
  }
  if (patch.default_receive_by_local != null) {
    allowed.default_receive_by_local = String(patch.default_receive_by_local)
  }
  if (patch.wave_include_cutoff_hours != null) {
    allowed.wave_include_cutoff_hours = Math.min(168, Math.max(0, Number(patch.wave_include_cutoff_hours)))
  }
  if (patch.metadata && typeof patch.metadata === 'object') {
    allowed.metadata = patch.metadata
  }

  const { data, error } = await client
    .from('store_ops_settings')
    .update(allowed)
    .eq('workspace_id', workspaceId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function listDeliveryCalendars(client: SupabaseClient, workspaceId: string) {
  const { data, error } = await client
    .from('store_delivery_calendars')
    .select(`
      *,
      location:inventory_locations(id, code, name, location_type),
      pos_location:pos_locations(id, code, name)
    `)
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data || []
}

export async function upsertDeliveryCalendar(
  client: SupabaseClient,
  params: {
    workspaceId: string
    inventoryLocationId: string
    posLocationId?: string | null
    receiveWeekdays?: number[]
    receiveWindowStart?: string | null
    receiveWindowEnd?: string | null
    preferredDeliveryMode?: 'delivery' | 'self_collect'
    notes?: string | null
  },
) {
  const row = {
    workspace_id: params.workspaceId,
    inventory_location_id: params.inventoryLocationId,
    pos_location_id: params.posLocationId || null,
    receive_weekdays: params.receiveWeekdays || [],
    receive_window_start: params.receiveWindowStart || null,
    receive_window_end: params.receiveWindowEnd || null,
    preferred_delivery_mode: params.preferredDeliveryMode || 'delivery',
    notes: params.notes || null,
    is_active: true,
  }

  const { data, error } = await client
    .from('store_delivery_calendars')
    .upsert(row, { onConflict: 'workspace_id,inventory_location_id' })
    .select(`
      *,
      location:inventory_locations(id, code, name),
      pos_location:pos_locations(id, code, name)
    `)
    .single()

  if (error) throw error
  return data
}

/**
 * Next scheduled replenishment wave for POS / HQ, with cutoff messaging.
 */
export async function resolveNextWaveForStore(
  client: SupabaseClient,
  params: {
    workspaceId: string
    posLocationCode?: string | null
    inventoryLocationId?: string | null
  },
) {
  const settings = await getOrCreateStoreOpsSettings(client, params.workspaceId)
  const upcoming = await listUpcomingWaveDates(client, params.workspaceId, 6)
  const cutoffHours = Number(settings.wave_include_cutoff_hours ?? 24)

  let calendar: any = null
  if (params.inventoryLocationId) {
    const { data } = await client
      .from('store_delivery_calendars')
      .select('*')
      .eq('workspace_id', params.workspaceId)
      .eq('inventory_location_id', params.inventoryLocationId)
      .eq('is_active', true)
      .maybeSingle()
    calendar = data
  } else if (params.posLocationCode) {
    const { data: posLoc } = await client
      .from('pos_locations')
      .select('id, code, inventory_location_id')
      .eq('workspace_id', params.workspaceId)
      .ilike('code', params.posLocationCode)
      .maybeSingle()
    if (posLoc?.inventory_location_id) {
      const { data } = await client
        .from('store_delivery_calendars')
        .select('*')
        .eq('workspace_id', params.workspaceId)
        .eq('inventory_location_id', posLoc.inventory_location_id)
        .eq('is_active', true)
        .maybeSingle()
      calendar = data
    }
  }

  const now = Date.now()
  const waves = upcoming.map((w) => {
    const waveStart = new Date(`${w.wave_date}T00:00:00`)
    const cutoffAt = new Date(waveStart.getTime() - cutoffHours * 3600 * 1000)
    const openForInclude = now < cutoffAt.getTime()
    return {
      wave_date: w.wave_date,
      weekday: w.weekday,
      weekday_label: WEEKDAY_LABELS[w.weekday] || String(w.weekday),
      cutoff_at: cutoffAt.toISOString(),
      open_for_defer: openForInclude,
    }
  })

  const nextOpen = waves.find((w) => w.open_for_defer) || waves[0] || null
  const weekdays = Array.isArray(settings.wave_weekdays) ? settings.wave_weekdays : [1, 4]
  const cadenceLabels = weekdays.map((d: number) => WEEKDAY_LABELS[d] || d).join(' + ')

  return {
    cadence: cadenceLabels,
    wave_weekdays: weekdays,
    default_delivery_mode: settings.default_delivery_mode,
    default_receive_by_local: settings.default_receive_by_local,
    wave_include_cutoff_hours: cutoffHours,
    next_wave: nextOpen,
    upcoming_waves: waves,
    store_calendar: calendar
      ? {
          preferred_delivery_mode: calendar.preferred_delivery_mode,
          receive_window_start: calendar.receive_window_start,
          receive_window_end: calendar.receive_window_end,
          receive_weekdays: calendar.receive_weekdays,
          notes: calendar.notes,
        }
      : null,
    message: nextOpen
      ? `Next scheduled replenishment: ${nextOpen.weekday_label} ${nextOpen.wave_date}. Ad-hoc requests are for lift/urgent only — default pipe is ${cadenceLabels}.`
      : `Default replenishment cadence: ${cadenceLabels}.`,
  }
}

/**
 * Fair multi-store allocation of one SKU against Loft ATS without overselling.
 * Proportional then greedy remainder by requested qty.
 */
export function allocateSkuAcrossStores(
  loftAvailable: number,
  storeRequests: Array<{ store_key: string; requested_qty: number }>,
): Array<{ store_key: string; requested_qty: number; allocated_qty: number }> {
  const available = Math.max(0, Math.floor(loftAvailable))
  const rows = storeRequests.map((r) => ({
    store_key: r.store_key,
    requested_qty: Math.max(0, Math.floor(r.requested_qty)),
    allocated_qty: 0,
  }))
  const totalReq = rows.reduce((s, r) => s + r.requested_qty, 0)
  if (available <= 0 || totalReq <= 0) return rows

  if (totalReq <= available) {
    return rows.map((r) => ({ ...r, allocated_qty: r.requested_qty }))
  }

  // Proportional floor
  let remaining = available
  for (const r of rows) {
    const share = Math.floor((r.requested_qty / totalReq) * available)
    r.allocated_qty = Math.min(r.requested_qty, share)
    remaining -= r.allocated_qty
  }
  // Greedy remainder by largest unfilled request
  const byNeed = [...rows].sort(
    (a, b) => (b.requested_qty - b.allocated_qty) - (a.requested_qty - a.allocated_qty),
  )
  for (const r of byNeed) {
    if (remaining <= 0) break
    const room = r.requested_qty - r.allocated_qty
    if (room <= 0) continue
    const give = Math.min(room, remaining)
    r.allocated_qty += give
    remaining -= give
  }
  return rows
}

export async function previewWaveAllocation(
  client: SupabaseClient,
  params: {
    workspaceId: string
    waveId: string
  },
) {
  const { data: wave, error: waveErr } = await client
    .from('store_replenishment_waves')
    .select('*')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.waveId)
    .maybeSingle()

  if (waveErr) throw waveErr
  if (!wave) throw Object.assign(new Error('Wave not found'), { statusCode: 404 })

  const { data: loftLoc } = await client
    .from('inventory_locations')
    .select('id, code')
    .eq('workspace_id', params.workspaceId)
    .eq('code', 'LOFT-SG')
    .maybeSingle()

  const { data: deferred } = await client
    .from('store_replenishment_requests')
    .select(`
      id, request_number, store_location_id, pos_location_id, status,
      lines:store_replenishment_request_lines(id, sku, product_id, requested_qty, approved_qty)
    `)
    .eq('workspace_id', params.workspaceId)
    .eq('wave_id', params.waveId)
    .in('status', ['deferred_to_wave', 'approved', 'converted'])

  // Aggregate demand by sku × store
  type Demand = { sku: string; product_id: string | null; store_key: string; requested_qty: number; request_ids: string[] }
  const demandMap = new Map<string, Demand>()

  for (const req of deferred || []) {
    const storeKey = String(req.store_location_id || req.pos_location_id || 'unknown')
    for (const line of req.lines || []) {
      const sku = String(line.sku || '').trim()
      if (!sku) continue
      const qty = Number(line.approved_qty ?? line.requested_qty ?? 0)
      if (qty <= 0) continue
      const key = `${sku}::${storeKey}`
      const existing = demandMap.get(key)
      if (existing) {
        existing.requested_qty += qty
        existing.request_ids.push(req.id)
      } else {
        demandMap.set(key, {
          sku,
          product_id: line.product_id || null,
          store_key: storeKey,
          requested_qty: qty,
          request_ids: [req.id],
        })
      }
    }
  }

  const bySku = new Map<string, Demand[]>()
  for (const d of demandMap.values()) {
    const list = bySku.get(d.sku) || []
    list.push(d)
    bySku.set(d.sku, list)
  }

  // Loft ATS
  const skus = [...bySku.keys()]
  const productIds = [...new Set([...demandMap.values()].map((d) => d.product_id).filter(Boolean))] as string[]
  const loftOnHand = new Map<string, number>() // by product_id or sku

  if (loftLoc?.id && productIds.length) {
    const { data: levels } = await client
      .from('inventory_levels')
      .select('product_id, on_hand, reserved, product:products(sku)')
      .eq('workspace_id', params.workspaceId)
      .eq('location_id', loftLoc.id)
      .in('product_id', productIds)

    for (const level of levels || []) {
      const ats = Math.max(0, Number(level.on_hand || 0) - Number(level.reserved || 0))
      loftOnHand.set(String(level.product_id), ats)
      const sku = (level as any).product?.sku
      if (sku) loftOnHand.set(String(sku).toUpperCase(), ats)
    }
  }

  const allocations = []
  for (const [sku, demands] of bySku) {
    const productId = demands.find((d) => d.product_id)?.product_id || null
    const available =
      (productId && loftOnHand.get(productId))
      ?? loftOnHand.get(sku.toUpperCase())
      ?? 0
    const allocated = allocateSkuAcrossStores(
      available,
      demands.map((d) => ({ store_key: d.store_key, requested_qty: d.requested_qty })),
    )
    const totalRequested = demands.reduce((s, d) => s + d.requested_qty, 0)
    const totalAllocated = allocated.reduce((s, a) => s + a.allocated_qty, 0)
    allocations.push({
      sku,
      product_id: productId,
      loft_available_qty: available,
      total_requested_qty: totalRequested,
      total_allocated_qty: totalAllocated,
      shortfall: Math.max(0, totalRequested - totalAllocated),
      lines: allocated.map((a) => {
        const dem = demands.find((d) => d.store_key === a.store_key)
        return {
          store_location_id: a.store_key === 'unknown' ? null : a.store_key,
          requested_qty: a.requested_qty,
          allocated_qty: a.allocated_qty,
          request_ids: dem?.request_ids || [],
        }
      }),
    })
  }

  return {
    wave,
    loft_location_id: loftLoc?.id || null,
    allocations,
    summary: {
      skus: allocations.length,
      short_skus: allocations.filter((a) => a.shortfall > 0).length,
      total_shortfall_units: allocations.reduce((s, a) => s + a.shortfall, 0),
    },
    note: 'Preview only — human must approve wave release; send still requires store_ops:execute_3pl',
  }
}

export async function saveWaveAllocationPreview(
  client: SupabaseClient,
  params: {
    workspaceId: string
    waveId: string
    createdBy?: string | null
  },
) {
  const preview = await previewWaveAllocation(client, params)
  const saved = []
  for (const row of preview.allocations) {
    const { data, error } = await client
      .from('store_wave_allocations')
      .upsert(
        {
          workspace_id: params.workspaceId,
          wave_id: params.waveId,
          product_id: row.product_id,
          sku: row.sku,
          loft_available_qty: row.loft_available_qty,
          total_requested_qty: row.total_requested_qty,
          total_allocated_qty: row.total_allocated_qty,
          status: 'draft',
          lines: row.lines,
          created_by: params.createdBy || null,
          metadata: { shortfall: row.shortfall },
        },
        { onConflict: 'wave_id,sku' },
      )
      .select()
      .single()
    if (error) throw error
    saved.push(data)
  }
  return { preview, saved }
}

export { WEEKDAY_LABELS, ensureWave }
