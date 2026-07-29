/**
 * Report section runners (track K).
 * Rpt-6: real handlers over views + tables. Suggest-only always.
 * Unknown section ids still return stub status.
 */

/**
 * Stub section runner — kept for tests and unknown ids.
 * @param {string[]} sections
 */
export function runStubSections(sections) {
  const list = Array.isArray(sections) ? sections : []
  const out = list.map((id) => ({
    id,
    status: 'stub',
    summary: `Section \`${id}\` is registered but not yet implemented (Rpt-6).`,
    data: { stub: true },
  }))
  const lines = [
    '## Report run (stub sections)',
    '',
    '_Suggest ≠ execute. No stock, approve, Loft, or FOB side effects._',
    '',
    ...out.map((s) => `- **${s.id}**: ${s.summary}`),
  ]
  return { sections: out, markdown: lines.join('\n') }
}

const ACTION_LEVELS = new Set(['stockout', 'critical', 'reorder_now'])
const WAREHOUSE_TYPES = new Set(['warehouse', '3pl'])
const STORE_TYPES = new Set(['store'])

/**
 * Hybrid runner: real handlers when data client is available, stub otherwise.
 * @param {import('@supabase/supabase-js').SupabaseClient | null | undefined} client
 * @param {string} workspaceId
 * @param {string[]} sections
 * @param {{ limit?: number }} [opts]
 */
export async function runReportSections(client, workspaceId, sections, opts = {}) {
  const list = Array.isArray(sections) ? sections : []
  if (!client || !workspaceId) {
    return runStubSections(list)
  }

  const limit = Math.min(Math.max(opts.limit || 40, 5), 100)
  const ctx = { client, workspaceId, limit }
  const out = []

  for (const id of list) {
    try {
      const handler = HANDLERS[id]
      if (!handler) {
        out.push({
          id,
          status: 'stub',
          summary: `Section \`${id}\` is registered but not yet implemented (Rpt-6).`,
          data: { stub: true },
        })
        continue
      }
      const result = await handler(ctx)
      out.push({
        id,
        status: result.status || 'ok',
        summary: result.summary,
        data: result.data ?? {},
        suggest_only: true,
      })
    } catch (e) {
      out.push({
        id,
        status: 'error',
        summary: `Section \`${id}\` failed: ${e?.message || String(e)}`,
        data: { error: e?.message || String(e) },
        suggest_only: true,
      })
    }
  }

  const real = out.filter((s) => s.status === 'ok').length
  const stub = out.filter((s) => s.status === 'stub').length
  const lines = [
    '## Report run',
    '',
    '_Suggest ≠ execute. No stock, approve, Loft, or FOB side effects._',
    '',
    `Sections: **${real}** live · **${stub}** stub · **${out.length}** total`,
    '',
    ...out.map((s) => {
      const badge = s.status === 'ok' ? 'OK' : s.status === 'error' ? 'ERR' : 'STUB'
      return `- **[${badge}] ${s.id}**: ${s.summary}`
    }),
  ]

  return {
    sections: out,
    markdown: lines.join('\n'),
    meta: { real, stub, total: out.length, workspace_id: workspaceId },
  }
}

/** @type {Record<string, (ctx: any) => Promise<{ status?: string, summary: string, data?: any }>>} */
const HANDLERS = {
  'demand.velocity_snapshot': demandVelocitySnapshot,
  'reorder.store_fill': reorderStoreFill,
  'reorder.supplier_buy': reorderSupplierBuy,
  'sales.top_movers': salesTopMovers,
  'sales.category_rollup': salesCategoryRollup,
  'inventory.ats_by_location': inventoryAtsByLocation,
  'inventory.cover_days': inventoryCoverDays,
  'ops.open_queues': opsOpenQueues,
  'ops.wave_baseline': opsWaveBaseline,
  'finance.stock_position': financeStockPosition,
  'loyalty.rewards_liability': loyaltyRewardsLiability,
  'data_quality.gaps': dataQualityGaps,
}

async function demandVelocitySnapshot({ client, workspaceId, limit }) {
  const { data, error } = await client
    .from('v_demand_velocity')
    .select(
      'product_id, product_title, product_sku, velocity_7d, velocity_30d, velocity_90d, best_velocity, days_with_sales, units_30d, units_90d, last_sale_date',
    )
    .eq('workspace_id', workspaceId)
    .order('best_velocity', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  const rows = data || []
  const withVel = rows.filter((r) => Number(r.best_velocity) > 0)
  const top = rows.slice(0, 10).map((r) => ({
    product_id: r.product_id,
    sku: r.product_sku,
    title: r.product_title,
    v7: Number(r.velocity_7d) || 0,
    v30: Number(r.velocity_30d) || 0,
    v90: Number(r.velocity_90d) || 0,
    best: Number(r.best_velocity) || 0,
    days_with_sales: r.days_with_sales,
  }))

  return {
    status: 'ok',
    summary:
      rows.length === 0
        ? 'No demand velocity rows (import sales or POS ledger sales).'
        : `${withVel.length}/${rows.length} SKUs with velocity>0. Top mover best=${top[0]?.best ?? 0}/day.`,
    data: {
      count: rows.length,
      with_velocity: withVel.length,
      top,
      method: 'v_demand_velocity MA 7/30/90',
    },
  }
}

async function loadReorderAlerts(client, workspaceId, limit) {
  const { data, error } = await client
    .from('v_reorder_alerts')
    .select(
      'product_id, product_title, product_sku, daily_velocity, available_to_sell, total_on_order, days_of_stock_remaining, lead_time_days, alert_level, suggested_order_qty, reorder_point',
    )
    .eq('workspace_id', workspaceId)
    .order('days_of_stock_remaining', { ascending: true, nullsFirst: false })
    .limit(Math.max(limit * 3, 80))

  if (error) throw new Error(error.message)
  return data || []
}

async function loftAtsByProduct(client, workspaceId, productIds) {
  if (!productIds.length) return new Map()
  const { data: locs, error: lErr } = await client
    .from('inventory_locations')
    .select('id, location_type, name, code')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)

  if (lErr) throw new Error(lErr.message)
  const loftIds = (locs || [])
    .filter((l) => WAREHOUSE_TYPES.has(l.location_type))
    .map((l) => l.id)
  if (!loftIds.length) return new Map()

  const { data: levels, error } = await client
    .from('inventory_levels')
    .select('product_id, location_id, on_hand, reserved')
    .eq('workspace_id', workspaceId)
    .in('product_id', productIds)
    .in('location_id', loftIds)

  if (error) throw new Error(error.message)
  const map = new Map()
  for (const row of levels || []) {
    const ats = Math.max(0, (row.on_hand || 0) - (row.reserved || 0))
    map.set(row.product_id, (map.get(row.product_id) || 0) + ats)
  }
  return map
}

/**
 * Path A: store cover low AND loft/warehouse has stock → suggest store_fill (draft request later).
 */
async function reorderStoreFill({ client, workspaceId, limit }) {
  const alerts = await loadReorderAlerts(client, workspaceId, limit)
  const action = alerts.filter((a) => ACTION_LEVELS.has(a.alert_level))
  const loft = await loftAtsByProduct(
    client,
    workspaceId,
    action.map((a) => a.product_id),
  )

  const lines = action
    .filter((a) => (loft.get(a.product_id) || 0) > 0)
    .slice(0, limit)
    .map((a) => ({
      path: 'store_fill',
      product_id: a.product_id,
      sku: a.product_sku,
      title: a.product_title,
      alert_level: a.alert_level,
      days_of_stock_remaining: a.days_of_stock_remaining,
      available_to_sell: a.available_to_sell,
      loft_ats: loft.get(a.product_id) || 0,
      suggested_qty: a.suggested_order_qty,
      next_step: 'Draft store replenishment request (HQ decide). Do not auto-approve.',
    }))

  return {
    status: 'ok',
    summary:
      lines.length === 0
        ? 'No path-A store_fill suggestions (no action SKUs with loft/warehouse ATS).'
        : `${lines.length} path-A store_fill suggestion(s). Suggest ≠ execute.`,
    data: { path: 'store_fill', count: lines.length, lines, suggest_only: true },
  }
}

/**
 * Path B: action needed and loft empty (or no loft stock) → supplier buy draft PO.
 */
async function reorderSupplierBuy({ client, workspaceId, limit }) {
  const alerts = await loadReorderAlerts(client, workspaceId, limit)
  const action = alerts.filter((a) => ACTION_LEVELS.has(a.alert_level))
  const loft = await loftAtsByProduct(
    client,
    workspaceId,
    action.map((a) => a.product_id),
  )

  const lines = action
    .filter((a) => (loft.get(a.product_id) || 0) <= 0)
    .slice(0, limit)
    .map((a) => ({
      path: 'supplier_buy',
      product_id: a.product_id,
      sku: a.product_sku,
      title: a.product_title,
      alert_level: a.alert_level,
      days_of_stock_remaining: a.days_of_stock_remaining,
      available_to_sell: a.available_to_sell,
      loft_ats: loft.get(a.product_id) || 0,
      lead_time_days: a.lead_time_days,
      suggested_qty: a.suggested_order_qty,
      next_step:
        'Draft editable PO only. In transit only after FOB PDF (Track J). Never mark FOB from this report.',
    }))

  return {
    status: 'ok',
    summary:
      lines.length === 0
        ? 'No path-B supplier_buy suggestions (action SKUs either have loft stock or none need action).'
        : `${lines.length} path-B supplier_buy suggestion(s). Draft PO only; FOB gate still human.`,
    data: { path: 'supplier_buy', count: lines.length, lines, suggest_only: true },
  }
}

async function salesTopMovers({ client, workspaceId, limit }) {
  const { data, error } = await client
    .from('v_demand_velocity')
    .select('product_id, product_title, product_sku, units_30d, units_7d, best_velocity, velocity_7d, velocity_30d')
    .eq('workspace_id', workspaceId)
    .order('units_30d', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  const rows = (data || []).filter((r) => Number(r.units_30d) > 0)
  const top = rows.slice(0, 15).map((r) => ({
    product_id: r.product_id,
    sku: r.product_sku,
    title: r.product_title,
    units_30d: Number(r.units_30d) || 0,
    units_7d: Number(r.units_7d) || 0,
    velocity_7d: Number(r.velocity_7d) || 0,
    velocity_30d: Number(r.velocity_30d) || 0,
  }))

  return {
    status: 'ok',
    summary:
      top.length === 0
        ? 'No 30d unit movers yet.'
        : `Top mover: ${top[0].title || top[0].sku} (${top[0].units_30d} u / 30d).`,
    data: { top, count: top.length },
  }
}

async function salesCategoryRollup({ client, workspaceId, limit }) {
  // Best-effort: products with category_id + velocity units_30d
  const { data: vel, error: vErr } = await client
    .from('v_demand_velocity')
    .select('product_id, units_30d, units_90d, best_velocity')
    .eq('workspace_id', workspaceId)
    .limit(500)

  if (vErr) throw new Error(vErr.message)
  const productIds = (vel || []).map((v) => v.product_id)
  if (!productIds.length) {
    return {
      status: 'ok',
      summary: 'No velocity rows for category rollup.',
      data: { categories: [], count: 0 },
    }
  }

  const { data: products, error: pErr } = await client
    .from('products')
    .select('id, category_id, categories(name)')
    .eq('workspace_id', workspaceId)
    .in('id', productIds.slice(0, 500))

  if (pErr) throw new Error(pErr.message)
  const catByProduct = new Map()
  for (const p of products || []) {
    const name = p.categories?.name || (p.category_id ? 'Uncategorized' : 'Uncategorized')
    catByProduct.set(p.id, name)
  }

  const roll = new Map()
  for (const v of vel || []) {
    const cat = catByProduct.get(v.product_id) || 'Uncategorized'
    const cur = roll.get(cat) || { category: cat, units_30d: 0, skus: 0, velocity_sum: 0 }
    cur.units_30d += Number(v.units_30d) || 0
    cur.skus += 1
    cur.velocity_sum += Number(v.best_velocity) || 0
    roll.set(cat, cur)
  }

  const categories = [...roll.values()]
    .sort((a, b) => b.units_30d - a.units_30d)
    .slice(0, limit)
    .map((c) => ({
      category: c.category,
      units_30d: c.units_30d,
      skus: c.skus,
      avg_best_velocity: c.skus ? Math.round((c.velocity_sum / c.skus) * 1000) / 1000 : 0,
    }))

  return {
    status: 'ok',
    summary:
      categories.length === 0
        ? 'No category rollup data.'
        : `Top category: ${categories[0].category} (${categories[0].units_30d} u / 30d).`,
    data: { categories, count: categories.length },
  }
}

async function inventoryAtsByLocation({ client, workspaceId, limit }) {
  const { data: locs, error: lErr } = await client
    .from('inventory_locations')
    .select('id, name, code, location_type')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)

  if (lErr) throw new Error(lErr.message)
  const locMap = new Map((locs || []).map((l) => [l.id, l]))

  const { data: levels, error } = await client
    .from('inventory_levels')
    .select('location_id, on_hand, reserved, on_order')
    .eq('workspace_id', workspaceId)
    .limit(5000)

  if (error) throw new Error(error.message)

  const byLoc = new Map()
  for (const row of levels || []) {
    const loc = locMap.get(row.location_id)
    if (!loc) continue
    const cur = byLoc.get(row.location_id) || {
      location_id: row.location_id,
      name: loc.name,
      code: loc.code,
      location_type: loc.location_type,
      on_hand: 0,
      reserved: 0,
      on_order: 0,
      ats: 0,
      skus: 0,
    }
    cur.on_hand += row.on_hand || 0
    cur.reserved += row.reserved || 0
    cur.on_order += row.on_order || 0
    cur.ats += Math.max(0, (row.on_hand || 0) - (row.reserved || 0))
    cur.skus += 1
    byLoc.set(row.location_id, cur)
  }

  const locations = [...byLoc.values()]
    .sort((a, b) => b.ats - a.ats)
    .slice(0, limit)

  const totalAts = locations.reduce((s, l) => s + l.ats, 0)
  return {
    status: 'ok',
    summary:
      locations.length === 0
        ? 'No inventory levels by location.'
        : `${locations.length} locations · network ATS ${totalAts.toLocaleString()} units.`,
    data: { locations, total_ats: totalAts, count: locations.length },
  }
}

async function inventoryCoverDays({ client, workspaceId, limit }) {
  const { data, error } = await client
    .from('v_reorder_alerts')
    .select(
      'product_id, product_title, product_sku, daily_velocity, available_to_sell, days_of_stock_remaining, alert_level',
    )
    .eq('workspace_id', workspaceId)
    .order('days_of_stock_remaining', { ascending: true, nullsFirst: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  const rows = data || []
  const critical = rows.filter((r) =>
    ['stockout', 'critical', 'reorder_now'].includes(r.alert_level),
  ).length
  const overstock = rows.filter((r) => r.alert_level === 'overstock').length

  return {
    status: 'ok',
    summary: `${rows.length} SKUs sampled · ${critical} need action · ${overstock} overstock (>90d).`,
    data: {
      sample: rows.slice(0, 20).map((r) => ({
        product_id: r.product_id,
        sku: r.product_sku,
        title: r.product_title,
        dsr: r.days_of_stock_remaining,
        alert: r.alert_level,
        ats: r.available_to_sell,
        velocity: r.daily_velocity,
      })),
      critical_count: critical,
      overstock_count: overstock,
    },
  }
}

async function opsOpenQueues({ client, workspaceId }) {
  const counts = {
    replenishment_open: 0,
    floor_pending: 0,
    exceptions_open: 0,
    inbound_open: 0,
  }

  const tryCount = async (table, filter) => {
    try {
      let q = client
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
      if (filter) q = filter(q)
      const { count, error } = await q
      if (error) return null
      return count ?? 0
    } catch {
      return null
    }
  }

  const openStatuses = ['draft', 'submitted', 'pending', 'approved', 'in_progress', 'open']
  counts.replenishment_open = await tryCount('store_replenishment_requests', (q) =>
    q.in('status', openStatuses),
  )
  counts.floor_pending = await tryCount('inventory_adjustments', (q) =>
    q.in('status', ['pending', 'draft', 'submitted']),
  )
  counts.exceptions_open = await tryCount('inventory_exceptions', (q) =>
    q.in('status', ['open', 'pending', 'submitted', 'new']),
  )
  counts.inbound_open = await tryCount('inbound_shipments', (q) =>
    q.in('status', ['draft', 'submitted', 'in_transit', 'pending']),
  )

  const parts = Object.entries(counts)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}=${v}`)

  return {
    status: 'ok',
    summary: parts.length ? `Open queues: ${parts.join(', ')}` : 'Queue tables unavailable or empty.',
    data: { ...counts, suggest_only: true },
  }
}

async function opsWaveBaseline({ client, workspaceId }) {
  try {
    const { data, error } = await client
      .from('store_replenishment_waves')
      .select('id, status, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error
    const rows = data || []
    const byStatus = {}
    for (const w of rows) {
      byStatus[w.status || 'unknown'] = (byStatus[w.status || 'unknown'] || 0) + 1
    }
    return {
      status: 'ok',
      summary:
        rows.length === 0
          ? 'No replenishment waves found.'
          : `${rows.length} recent waves · statuses: ${Object.entries(byStatus)
              .map(([k, v]) => `${k}:${v}`)
              .join(', ')}`,
      data: { recent: rows.slice(0, 10), by_status: byStatus },
    }
  } catch (e) {
    return {
      status: 'ok',
      summary: `Wave baseline unavailable (${e?.message || 'no table'}). Use Store Ops UI for waves.`,
      data: { available: false, error: e?.message || String(e) },
    }
  }
}

async function financeStockPosition({ client, workspaceId }) {
  const { data: levels, error } = await client
    .from('inventory_levels')
    .select('on_hand, reserved, on_order, product_id')
    .eq('workspace_id', workspaceId)
    .limit(8000)

  if (error) throw new Error(error.message)
  let onHand = 0
  let reserved = 0
  let onOrder = 0
  const skus = new Set()
  for (const r of levels || []) {
    onHand += r.on_hand || 0
    reserved += r.reserved || 0
    onOrder += r.on_order || 0
    if (r.product_id) skus.add(r.product_id)
  }
  const ats = Math.max(0, onHand - reserved)

  const { count: productCount } = await client
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)

  return {
    status: 'ok',
    summary: `Stock position: ATS ${ats.toLocaleString()} · on hand ${onHand.toLocaleString()} · on order ${onOrder.toLocaleString()} · ${skus.size} SKUs with levels.`,
    data: {
      ats,
      on_hand: onHand,
      reserved,
      on_order: onOrder,
      skus_with_levels: skus.size,
      catalog_products: productCount ?? null,
      note: 'Units only — retail $ valuation not joined in v1.',
    },
  }
}

async function loyaltyRewardsLiability({ client, workspaceId }) {
  // CRM is external SoR — surface link status only; never invent liability $.
  try {
    const { data, error } = await client
      .from('workspace_crm_links')
      .select('workspace_id, crm_base_url, crm_workspace_id, status, updated_at')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (error) throw error
    if (!data || data.status !== 'active') {
      return {
        status: 'ok',
        summary:
          'Loyalty liability: no active Fran CRM link on this workspace. Points SoR is CRM (not SKUMS).',
        data: {
          linked: false,
          status: data?.status || null,
          liability_sgd: null,
          note: 'Configure Integrations → Fran CRM. Do not treat Mall or POS mock as liability.',
        },
      }
    }
    return {
      status: 'ok',
      summary:
        'Fran CRM linked — rewards liability must be read from CRM ledger (not computed in SKUMS v1).',
      data: {
        linked: true,
        crm_workspace_id: data.crm_workspace_id,
        crm_base_url: data.crm_base_url,
        liability_sgd: null,
        updated_at: data.updated_at,
        note: 'Suggest-only placeholder until CRM liability API is wired.',
      },
    }
  } catch (e) {
    return {
      status: 'ok',
      summary: `Loyalty liability check skipped: ${e?.message || String(e)}`,
      data: { linked: null, error: e?.message || String(e) },
    }
  }
}

async function dataQualityGaps({ client, workspaceId }) {
  const gaps = []

  const { count: noSku } = await client
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .or('sku.is.null,sku.eq.')

  if ((noSku ?? 0) > 0) gaps.push({ code: 'products_missing_sku', count: noSku })

  const { data: vel } = await client
    .from('v_demand_velocity')
    .select('product_id, best_velocity, days_with_sales')
    .eq('workspace_id', workspaceId)
    .limit(500)

  const noVel = (vel || []).filter((v) => !v.best_velocity || Number(v.best_velocity) === 0).length
  if (noVel > 0) gaps.push({ code: 'products_no_velocity', count: noVel, sample_size: (vel || []).length })

  const { data: alerts } = await client
    .from('v_reorder_alerts')
    .select('product_id, alert_level')
    .eq('workspace_id', workspaceId)
    .eq('alert_level', 'no_data')
    .limit(200)

  if ((alerts || []).length > 0) {
    gaps.push({ code: 'reorder_no_data', count: (alerts || []).length })
  }

  const { count: locCount } = await client
    .from('inventory_locations')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)

  if ((locCount ?? 0) === 0) gaps.push({ code: 'no_inventory_locations', count: 0 })

  return {
    status: 'ok',
    summary:
      gaps.length === 0
        ? 'No major data-quality gaps detected in sampled checks.'
        : `${gaps.length} gap type(s): ${gaps.map((g) => g.code).join(', ')}.`,
    data: { gaps },
  }
}

export const REPORT_SECTION_IDS = Object.keys(HANDLERS)
