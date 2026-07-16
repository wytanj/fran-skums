/**
 * Tool → required MCP scope + human action label.
 * Used by capabilities (permitted actions for this key) and tools/list filtering.
 *
 * Cloud always strips PRIVILEGED tools regardless of key.
 */

import { MCP_PRIVILEGED_SCOPES, MCP_SCOPE_PROFILES } from './context.mjs'

/** @type {Record<string, { scope: string, action: string, privileged?: boolean }>} */
export const TOOL_SCOPE_CATALOG = {
  // Help
  help_resolve: { scope: 'intel:read', action: 'Look up how-to / Help articles' },
  help_get: { scope: 'intel:read', action: 'Read full Help article' },
  help_list: { scope: 'intel:read', action: 'List Help articles' },

  // Capabilities / ops
  capabilities: { scope: 'intel:read', action: 'List what this MCP key can and cannot do' },
  ops_snapshot: { scope: 'intel:read', action: 'See open store-ops / logistics queues' },

  // Catalog
  catalog_health: { scope: 'intel:read', action: 'Catalog structure / import readiness' },
  catalog_sample: { scope: 'intel:read', action: 'Sample N catalog products' },
  catalog_search_summary: { scope: 'intel:read', action: 'Category research with facets' },
  catalog_export_csv: { scope: 'intel:read', action: 'Export bounded catalog CSV' },
  catalog_data_ops: { scope: 'intel:read', action: 'Retail/POS intentional flags + seed plan' },
  catalog_stats: { scope: 'intel:read', action: 'Exact product census' },
  catalog_search: { scope: 'intel:read', action: 'Search catalog rows' },
  catalog_get: { scope: 'intel:read', action: 'Get one product by id/sku/ean' },

  // Inventory
  inventory_ats: { scope: 'intel:read', action: 'ATS by location (ledger)' },
  product_inventory_status: { scope: 'intel:read', action: 'Product logistics status / path' },

  // Store ops
  store_ops_list_requests: { scope: 'store_ops:read', action: 'List open store replenishment requests' },
  store_ops_list_waves: { scope: 'store_ops:read', action: 'List replenishment waves' },
  store_ops_recommend: { scope: 'store_ops:read', action: 'Recommend approve_now vs defer (label only)' },
  store_request_status: {
    scope: 'store_ops:read',
    action: 'M1 one-shot request pack (lines + recommend + waves)',
  },
  floor_adjustment_queue: {
    scope: 'store_ops:read',
    action: 'M2 pending floor adjustment queue digest',
  },
  exception_verify: {
    scope: 'store_ops:verify',
    action: 'M3 HQ verify receive exception (confirm/reject/adjust/escalate)',
  },
  reports_list: {
    scope: 'reports:read',
    action: 'List agentic report packs (toggle + last run)',
  },
  reports_get: {
    scope: 'reports:read',
    action: 'Get one report pack or run',
  },
  reports_run: {
    scope: 'reports:run',
    action: 'Run report pack now (suggest-only digest)',
  },
  store_ops_create_draft_request: {
    scope: 'store_ops:write',
    action: 'Create draft/submitted store request',
  },
  store_ops_decide: {
    scope: 'store_ops:approve',
    action: 'Approve / reject / defer store replenishment request (HQ)',
  },
  floor_adjustment_apply: {
    scope: 'inventory:write',
    action: 'Apply pending floor adjustment to ledger',
  },
  expiry_snapshot: { scope: 'intel:read', action: 'Expiry risk snapshot' },
  exceptions_snapshot: { scope: 'store_ops:read', action: 'Open exceptions triage' },
  integrations_health: { scope: 'intel:read', action: 'Integration / Loft connection health' },
  attention_snapshot: { scope: 'intel:read', action: 'Product attention queue snapshot' },
  low_stock_request_pack: {
    scope: 'inventory:read',
    action: 'Build low-stock store request pack (suggest)',
  },
  pos_enable_proposal: { scope: 'intel:read', action: 'List POS-off products for activation review' },
  inbound_create_draft: {
    scope: 'store_ops:write',
    action: 'Create draft inbound ASN (never send to Loft)',
  },
  floor_adjustment_create_draft: {
    scope: 'store_ops:write',
    action: 'Create floor adjustment draft/pending (never apply ledger)',
  },

  // Study
  study_start: { scope: 'study:write', action: 'Start study session' },
  study_get: { scope: 'intel:read', action: 'Get study session' },
  study_list: { scope: 'intel:read', action: 'List study sessions' },
  study_brief: { scope: 'study:write', action: 'Run study brief' },
  study_match_catalog: { scope: 'study:write', action: 'Match study to catalog' },
  study_propose: { scope: 'study:write', action: 'Propose pipeline from study' },

  // Market / BI read
  market_search: { scope: 'intel:read', action: 'Search market warehouse' },
  market_seller_mix: { scope: 'intel:read', action: 'Seller mix summary' },
  market_listing_history: { scope: 'intel:read', action: 'Listing history' },
  bi_list_seeds: { scope: 'intel:read', action: 'List crawl seeds' },
  bi_job_status: { scope: 'intel:read', action: 'Crawl job status' },
  bi_query_snapshots: { scope: 'intel:read', action: 'Query market snapshots' },
  bi_export_table: { scope: 'intel:read', action: 'Export market table' },
  bi_list_metrics: { scope: 'intel:read', action: 'List market metrics' },
  bi_latest_digest: { scope: 'intel:read', action: 'Latest market digest' },

  // BI write (privileged)
  bi_upsert_seed: { scope: 'intel:write', action: 'Create/update crawl seed', privileged: true },
  bi_set_cadence: { scope: 'intel:write', action: 'Change seed cadence', privileged: true },
  bi_run_seed_now: { scope: 'intel:write', action: 'Enqueue crawl job now', privileged: true },

  // Pipeline
  pipeline_propose: { scope: 'pipeline:propose', action: 'Propose pipeline candidate' },
  pipeline_list: { scope: 'intel:read', action: 'List pipeline candidates' },
  pipeline_preview_execute: { scope: 'intel:read', action: 'Dry-run pipeline execute payload' },
  pipeline_decide: { scope: 'pipeline:decide', action: 'Accept/reject pipeline candidate', privileged: true },
  pipeline_execute: { scope: 'pipeline:execute', action: 'Execute accepted pipeline candidate', privileged: true },

  // PO
  po_preview_clone: { scope: 'intel:read', action: 'Preview PO clone' },
  po_clone_as_draft: { scope: 'po:draft', action: 'Clone PO as draft' },
  po_create_draft: { scope: 'po:draft', action: 'Create draft internal PO' },
  po_update_draft: { scope: 'po:draft', action: 'Update draft PO' },
  po_add_lines: { scope: 'po:draft', action: 'Add lines to draft PO' },
  po_suggest_qty: { scope: 'intel:read', action: 'Suggest PO quantity' },
  po_get: { scope: 'intel:read', action: 'Get internal PO' },
  po_list: { scope: 'intel:read', action: 'List internal POs' },
  po_export: { scope: 'intel:read', action: 'Export internal PO' },
  po_submit: { scope: 'po:submit', action: 'Submit draft PO for approval', privileged: true },
  po_decide: { scope: 'po:decide', action: 'Approve/reject PO', privileged: true },

  // Projection
  projection_create: { scope: 'projection:run', action: 'Create projection run' },
  projection_from_po: { scope: 'projection:run', action: 'Projection from PO' },
  projection_from_study: { scope: 'projection:run', action: 'Projection from study' },
  projection_get: { scope: 'intel:read', action: 'Get projection' },
  projection_list: { scope: 'intel:read', action: 'List projections' },
  projection_export: { scope: 'intel:read', action: 'Export projection' },
}

/**
 * Privileged tool names (never on cloud tools/list).
 */
export function privilegedToolNames() {
  return Object.entries(TOOL_SCOPE_CATALOG)
    .filter(([, m]) => m.privileged || MCP_PRIVILEGED_SCOPES.includes(m.scope))
    .map(([name]) => name)
}

/**
 * Whether a tool is allowed under scopes + cloud.
 * @param {string} toolName
 * @param {{ scopes?: string[] | null, cloud?: boolean }} opts
 */
export function isToolPermitted(toolName, opts = {}) {
  const meta = TOOL_SCOPE_CATALOG[toolName]
  if (!meta) {
    // Unknown tools: only unrestricted profiles
    return opts.scopes == null
  }
  // A2: permission-based — privileged tools allowed on cloud when scope is granted
  if (opts.scopes == null) return true // unrestricted full profile
  return opts.scopes.includes(meta.scope)
}

/**
 * Build permitted / denied tool lists for this key.
 * @param {{
 *   scopes?: string[] | null,
 *   cloud?: boolean,
 *   toolNames?: string[],
 * }} opts
 */
export function resolvePermittedTools(opts = {}) {
  const cloud = opts.cloud === true
  const scopes = opts.scopes === undefined ? [...MCP_SCOPE_PROFILES.safe] : opts.scopes
  const names = opts.toolNames || Object.keys(TOOL_SCOPE_CATALOG)

  /** @type {Array<{ tool: string, scope: string, action: string }>} */
  const permitted = []
  /** @type {Array<{ tool: string, scope: string, action: string, reason: string }>} */
  const denied = []

  for (const name of names) {
    const meta = TOOL_SCOPE_CATALOG[name] || {
      scope: 'unknown',
      action: name,
      privileged: false,
    }
    const ok = isToolPermitted(name, { scopes, cloud })
    if (ok) {
      permitted.push({ tool: name, scope: meta.scope, action: meta.action })
    } else {
      const reason =
        scopes != null && !scopes.includes(meta.scope)
          ? `requires_scope:${meta.scope}`
          : 'missing_scope'
      denied.push({
        tool: name,
        scope: meta.scope,
        action: meta.action,
        reason,
      })
    }
  }

  permitted.sort((a, b) => a.tool.localeCompare(b.tool))
  denied.sort((a, b) => a.tool.localeCompare(b.tool))

  return {
    granted_scopes: scopes == null ? null : [...scopes],
    unrestricted: scopes == null,
    cloud,
    permitted_tools: permitted,
    denied_tools: denied,
    permitted_actions: permitted.map((p) => p.action),
    permitted_tool_names: permitted.map((p) => p.tool),
  }
}
