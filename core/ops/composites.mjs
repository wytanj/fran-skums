/**
 * MCP backlog #8 composites (read + suggest; privileged writes stay human/UI).
 */

/**
 * Expiry risk snapshot.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{ workspace_id: string, limit?: number }} opts
 */
export async function expirySnapshot(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')
  const limit = Math.min(Math.max(Number(opts.limit) || 15, 1), 40)

  let summary = null
  try {
    const { data, error } = await db.rpc('expiry_summary', { p_workspace_id: workspace_id })
    if (!error) summary = data
  } catch {
    summary = null
  }

  // Batch rows near expiry if table exists
  let batches = []
  let batchError = null
  {
    const { data, error } = await db
      .from('product_expiry_batches')
      .select('id, product_id, batch_code, quantity, expiry_date, status')
      .eq('workspace_id', workspace_id)
      .order('expiry_date', { ascending: true })
      .limit(limit)
    if (error) {
      // try alternate table name from 011
      const alt = await db
        .from('expiry_batches')
        .select('id, product_id, batch_code, quantity, expiry_date, status')
        .eq('workspace_id', workspace_id)
        .order('expiry_date', { ascending: true })
        .limit(limit)
      if (alt.error) batchError = error.message
      else batches = alt.data || []
    } else {
      batches = data || []
    }
  }

  const now = Date.now()
  const day = 86400000
  let expired = 0
  let d30 = 0
  let d90 = 0
  for (const b of batches) {
    if (!b.expiry_date) continue
    const t = new Date(b.expiry_date).getTime()
    if (t < now) expired += 1
    else if (t < now + 30 * day) d30 += 1
    else if (t < now + 90 * day) d90 += 1
  }

  return {
    summary_rpc: summary,
    from_batches: {
      sample_size: batches.length,
      expired_in_sample: expired,
      expiring_30d_in_sample: d30,
      expiring_90d_in_sample: d90,
      nearest: batches.slice(0, limit),
    },
    batch_error: batchError,
    deep_links: { expiry: '/expiry', inventory: '/inventory' },
    agent_hint:
      'Lead with counts. Empty batches mean no expiry data yet — not that product never expires. Use for ops triage, not sales ranking.',
  }
}

/**
 * Open inventory exceptions triage.
 */
export async function exceptionsSnapshot(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 50)

  const { data: rows, error } = await db
    .from('inventory_exceptions')
    .select(
      'id, title, status, severity, exception_type, sku, product_id, expected_qty, actual_qty, created_at, summary',
    )
    .eq('workspace_id', workspace_id)
    .in('status', ['open', 'in_progress', 'escalated'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)

  const by_severity = {}
  const by_type = {}
  for (const r of rows || []) {
    const sev = r.severity || 'unknown'
    const typ = r.exception_type || 'other'
    by_severity[sev] = (by_severity[sev] || 0) + 1
    by_type[typ] = (by_type[typ] || 0) + 1
  }

  return {
    count: (rows || []).length,
    by_severity,
    by_type,
    exceptions: rows || [],
    deep_links: { store_ops: '/store-ops', exceptions: '/store-ops' },
    agent_hint:
      'HQ verifies exceptions in Store Ops UI. MCP cannot verify/resolve. List severity + SKU first.',
  }
}

/**
 * Integration / Loft connection health (read-only).
 */
export async function integrationsHealth(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')

  const { data: connections, error } = await db
    .from('integration_connections')
    .select('id, name, status, provider_key, last_synced_at, created_at, metadata, config')
    .eq('workspace_id', workspace_id)
    .order('created_at', { ascending: false })
    .limit(40)

  if (error) {
    // older schemas
    const alt = await db
      .from('integrations')
      .select('id, name, status, type, last_synced_at, created_at')
      .eq('workspace_id', workspace_id)
      .limit(40)
    if (alt.error) throw new Error(error.message)
    return {
      connections: alt.data || [],
      loft: { found: false, note: 'legacy integrations table only' },
      agent_hint: 'Check /integrations. No execute from MCP.',
      deep_links: { integrations: '/integrations' },
    }
  }

  const list = connections || []
  const loftish = list.filter((c) => {
    const key = String(c.provider_key || c.name || '').toLowerCase()
    return /worldsyntech|loft|ofs|3pl/.test(key)
  })

  const dictionary_gaps = []
  for (const c of loftish) {
    const cfg = c.config && typeof c.config === 'object' ? c.config : {}
    const meta = c.metadata && typeof c.metadata === 'object' ? c.metadata : {}
    const dict = { ...cfg, ...meta }
    if (!dict.delivery_method_id && !dict.delivery_method_ids) {
      dictionary_gaps.push({
        connection_id: c.id,
        name: c.name,
        missing: 'delivery_method_id(s) — Phase 0 Loft dictionary',
      })
    }
  }

  return {
    connection_count: list.length,
    connections: list.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      provider_key: c.provider_key,
      last_synced_at: c.last_synced_at,
    })),
    loft_connections: loftish.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      last_synced_at: c.last_synced_at,
    })),
    dictionary_gaps,
    deep_links: { integrations: '/integrations', loft_help: '/help/loft-worldsyntech' },
    agent_hint:
      dictionary_gaps.length
        ? 'Loft connection exists but dictionary IDs may be missing — ops should complete Phase 0 Loft email answers.'
        : 'Report connection status only. Never claim MCP sent orders to Loft.',
  }
}

/**
 * Product attention queue snapshot.
 */
export async function attentionSnapshot(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 50)

  const { data: rows, error } = await db
    .from('product_attention_items')
    .select(
      'id, title, status, attention_type, risk_level, product_id, sku, source_app_key, created_at, summary',
    )
    .eq('workspace_id', workspace_id)
    .in('status', opts.status ? [opts.status] : ['open', 'pending', 'in_progress', 'new'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    // soft fail if no open filter match — try without status filter
    const all = await db
      .from('product_attention_items')
      .select(
        'id, title, status, attention_type, risk_level, product_id, sku, source_app_key, created_at, summary',
      )
      .eq('workspace_id', workspace_id)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (all.error) throw new Error(error.message)
    return formatAttention(all.data || [])
  }
  return formatAttention(rows || [])
}

function formatAttention(rows) {
  const by_type = {}
  const by_risk = {}
  for (const r of rows) {
    by_type[r.attention_type || 'other'] = (by_type[r.attention_type || 'other'] || 0) + 1
    by_risk[r.risk_level || 'unknown'] = (by_risk[r.risk_level || 'unknown'] || 0) + 1
  }
  return {
    count: rows.length,
    by_type,
    by_risk,
    items: rows,
    deep_links: { actions: '/actions', products: '/products' },
    agent_hint:
      'Attention items are signals for humans/pipeline propose — MCP should not claim fixed them.',
  }
}

/**
 * Low stock → draft store request pack (suggest only unless caller creates request).
 */
export async function lowStockRequestPack(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')
  const limit = Math.min(Math.max(Number(opts.limit) || 15, 1), 40)

  let rows = []
  let source = 'v_low_stock'
  {
    const { data, error } = await db
      .from('v_low_stock')
      .select('product_id, product_title, product_sku, total_available, low_stock_threshold')
      .eq('workspace_id', workspace_id)
      .order('total_available', { ascending: true })
      .limit(limit)
    if (error) {
      source = 'v_inventory_summary'
      const alt = await db
        .from('v_inventory_summary')
        .select('product_id, product_title, product_sku, total_available, total_on_hand')
        .eq('workspace_id', workspace_id)
        .order('total_available', { ascending: true })
        .limit(limit)
      if (alt.error) throw new Error(error.message)
      rows = (alt.data || [])
        .filter((r) => Number(r.total_available || 0) <= 5)
        .map((r) => ({
          product_id: r.product_id,
          product_title: r.product_title,
          product_sku: r.product_sku,
          total_available: r.total_available,
          low_stock_threshold: 5,
        }))
    } else {
      rows = data || []
    }
  }

  const lines = rows
    .filter((r) => r.product_sku)
    .map((r) => {
      const available = Number(r.total_available || 0)
      const threshold = Number(r.low_stock_threshold || 5)
      const suggested = Math.max(threshold * 2 - available, 1)
      return {
        sku: r.product_sku,
        product_id: r.product_id,
        title: r.product_title,
        available,
        threshold,
        requested_qty: suggested,
        reason: `low_stock (avail ${available} ≤ threshold ${threshold})`,
      }
    })

  return {
    source,
    line_count: lines.length,
    lines,
    store_ops_create_draft_request_args: {
      dry_run: true,
      priority: 'normal',
      reason: 'MCP low-stock pack',
      lines: lines.map((l) => ({
        sku: l.sku,
        product_id: l.product_id,
        requested_qty: l.requested_qty,
        reason: l.reason,
      })),
    },
    deep_links: { store_ops: '/store-ops', inventory: '/inventory' },
    agent_hint:
      'Present lines table, then offer dry_run store_ops_create_draft_request. Never auto-approve or send Loft. Empty list = no low-stock signal (or no ledger levels).',
  }
}

/**
 * POS-enable proposal list (candidates with POS off). No bulk flip.
 */
export async function posEnableProposal(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')
  const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 100)
  const brand = opts.brand || null

  let q = db
    .from('products')
    .select(
      'id, title, sku, status, retail_price, cost_price, product_data, brand:brand_id(name), updated_at',
    )
    .eq('workspace_id', workspace_id)
    .eq('status', opts.status || 'active')
    .order('updated_at', { ascending: false })
    .limit(Math.min(limit * 4, 400))

  if (brand) {
    // brand filter requires id resolution — skip if complex; client-side filter below
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const candidates = []
  for (const p of data || []) {
    const pd = p.product_data && typeof p.product_data === 'object' ? p.product_data : {}
    const pe = pd.pos_enabled ?? pd.sellable_in_pos
    if (pe === true || pe === 'true' || pe === 1) continue
    if (brand && !(p.brand?.name || '').toLowerCase().includes(String(brand).toLowerCase())) continue
    candidates.push({
      id: p.id,
      title: p.title,
      sku: p.sku,
      brand: p.brand?.name || null,
      retail_price: p.retail_price,
      cost_price: p.cost_price,
      pos_enabled: pe ?? false,
      missing_retail: p.retail_price == null,
    })
    if (candidates.length >= limit) break
  }

  const with_retail = candidates.filter((c) => !c.missing_retail)
  const missing_retail = candidates.filter((c) => c.missing_retail)

  return {
    candidate_count: candidates.length,
    ready_for_pos_review: with_retail.length,
    need_retail_first: missing_retail.length,
    candidates: candidates.slice(0, limit),
    csv_hint: 'Use catalog_export_csv then Activate for POS in UI — MCP never bulk-flips pos_enabled.',
    deep_links: {
      products: '/products',
      activate_help: '/help/activate-for-pos',
      import: '/import-export',
    },
    agent_hint:
      'Propose a shortlist; set retail before POS. Do not claim products are sellable until human activates.',
  }
}
