/**
 * Ops snapshot + MCP/Catalog AI capabilities (read-only composites).
 * Answers “what’s outstanding / what can I do from here?” in one call.
 */

const OPEN_EXCEPTION_STATUSES = ['open', 'in_progress', 'escalated']
const OPEN_ADJ_STATUSES = ['pending', 'draft', 'approved']
const OPEN_INBOUND_STATUSES = [
  'draft',
  'asn_sent',
  'in_transit',
  'loft_receiving',
  'partial_received',
  'fully_received',
  'lise_confirmed',
  'exception',
]
const OPEN_ORDER_STATUSES = [
  'approved',
  'queued',
  'sent_to_3pl',
  'acknowledged',
  'shipped',
  'partially_shipped',
  'partially_received',
]
const OPEN_PO_STATUSES = ['draft', 'pending_approval']

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {string} table
 * @param {string} workspaceId
 * @param {{ column?: string, values?: string[] | null }} [filter]
 */
async function countRows(db, table, workspaceId, filter = {}) {
  let q = db.from(table).select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId)
  if (filter.values?.length && filter.column) {
    q = q.in(filter.column, filter.values)
  }
  const { count, error } = await q
  if (error) {
    return { count: null, error: error.message }
  }
  return { count: count ?? 0, error: null }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {string} table
 * @param {string} workspaceId
 * @param {string[]} statuses
 * @param {number} [limit]
 * @param {string} [select]
 */
async function listRecent(db, table, workspaceId, statuses, limit = 8, select = '*') {
  let q = db
    .from(table)
    .select(select)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (statuses?.length) q = q.in('status', statuses)
  const { data, error } = await q
  if (error) return { rows: [], error: error.message }
  return { rows: data || [], error: null }
}

/**
 * One-shot store ops + logistics queue snapshot.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{ workspace_id: string, include_samples?: boolean }} opts
 */
export async function opsSnapshot(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')
  const include_samples = opts.include_samples !== false

  const [
    reqOpen,
    reqSubmitted,
    reqInReview,
    reqDeferred,
    exceptionsOpen,
    adjPending,
    inboundOpen,
    ordersOpen,
    posDraft,
    posPending,
  ] = await Promise.all([
    countRows(db, 'store_replenishment_requests', workspace_id, {
      column: 'status',
      values: ['submitted', 'in_review', 'deferred_to_wave'],
    }),
    countRows(db, 'store_replenishment_requests', workspace_id, {
      column: 'status',
      values: ['submitted'],
    }),
    countRows(db, 'store_replenishment_requests', workspace_id, {
      column: 'status',
      values: ['in_review'],
    }),
    countRows(db, 'store_replenishment_requests', workspace_id, {
      column: 'status',
      values: ['deferred_to_wave'],
    }),
    countRows(db, 'inventory_exceptions', workspace_id, {
      column: 'status',
      values: OPEN_EXCEPTION_STATUSES,
    }),
    countRows(db, 'inventory_adjustments', workspace_id, {
      column: 'status',
      values: OPEN_ADJ_STATUSES,
    }),
    countRows(db, 'inbound_shipments', workspace_id, {
      column: 'status',
      values: OPEN_INBOUND_STATUSES,
    }),
    countRows(db, 'store_replenishment_orders', workspace_id, {
      column: 'status',
      values: OPEN_ORDER_STATUSES,
    }),
    countRows(db, 'internal_purchase_orders', workspace_id, {
      column: 'status',
      values: ['draft'],
    }),
    countRows(db, 'internal_purchase_orders', workspace_id, {
      column: 'status',
      values: ['pending_approval'],
    }),
  ])

  let upcoming_wave_dates = []
  let waves_open = []
  let wave_error = null
  try {
    const { data: dates, error: dErr } = await db.rpc('next_replenishment_wave_dates', {
      p_workspace_id: workspace_id,
      p_from: new Date().toISOString().slice(0, 10),
      p_count: 6,
    })
    if (dErr) wave_error = dErr.message
    else upcoming_wave_dates = dates || []

    const { data: waves, error: wErr } = await db
      .from('store_replenishment_waves')
      .select('id, wave_date, status, metadata, created_at')
      .eq('workspace_id', workspace_id)
      .order('wave_date', { ascending: true })
      .limit(8)
    if (wErr) wave_error = wave_error || wErr.message
    else waves_open = waves || []
  } catch (e) {
    wave_error = e instanceof Error ? e.message : String(e)
  }

  /** @type {Record<string, any>} */
  const samples = {}
  if (include_samples) {
    const [reqSample, excSample, adjSample, asnSample, poSample] = await Promise.all([
      listRecent(
        db,
        'store_replenishment_requests',
        workspace_id,
        ['submitted', 'in_review', 'deferred_to_wave'],
        5,
        'id, request_number, status, priority, needed_by, wave_date, created_at',
      ),
      listRecent(
        db,
        'inventory_exceptions',
        workspace_id,
        OPEN_EXCEPTION_STATUSES,
        5,
        'id, title, status, severity, exception_type, sku, created_at',
      ),
      listRecent(
        db,
        'inventory_adjustments',
        workspace_id,
        OPEN_ADJ_STATUSES,
        5,
        'id, adjustment_number, adjustment_type, status, created_at',
      ),
      listRecent(
        db,
        'inbound_shipments',
        workspace_id,
        OPEN_INBOUND_STATUSES,
        5,
        'id, shipment_number, status, tracking_number, date_estimate, local_forwarder, offshore_forwarder, created_at',
      ),
      listRecent(
        db,
        'internal_purchase_orders',
        workspace_id,
        OPEN_PO_STATUSES,
        5,
        'id, po_number, status, currency, subtotal, notes, created_at',
      ),
    ])
    samples.open_requests = reqSample.rows
    samples.open_exceptions = excSample.rows
    samples.pending_floor_adjustments = adjSample.rows
    samples.open_inbound_asn = asnSample.rows
    samples.internal_pos = poSample.rows
  }

  const counts = {
    store_requests_open_queue: reqOpen.count,
    store_requests_submitted: reqSubmitted.count,
    store_requests_in_review: reqInReview.count,
    store_requests_deferred_to_wave: reqDeferred.count,
    inventory_exceptions_open: exceptionsOpen.count,
    floor_adjustments_pending: adjPending.count,
    inbound_asn_open: inboundOpen.count,
    loft_replenish_orders_open: ordersOpen.count,
    internal_po_draft: posDraft.count,
    internal_po_pending_approval: posPending.count,
  }

  const errors = [
    reqOpen.error && `requests: ${reqOpen.error}`,
    exceptionsOpen.error && `exceptions: ${exceptionsOpen.error}`,
    adjPending.error && `adjustments: ${adjPending.error}`,
    inboundOpen.error && `inbound: ${inboundOpen.error}`,
    ordersOpen.error && `orders: ${ordersOpen.error}`,
    posDraft.error && `pos: ${posDraft.error}`,
    wave_error && `waves: ${wave_error}`,
  ].filter(Boolean)

  const attention = []
  if ((counts.store_requests_open_queue || 0) > 0) {
    attention.push(`${counts.store_requests_open_queue} store request(s) in HQ queue`)
  }
  if ((counts.inventory_exceptions_open || 0) > 0) {
    attention.push(`${counts.inventory_exceptions_open} open inventory exception(s)`)
  }
  if ((counts.floor_adjustments_pending || 0) > 0) {
    attention.push(`${counts.floor_adjustments_pending} floor adjustment(s) need apply/reject`)
  }
  if ((counts.inbound_asn_open || 0) > 0) {
    attention.push(`${counts.inbound_asn_open} open inbound ASN(s) (forwarder→Loft)`)
  }
  if ((counts.loft_replenish_orders_open || 0) > 0) {
    attention.push(`${counts.loft_replenish_orders_open} open Loft replenish order(s)`)
  }
  if ((counts.internal_po_pending_approval || 0) > 0) {
    attention.push(`${counts.internal_po_pending_approval} internal PO(s) pending approval`)
  }
  if (!attention.length) {
    attention.push('No open store-ops / exception / floor / inbound queues (or tables empty)')
  }

  const next_wave = upcoming_wave_dates[0] || null

  return {
    as_of: new Date().toISOString(),
    counts,
    attention,
    waves: {
      cadence_note: 'Default Mon+Thu unless store_ops_settings.wave_weekdays overrides',
      upcoming_dates: upcoming_wave_dates,
      next_wave,
      recent_wave_rows: waves_open,
    },
    samples: include_samples ? samples : undefined,
    domain_notes: {
      invoices: 'not_in_skums — use external billing',
      warehouse_transfers:
        'no classic transfer object — use Store Ops replenishment (request → approve → send Loft → receive)',
      internal_po: 'decision-layer draft only — not inventory PO / not supplier order',
      stock_truth: 'inventory_levels ATS via inventory_ats / product_inventory_status — not product.stock_quantity',
    },
    deep_links: {
      store_ops: '/store-ops',
      inventory: '/inventory',
      actions: '/actions',
      help_runbook: '/help/operator-runbook',
    },
    errors: errors.length ? errors : null,
    agent_hint:
      'Lead with attention[]. Empty open queues mean nothing outstanding in those objects — not that “transfers settled.” For product stock status use product_inventory_status. MCP cannot approve requests or execute_3pl — humans use Store Ops UI.',
  }
}

/**
 * Static + runtime capabilities: what exists, what THIS key can do.
 * Pass scopes from the authenticated MCP key for permitted_tools / permitted_actions.
 * @param {{
 *   profile?: string,
 *   mode?: string,
 *   scopes?: string[] | null,
 *   cloud?: boolean,
 *   surface?: 'mcp' | 'catalog_ai' | 'both',
 *   key_id?: string | null,
 *   key_name?: string | null,
 *   actor_user_id?: string | null,
 *   permitted?: {
 *     granted_scopes?: string[] | null,
 *     unrestricted?: boolean,
 *     permitted_tools?: Array<{ tool: string, scope: string, action: string }>,
 *     denied_tools?: Array<{ tool: string, scope: string, action: string, reason: string }>,
 *     permitted_actions?: string[],
 *     permitted_tool_names?: string[],
 *   } | null,
 * }} [ctx]
 */
export function mcpCapabilities(ctx = {}) {
  const cloud = ctx.cloud === true
  const profile = ctx.profile || (cloud ? 'safe' : 'unknown')
  const mode = ctx.mode || (cloud ? 'safe' : profile)
  const scopes = ctx.scopes === undefined ? null : ctx.scopes
  const surface = ctx.surface || 'both'
  const permitted = ctx.permitted || null

  const scopeList = Array.isArray(scopes) ? scopes : scopes === null ? null : []
  const has = (s) => scopeList == null || scopeList.includes(s)

  const can = {
    read_catalog: has('intel:read'),
    catalog_health_sample_search: has('intel:read'),
    inventory_ats_and_product_status: has('intel:read') || has('inventory:read'),
    ops_snapshot: has('intel:read'),
    help_center: has('intel:read'),
    list_store_requests_and_waves: has('store_ops:read'),
    recommend_store_request_decision_label_only: has('store_ops:read'),
    draft_internal_po: has('po:draft'),
    draft_store_replenishment_request: has('store_ops:write'),
    propose_pipeline_candidate: has('pipeline:propose'),
    market_bi_read: has('intel:read'),
  }

  const cannot = {
    create_or_send_invoices: true,
    // Permission-based: false when scope granted (owner/admin keys)
    approve_store_replenishment: !has('store_ops:approve'),
    execute_3pl_send_to_loft: !has('store_ops:execute_3pl'),
    apply_floor_adjustments: !has('inventory:write'),
    submit_or_approve_po: !has('po:submit') && !has('po:decide'),
    pipeline_execute: !has('pipeline:execute'),
    invent_sales_rankings_or_stock_from_catalog_field: true,
    credentials_on_cloud: true,
  }

  const domain_objects = {
    exists: [
      'products (catalog)',
      'inventory_levels / locations (ledger ATS)',
      'store_replenishment_requests',
      'store_replenishment_waves (Mon/Thu cadence)',
      'store_replenishment_orders (Loft leg)',
      'inbound_shipments (ASN forwarder→Loft)',
      'inventory_exceptions',
      'inventory_adjustments (floor — HQ apply)',
      'internal_purchase_orders (Actions decision drafts)',
      'pipeline_candidates',
      'help articles',
    ],
    does_not_exist: [
      'customer invoices / AR billing',
      'classic multi-warehouse transfer as a first-class MCP object (use Store Ops path)',
      'auto-send to Loft from POS signal',
    ],
  }

  const preferred_tools = {
    structure_import_questions: ['catalog_health', 'get_catalog_health'],
    sample_products: ['catalog_sample', 'sample_products'],
    category_research: ['catalog_search_summary', 'search_products_summary'],
    csv_export: ['catalog_export_csv', 'export_catalog_csv'],
    retail_pos_data_ops: ['catalog_data_ops', 'get_catalog_data_ops'],
    product_stock_or_status: ['product_inventory_status', 'get_product_inventory_status', 'inventory_ats'],
    whats_outstanding: ['ops_snapshot', 'get_ops_snapshot'],
    what_can_i_do: ['capabilities', 'get_capabilities'],
    how_to_operate: ['help_resolve', 'resolve_help'],
    draft_buying_intent: ['po_create_draft', 'po_clone_as_draft'],
    draft_store_request: ['store_ops_create_draft_request'],
  }

  return {
    surface,
    runtime: {
      cloud,
      profile,
      mode,
      scopes: scopes == null ? (cloud ? 'unrestricted_but_cloud_safe_strip' : 'unrestricted_or_env') : scopes,
      key_id: ctx.key_id || null,
      key_name: ctx.key_name || null,
      actor_user_id: ctx.actor_user_id || null,
    },
    /** Fast path: what THIS authenticated key may call right now */
    key_permissions: permitted
      ? {
          granted_scopes: permitted.granted_scopes,
          unrestricted: permitted.unrestricted === true,
          permitted_tool_count: (permitted.permitted_tools || []).length,
          denied_tool_count: (permitted.denied_tools || []).length,
          permitted_actions: permitted.permitted_actions || [],
          permitted_tool_names: permitted.permitted_tool_names || [],
          permitted_tools: permitted.permitted_tools || [],
          denied_tools_sample: (permitted.denied_tools || []).slice(0, 25),
          web_aligned: true,
          note: 'Scopes are capped by bound web user power ∩ cloud ceiling (A2).',
        }
      : null,
    can,
    cannot,
    domain_objects,
    preferred_tools,
    safety: {
      cloud_permission_based: true,
      note: 'Cloud MCP allows any tool whose required scope is in key ∩ bound web user. Owner/admin may approve store ops; member/viewer typically cannot. Credentials never on cloud keys.',
      human_ui: {
        store_ops: '/store-ops',
        actions: '/actions',
        inventory: '/inventory',
      },
    },
    agent_hint: permitted
      ? 'Answer “what can I do?” from key_permissions.permitted_actions. If store_ops_decide is listed, this key may approve. Approve ≠ send Loft. Never invent permissions.'
      : 'Use scopes: store_ops:approve for decide, inventory:write for apply floor, execute_3pl for Loft send. capabilities for this key.',
  }
}
