/**
 * Fran MCP tool definitions + handlers (BI + study + pipeline).
 */
import { randomUUID } from 'node:crypto'
import {
  errorResult,
  getDb,
  getMcpActorUserId,
  getMcpClientName,
  jsonResult,
  requireScope,
  requireWorkspaceId,
} from './context.mjs'
import { auditMcpMutation } from '../../core/audit/record.mjs'
import { getHelpArticleForAgent, listHelpArticles, resolveHelp } from '../../core/help/index.mjs'
import * as bi from './lib/bi.mjs'
import * as catalog from './lib/catalog.mjs'
import * as inventory from './lib/inventory.mjs'
import * as ops from './lib/ops.mjs'
import * as pipeline from './lib/pipeline.mjs'
import * as po from './lib/po.mjs'
import * as projection from './lib/projection.mjs'
import * as storeOps from './lib/storeOps.mjs'
import * as study from './lib/study.mjs'

/**
 * Record MCP mutation audit + attach envelope fields to result payload.
 * @param {string} toolName
 * @param {string} requestId
 * @param {{
 *   object_type: string,
 *   entity_id: string,
 *   status?: string|null,
 *   is_draft?: boolean,
 *   operation?: 'INSERT'|'UPDATE'|'DELETE',
 *   event_type?: string,
 *   after_data?: unknown,
 *   before_data?: unknown,
 *   metadata?: Record<string, unknown>,
 * }} entity
 * @param {Record<string, unknown>} resultBody
 */
async function withMcpAudit(toolName, requestId, entity, resultBody) {
  const workspace_id = requireWorkspaceId()
  const envelope = await auditMcpMutation(getDb(), {
    workspace_id,
    tool_name: toolName,
    request_id: requestId,
    client_name: getMcpClientName(),
    actor_user_id: getMcpActorUserId(),
    object_type: entity.object_type,
    entity_id: entity.entity_id,
    status: entity.status,
    is_draft: entity.is_draft,
    operation: entity.operation || 'INSERT',
    event_type: entity.event_type,
    after_data: entity.after_data,
    before_data: entity.before_data,
    metadata: entity.metadata,
    result: resultBody,
  })
  return jsonResult(envelope)
}

/** @type {import('@modelcontextprotocol/sdk/types.js').Tool[]} */
export const toolDefinitions = [
  // ── Study ──────────────────────────────────────────────────
  {
    name: 'study_start',
    description:
      'Open a Fran marketplace study session for a product/brand hypothesis. Use before brief/match/propose.',
    inputSchema: {
      type: 'object',
      properties: {
        hypothesis: { type: 'string', description: 'What we are studying and why' },
        query: { type: 'string', description: 'Shopee/search query e.g. anua official' },
        marketplace: { type: 'string', default: 'shopee' },
        country: { type: 'string', default: 'sg' },
        metadata: { type: 'object' },
      },
      required: ['hypothesis'],
    },
  },
  {
    name: 'study_get',
    description: 'Get a study session and its artifacts (brief, match, serp table).',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string' } },
      required: ['session_id'],
    },
  },
  {
    name: 'study_list',
    description: 'List recent study sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'study_brief',
    description:
      'Generate a grounded study brief (Grok if XAI_API_KEY set, else offline metrics-based). Stores artifact.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        force_offline: { type: 'boolean', description: 'Skip Grok even if key present' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'study_match_catalog',
    description: 'Match study query/listings to Fran catalog products (rules + optional Grok rerank).',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        force_offline: { type: 'boolean' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'study_propose',
    description:
      'From latest brief, propose pipeline candidates (watchlist_seed and/or catalog_product).',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        kinds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Override kinds e.g. ["watchlist_seed","catalog_product"]',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'market_search',
    description:
      'Search warehouse SERP/export for a query (latest snapshots). Sheet-ready rows + seller mix summary.',
    inputSchema: {
      type: 'object',
      properties: {
        search_query: { type: 'string' },
        seller_type: { type: 'string' },
        limit: { type: 'number' },
        format: { type: 'string', enum: ['json', 'csv'] },
      },
      required: ['search_query'],
    },
  },
  {
    name: 'market_seller_mix',
    description: 'Seller mix / undercut metrics for a search query from warehouse data.',
    inputSchema: {
      type: 'object',
      properties: { search_query: { type: 'string' } },
      required: ['search_query'],
    },
  },
  {
    name: 'market_listing_history',
    description: 'Time series snapshots for a listing (listing_id or shop_id+item_id).',
    inputSchema: {
      type: 'object',
      properties: {
        listing_id: { type: 'string' },
        shop_id: { type: 'string' },
        item_id: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },

  // ── Pipeline ───────────────────────────────────────────────
  {
    name: 'pipeline_propose',
    description: 'Create a pipeline candidate (watchlist_seed, catalog_product, …).',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string' },
        payload: { type: 'object' },
        evidence_refs: { type: 'array', items: { type: 'string' } },
        source_study_id: { type: 'string' },
        listing_id: { type: 'string' },
        product_id: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
      required: ['kind', 'title'],
    },
  },
  {
    name: 'pipeline_list',
    description: 'List pipeline candidates.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        kind: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'pipeline_decide',
    description: "Accept, reject, or defer a pipeline candidate.",
    inputSchema: {
      type: 'object',
      properties: {
        candidate_id: { type: 'string' },
        decision: { type: 'string', enum: ['accepted', 'rejected', 'deferred'] },
        decision_note: { type: 'string' },
      },
      required: ['candidate_id', 'decision'],
    },
  },
  {
    name: 'pipeline_execute',
    description:
      'PRIVILEGED. Executes an accepted candidate (writes crawl seed or draft product). Prefer pipeline_preview_execute first. Requires full MCP profile.',
    inputSchema: {
      type: 'object',
      properties: { candidate_id: { type: 'string' } },
      required: ['candidate_id'],
    },
  },
  {
    name: 'pipeline_preview_execute',
    description:
      'READ ONLY dry-run of pipeline_execute: shows the seed/product payload that would be written. No DB write. Safe for agents.',
    inputSchema: {
      type: 'object',
      properties: { candidate_id: { type: 'string' } },
      required: ['candidate_id'],
    },
  },

  // ── Help Center (nav / how-to — same articles as in-app /help) ──
  {
    name: 'help_resolve',
    description:
      'Resolve "where do I…" / how-to / store-ops / Loft questions to Help Center articles with body_excerpt and /help/{slug}. Never invent routes. intel:read / safe / cloud.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'User question e.g. how do I approve replenishment or receive delivery' },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'help_get',
    description:
      'Load full Help article by slug (body_md). Use after help_resolve for complete operator steps (store-ops, floor adjustments, Loft, operator-runbook). intel:read / safe / cloud.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'e.g. store-ops-replenishment, operator-runbook' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'help_list',
    description: 'List published Help Center articles (titles, summaries, paths). Filter category e.g. operations. intel:read / safe / cloud.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
      },
    },
  },

  // ── Ops snapshot + capabilities (what’s outstanding / what can I do) ──
  {
    name: 'ops_snapshot',
    description:
      'ONE-SHOT store-ops / logistics queue: open requests, waves (Mon/Thu), exceptions, pending floor adjustments, open inbound ASN, Loft replenish orders, draft/pending internal POs + samples. Use for “what’s outstanding”, “any transfers/requests?”, “what needs attention?”. Does not approve or send to Loft. intel:read / safe / cloud.',
    inputSchema: {
      type: 'object',
      properties: {
        include_samples: {
          type: 'boolean',
          description: 'Include recent row samples (default true)',
        },
      },
    },
  },
  {
    name: 'capabilities',
    description:
      'What Fran MCP can and cannot do: no invoices, no approve/execute_3pl on cloud, domain objects that exist vs not, preferred tools for stock/ops/catalog. Use when user asks “can I create an invoice / order from warehouse / what tools exist?”. intel:read / safe / cloud.',
    inputSchema: {
      type: 'object',
      properties: {
        surface: { type: 'string', enum: ['mcp', 'catalog_ai', 'both'] },
      },
    },
  },

  // ── Inventory ATS + product logistics status ──
  {
    name: 'inventory_ats',
    description:
      'Ledger available-to-sell by location for one or more products (SKU / product_id / search). ATS = on_hand − reserved from inventory_levels. Locations: LOFT-SG (3pl warehouse), XFER-* / in_transit (loft→store), store. Prefer this over product.stock_quantity. intel:read / safe / cloud.',
    inputSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'Single product SKU' },
        skus: { type: 'array', items: { type: 'string' }, description: 'Multiple SKUs (max 50)' },
        product_id: { type: 'string' },
        product_ids: { type: 'array', items: { type: 'string' } },
        q: { type: 'string', description: 'Title/SKU search when SKU unknown' },
        query: { type: 'string' },
        location_codes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional filter e.g. ["LOFT-SG","ST-MAIN"]',
        },
      },
    },
  },
  {
    name: 'product_inventory_status',
    description:
      'Answer “what’s the status of product X?”: lifecycle (in stock at loft/store, in transit loft→store, inbound from forwarder→Loft, replenish in flight), path_summary, open ASN/replenish/requests/floor adj, plus per-location ATS. Prefer for single-SKU logistics status. intel:read / safe / cloud.',
    inputSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'Exact SKU (preferred)' },
        product_id: { type: 'string' },
        id: { type: 'string', description: 'Alias of product_id' },
        q: { type: 'string', description: 'Title/SKU search if SKU unknown' },
        query: { type: 'string' },
      },
    },
  },

  // ── Catalog Q&A (Fran products table — not marketplace BI) ──
  // Prefer composite tools first (catalog_health / sample / search_summary) for speed.
  {
    name: 'catalog_export_csv',
    description:
      'Bounded CSV export of catalog rows (default 50, max 200). Filter by q/brand/status/sku. Columns include retail_price, cost, pos_enabled for offline retail fill / re-import. Never dumps full 10k catalog. intel:read / safe / cloud.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search title/sku/ean' },
        query: { type: 'string' },
        brand: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'active', 'archived'] },
        sku: { type: 'string' },
        limit: { type: 'number', description: 'Rows (default 50, max 200)' },
        offset: { type: 'number' },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional subset of export columns',
        },
      },
    },
  },
  {
    name: 'catalog_data_ops',
    description:
      'ONE-SHOT data ops: intentional read of retail/POS flags after cost import + recommended actions + read-only market seed suggestions for research. Does not write seeds or activate POS. Prefer when user asks why retail empty, should we POS-enable, or seed market watches. intel:read / safe / cloud.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: { type: 'string' },
        q: { type: 'string', description: 'Optional keyword to bias sample/seeds' },
        query: { type: 'string' },
        seed_suggestions: { type: 'number', description: 'How many seed ideas (default 5, max 12)' },
        marketplace: { type: 'string', description: 'Default shopee' },
        country: { type: 'string', description: 'Default sg' },
      },
    },
  },
  {
    name: 'catalog_health',
    description:
      'ONE-SHOT catalog structure check for large imports: totals, missing retail/SKU/EAN, POS flags, cost spread, import_source, catalog_mode_guess + agent_hint. Prefer this before multi-step sampling when user asks best products, research readiness, or why data looks empty. Does NOT invent performance rankings. intel:read / safe / cloud.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: { type: 'string', description: 'Optional brand filter' },
        sample_for_cost: { type: 'number', description: 'Rows to sample for cost/POS/import facets (default 2000)' },
      },
    },
  },
  {
    name: 'catalog_sample',
    description:
      'Return N real catalog products in one call (spread across catalog or keyword match). Use for “sample 5 products / research these” instead of many offset searches. Not a “best of” ranking. intel:read / safe / cloud.',
    inputSchema: {
      type: 'object',
      properties: {
        n: { type: 'number', description: 'How many products (default 5, max 20)' },
        q: { type: 'string', description: 'Optional keyword (title/sku)' },
        query: { type: 'string' },
        brand: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'active', 'archived'] },
        strategy: { type: 'string', enum: ['spread', 'recent', 'keyword'] },
      },
    },
  },
  {
    name: 'catalog_search_summary',
    description:
      'Search + total count + brand/cost/POS facets in ONE call (e.g. “lipsticks”). Prefer over catalog_search alone when user wants category research or a shortlist with stats. intel:read / safe / cloud.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search text e.g. lipstick' },
        query: { type: 'string' },
        brand: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'active', 'archived'] },
        limit: { type: 'number', description: 'Example rows to return (default 10, max 25)' },
        facet_sample: { type: 'number', description: 'Max rows for brand/cost facets (default 400)' },
      },
    },
  },
  {
    name: 'catalog_stats',
    description:
      'Exact product census (total, by status, missing SKU, with EAN, top brands). Prefer catalog_health for import/ops structure questions. intel:read / safe.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: { type: 'string', description: 'Optional brand name filter' },
        top_brands: { type: 'number' },
      },
    },
  },
  {
    name: 'catalog_search',
    description:
      'Paginated product search. Prefer catalog_search_summary when user wants counts/facets too. intel:read / safe.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search text (title/sku/ean)' },
        query: { type: 'string', description: 'Alias of q' },
        status: { type: 'string', enum: ['draft', 'active', 'archived'] },
        brand: { type: 'string' },
        sku: { type: 'string' },
        ean: { type: 'string' },
        limit: { type: 'number', description: 'Max rows (default 15, max 25)' },
        offset: { type: 'number' },
      },
    },
  },
  {
    name: 'catalog_get',
    description: 'Get one catalog product by id, sku, ean, upc, or gtin. intel:read / safe.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        product_id: { type: 'string' },
        sku: { type: 'string' },
        ean: { type: 'string' },
        upc: { type: 'string' },
        gtin: { type: 'string' },
      },
    },
  },

  // ── BI ─────────────────────────────────────────────────────
  {
    name: 'bi_list_seeds',
    description: 'List marketplace crawl seeds (daily/weekly watches).',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        marketplace: { type: 'string' },
        country: { type: 'string' },
      },
    },
  },
  {
    name: 'bi_upsert_seed',
    description: 'Create or update a crawl seed (keyword/shop watch with cadence).',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        marketplace: { type: 'string' },
        country: { type: 'string' },
        mode: { type: 'string' },
        schedule_kind: { type: 'string', enum: ['daily', 'weekly', 'cron', 'manual_only'] },
        preferred_hour: { type: 'number' },
        weekly_day: { type: 'number' },
        max_pages: { type: 'number' },
        max_listings: { type: 'number' },
        collector_id: {
          type: 'string',
          description: 'mock | browserbase | shopee_puppeteer | cloudflare_browser_run',
        },
        enabled: { type: 'boolean' },
        priority: { type: 'number' },
      },
      required: ['target'],
    },
  },
  {
    name: 'bi_set_cadence',
    description: 'Change schedule for an existing seed.',
    inputSchema: {
      type: 'object',
      properties: {
        seed_id: { type: 'string' },
        schedule_kind: { type: 'string' },
        preferred_hour: { type: 'number' },
        weekly_day: { type: 'number' },
        enabled: { type: 'boolean' },
        collector_id: { type: 'string' },
      },
      required: ['seed_id'],
    },
  },
  {
    name: 'bi_run_seed_now',
    description: 'Enqueue an immediate crawl job for a seed (does not run browser; use process-jobs worker).',
    inputSchema: {
      type: 'object',
      properties: { seed_id: { type: 'string' } },
      required: ['seed_id'],
    },
  },
  {
    name: 'bi_job_status',
    description: 'List crawl jobs or fetch by job_id / seed_id.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string' },
        seed_id: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'bi_query_snapshots',
    description: 'Query listing snapshots with filters (seller_type, price, query, overseas).',
    inputSchema: {
      type: 'object',
      properties: {
        search_query: { type: 'string' },
        seller_type: { type: 'string' },
        min_price: { type: 'number' },
        max_price: { type: 'number' },
        overseas: { type: 'boolean' },
        since: { type: 'string' },
        until: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'bi_export_table',
    description: 'Sheet-ready export table (JSON rows or CSV) + seller-mix summary for agents/sheets.',
    inputSchema: {
      type: 'object',
      properties: {
        search_query: { type: 'string' },
        seller_type: { type: 'string' },
        format: { type: 'string', enum: ['json', 'csv'] },
        limit: { type: 'number' },
        country: { type: 'string' },
      },
    },
  },
  {
    name: 'bi_list_metrics',
    description: 'Read marketplace_metrics_daily aggregates.',
    inputSchema: {
      type: 'object',
      properties: {
        metric_date: { type: 'string' },
        dimension_key: { type: 'string' },
        q: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'bi_latest_digest',
    description: 'Latest BI digest if any (may be empty until digests are generated).',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Internal POs ───────────────────────────────────────────
  {
    name: 'po_preview_clone',
    description:
      'READ ONLY. Preview cloning an internal PO with brand/sku/title exclusions (e.g. remove Anua and 3CE). No DB write. Always would create status=draft.',
    inputSchema: {
      type: 'object',
      properties: {
        source_po_id: { type: 'string' },
        exclude_brands: {
          type: 'array',
          items: { type: 'string' },
          description: 'Drop lines whose title/brand contains these tokens (case-insensitive)',
        },
        exclude_skus: { type: 'array', items: { type: 'string' } },
        exclude_title_contains: { type: 'array', items: { type: 'string' } },
      },
      required: ['source_po_id'],
    },
  },
  {
    name: 'po_clone_as_draft',
    description:
      'Creates a NEW internal PO in DRAFT only (never submits). Copies lines from source_po_id applying exclusions. Does not change the source PO. User must po_submit (full profile) or use UI to advance.',
    inputSchema: {
      type: 'object',
      properties: {
        source_po_id: { type: 'string' },
        exclude_brands: { type: 'array', items: { type: 'string' } },
        exclude_skus: { type: 'array', items: { type: 'string' } },
        exclude_title_contains: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
        supplier_name: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
      required: ['source_po_id'],
    },
  },
  {
    name: 'po_create_draft',
    description:
      'Creates an internal purchase order in DRAFT only (decision-layer, not inventory PO). Does not submit or approve.',
    inputSchema: {
      type: 'object',
      properties: {
        supplier_name: { type: 'string' },
        currency: { type: 'string' },
        needed_by: { type: 'string', description: 'YYYY-MM-DD' },
        notes: { type: 'string' },
        study_session_id: { type: 'string' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              quantity: { type: 'number' },
              unit_cost: { type: 'number' },
              sku: { type: 'string' },
              product_id: { type: 'string' },
              listing_id: { type: 'string' },
              shop_id: { type: 'string' },
              item_id: { type: 'string' },
            },
            required: ['title', 'quantity'],
          },
        },
        idempotency_key: { type: 'string' },
      },
    },
  },
  {
    name: 'po_update_draft',
    description: 'Update draft PO header fields.',
    inputSchema: {
      type: 'object',
      properties: {
        po_id: { type: 'string' },
        supplier_name: { type: 'string' },
        currency: { type: 'string' },
        needed_by: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['po_id'],
    },
  },
  {
    name: 'po_add_lines',
    description: 'Add lines to a draft internal PO.',
    inputSchema: {
      type: 'object',
      properties: {
        po_id: { type: 'string' },
        lines: { type: 'array', items: { type: 'object' } },
      },
      required: ['po_id', 'lines'],
    },
  },
  {
    name: 'po_suggest_qty',
    description: 'Non-binding quantity suggestion from sold lower bounds or weekly units.',
    inputSchema: {
      type: 'object',
      properties: {
        sold_lower_bounds: { type: 'array', items: { type: 'number' } },
        units_per_week_high: { type: 'number' },
        cover_weeks: { type: 'number' },
      },
    },
  },
  {
    name: 'po_submit',
    description:
      'PRIVILEGED. Submits a DRAFT internal PO for approval (draft → pending_approval). Emits lifecycle po.submitted. Requires full profile. Prefer human UI when possible.',
    inputSchema: {
      type: 'object',
      properties: { po_id: { type: 'string' } },
      required: ['po_id'],
    },
  },
  {
    name: 'po_decide',
    description:
      'PRIVILEGED. Approve or reject a PO in pending_approval (emits po.approved / po.rejected). Requires full profile.',
    inputSchema: {
      type: 'object',
      properties: {
        po_id: { type: 'string' },
        decision: { type: 'string', enum: ['approved', 'rejected'] },
        decision_note: { type: 'string' },
      },
      required: ['po_id', 'decision'],
    },
  },
  {
    name: 'po_get',
    description: 'Get internal PO with lines.',
    inputSchema: {
      type: 'object',
      properties: { po_id: { type: 'string' } },
      required: ['po_id'],
    },
  },
  {
    name: 'po_list',
    description: 'List internal purchase orders.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'po_export',
    description: 'Export internal PO as flat sheet-ready payload.',
    inputSchema: {
      type: 'object',
      properties: { po_id: { type: 'string' } },
      required: ['po_id'],
    },
  },

  // ── Projections ────────────────────────────────────────────
  {
    name: 'projection_create',
    description:
      'Run financial projection from assumptions (unit_cost, retail_price, weekly units). Grok comments if XAI_API_KEY set.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        unit_cost: { type: 'number' },
        retail_price: { type: 'number' },
        units_per_week_low: { type: 'number' },
        units_per_week_high: { type: 'number' },
        horizon_weeks: { type: 'number' },
        payment_fees_pct: { type: 'number' },
        shipping_per_unit: { type: 'number' },
        returns_pct: { type: 'number' },
        quantity_on_order: { type: 'number' },
        currency: { type: 'string' },
        force_offline: { type: 'boolean' },
      },
      required: ['title', 'unit_cost', 'retail_price', 'units_per_week_low', 'units_per_week_high'],
    },
  },
  {
    name: 'projection_from_po',
    description: 'Project economics from an internal PO (uses line costs; retail_price optional).',
    inputSchema: {
      type: 'object',
      properties: {
        po_id: { type: 'string' },
        retail_price: { type: 'number' },
        units_per_week_low: { type: 'number' },
        units_per_week_high: { type: 'number' },
        horizon_weeks: { type: 'number' },
        force_offline: { type: 'boolean' },
      },
      required: ['po_id'],
    },
  },
  {
    name: 'projection_from_study',
    description: 'Project from study session market signals + your unit_cost.',
    inputSchema: {
      type: 'object',
      properties: {
        study_session_id: { type: 'string' },
        unit_cost: { type: 'number' },
        retail_price: { type: 'number' },
        horizon_weeks: { type: 'number' },
        force_offline: { type: 'boolean' },
      },
      required: ['study_session_id', 'unit_cost'],
    },
  },
  {
    name: 'projection_get',
    description: 'Get a projection run by id.',
    inputSchema: {
      type: 'object',
      properties: { projection_id: { type: 'string' } },
      required: ['projection_id'],
    },
  },
  {
    name: 'projection_list',
    description: 'List projection runs.',
    inputSchema: {
      type: 'object',
      properties: {
        source_type: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'projection_export',
    description: 'Sheet-ready export of a projection run.',
    inputSchema: {
      type: 'object',
      properties: { projection_id: { type: 'string' } },
      required: ['projection_id'],
    },
  },
  // ── Store ops (HQ decision support — read only) ───────────
  {
    name: 'store_ops_list_requests',
    description:
      'List open store replenishment requests awaiting HQ review. Advisory only — does not approve or send to Loft.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter status; default open queue' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'store_ops_list_waves',
    description:
      'List Mon/Thu-style replenishment waves and upcoming wave dates. Default cadence Monday + Thursday.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  },
  {
    name: 'store_ops_recommend',
    description:
      'Baseline + lift recommendation for one request: approve_now vs defer_to_wave. Label only — human must decide with store_ops:approve.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string' },
      },
      required: ['request_id'],
    },
  },
]

/**
 * @param {string} name
 * @param {Record<string, unknown>} args
 */
export async function handleTool(name, args = {}) {
  const requestId = randomUUID()
  try {
    const a = args || {}
    switch (name) {
      case 'study_start': {
        requireScope('study:write')
        const workspace_id = requireWorkspaceId()
        const session = await study.createStudySession({
          workspace_id,
          hypothesis: a.hypothesis,
          query: a.query ?? null,
          marketplace: a.marketplace,
          country: a.country,
          metadata: a.metadata,
        })
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'study_sessions',
            entity_id: session.id,
            status: session.status || 'open',
            operation: 'INSERT',
            after_data: session,
          },
          { session },
        )
      }
      case 'study_get': {
        requireScope('intel:read')
        const pack = await study.getStudySession(requireWorkspaceId(), String(a.session_id))
        if (!pack) throw new Error('Study session not found')
        return jsonResult(pack)
      }
      case 'study_list': {
        requireScope('intel:read')
        const sessions = await study.listStudySessions(requireWorkspaceId(), {
          status: a.status,
          limit: a.limit,
        })
        return jsonResult({ sessions })
      }
      case 'study_brief': {
        requireScope('study:write')
        const result = await study.runStudyBrief(
          String(a.session_id),
          requireWorkspaceId(),
          { force_offline: a.force_offline === true },
        )
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'study_sessions',
            entity_id: String(a.session_id),
            status: 'briefed',
            operation: 'UPDATE',
            after_data: result,
          },
          result,
        )
      }
      case 'study_match_catalog': {
        requireScope('study:write')
        const result = await study.runStudyMatchCatalog(
          String(a.session_id),
          requireWorkspaceId(),
          { force_offline: a.force_offline === true },
        )
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'study_sessions',
            entity_id: String(a.session_id),
            status: 'matched',
            operation: 'UPDATE',
            after_data: result,
          },
          result,
        )
      }
      case 'study_propose': {
        requireScope('pipeline:propose')
        const result = await pipeline.proposeFromStudyBrief({
          workspace_id: requireWorkspaceId(),
          study_session_id: String(a.session_id),
          kinds: Array.isArray(a.kinds) ? a.kinds.map(String) : undefined,
        })
        const first = Array.isArray(result?.candidates) ? result.candidates[0] : result?.candidate
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'pipeline_candidates',
            entity_id: first?.id || String(a.session_id),
            status: first?.status || 'proposed',
            operation: 'INSERT',
            after_data: result,
            metadata: { study_session_id: a.session_id },
          },
          result,
        )
      }
      case 'help_resolve': {
        requireScope('intel:read')
        const result = await resolveHelp(getDb(), String(a.query || ''), {
          limit: a.limit,
        })
        return jsonResult(result)
      }
      case 'help_get': {
        requireScope('intel:read')
        const result = await getHelpArticleForAgent(getDb(), String(a.slug || ''), {
          max_body_chars: 12000,
        })
        return jsonResult(result)
      }
      case 'help_list': {
        requireScope('intel:read')
        const articles = await listHelpArticles(getDb(), {
          category: a.category || null,
        })
        return jsonResult({ articles, help_index_path: '/help', count: articles.length })
      }
      case 'ops_snapshot': {
        requireScope('intel:read')
        const result = await ops.snapshotOps(requireWorkspaceId(), a)
        return jsonResult(result)
      }
      case 'capabilities': {
        requireScope('intel:read')
        const result = ops.capabilitiesOps(a)
        return jsonResult(result)
      }
      case 'inventory_ats': {
        requireScope('intel:read')
        const result = await inventory.atsInventory(requireWorkspaceId(), a)
        return jsonResult(result)
      }
      case 'product_inventory_status': {
        requireScope('intel:read')
        const result = await inventory.productStatus(requireWorkspaceId(), a)
        return jsonResult(result)
      }
      case 'catalog_export_csv': {
        requireScope('intel:read')
        const result = await catalog.exportCsvCatalog(requireWorkspaceId(), a)
        return jsonResult(result)
      }
      case 'catalog_data_ops': {
        requireScope('intel:read')
        const result = await catalog.dataOpsCatalog(requireWorkspaceId(), a)
        return jsonResult(result)
      }
      case 'catalog_health': {
        requireScope('intel:read')
        const result = await catalog.healthCatalog(requireWorkspaceId(), a)
        return jsonResult(result)
      }
      case 'catalog_sample': {
        requireScope('intel:read')
        const result = await catalog.sampleCatalog(requireWorkspaceId(), a)
        return jsonResult(result)
      }
      case 'catalog_search_summary': {
        requireScope('intel:read')
        const result = await catalog.searchSummaryCatalog(requireWorkspaceId(), a)
        return jsonResult(result)
      }
      case 'catalog_stats': {
        requireScope('intel:read')
        const result = await catalog.statsCatalog(requireWorkspaceId(), {
          brand: a.brand,
          top_brands: a.top_brands,
        })
        return jsonResult(result)
      }
      case 'catalog_search': {
        requireScope('intel:read')
        const result = await catalog.searchCatalog(requireWorkspaceId(), a)
        return jsonResult(result)
      }
      case 'catalog_get': {
        requireScope('intel:read')
        const result = await catalog.getCatalogProduct(requireWorkspaceId(), a)
        return jsonResult(result)
      }
      case 'market_search': {
        requireScope('intel:read')
        const result = await bi.exportTable(requireWorkspaceId(), {
          search_query: a.search_query,
          seller_type: a.seller_type,
          limit: a.limit,
          format: a.format === 'csv' ? 'csv' : 'json',
        })
        return jsonResult(result)
      }
      case 'market_seller_mix': {
        requireScope('intel:read')
        const summary = await bi.sellerMix(requireWorkspaceId(), String(a.search_query))
        return jsonResult({ search_query: a.search_query, summary })
      }
      case 'market_listing_history': {
        requireScope('intel:read')
        const hist = await bi.listingHistory(requireWorkspaceId(), {
          listing_id: a.listing_id,
          shop_id: a.shop_id,
          item_id: a.item_id,
          limit: a.limit,
        })
        return jsonResult(hist)
      }
      case 'pipeline_propose': {
        requireScope('pipeline:propose')
        const result = await pipeline.proposePipelineCandidate({
          workspace_id: requireWorkspaceId(),
          kind: a.kind,
          title: a.title,
          summary: a.summary,
          payload: a.payload,
          evidence_refs: a.evidence_refs,
          source_study_id: a.source_study_id,
          listing_id: a.listing_id,
          product_id: a.product_id,
          idempotency_key: a.idempotency_key,
        })
        const c = result.candidate
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'pipeline_candidates',
            entity_id: c.id,
            status: c.status,
            is_draft: c.status === 'proposed',
            operation: result.deduped ? 'UPDATE' : 'INSERT',
            after_data: c,
          },
          result,
        )
      }
      case 'pipeline_list': {
        requireScope('intel:read')
        const candidates = await pipeline.listPipelineCandidates(requireWorkspaceId(), {
          status: a.status,
          kind: a.kind,
          limit: a.limit,
        })
        return jsonResult({ candidates })
      }
      case 'pipeline_decide': {
        requireScope('pipeline:decide')
        const candidate = await pipeline.decidePipelineCandidate({
          workspace_id: requireWorkspaceId(),
          candidate_id: String(a.candidate_id),
          decision: a.decision,
          decision_note: a.decision_note,
        })
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'pipeline_candidates',
            entity_id: candidate.id,
            status: candidate.status,
            operation: 'UPDATE',
            after_data: candidate,
          },
          { candidate },
        )
      }
      case 'pipeline_execute': {
        requireScope('pipeline:execute')
        const candidate = await pipeline.executePipelineCandidate({
          workspace_id: requireWorkspaceId(),
          candidate_id: String(a.candidate_id),
        })
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'pipeline_candidates',
            entity_id: candidate.id || String(a.candidate_id),
            status: candidate.status || 'executed',
            operation: 'UPDATE',
            after_data: candidate,
            metadata: { lifecycle_event: 'pipeline.executed' },
          },
          { candidate, lifecycle_event: 'pipeline.executed' },
        )
      }
      case 'pipeline_preview_execute': {
        requireScope('intel:read')
        const preview = await pipeline.previewExecutePipelineCandidate({
          workspace_id: requireWorkspaceId(),
          candidate_id: String(a.candidate_id),
        })
        return jsonResult({
          ...preview,
          object_type: 'pipeline_candidates',
          id: preview.candidate?.id,
          status: preview.candidate?.status,
          channel: 'mcp',
          is_draft: true,
          next_allowed_actions: preview.can_execute_now
            ? ['pipeline_execute']
            : ['pipeline_decide', 'pipeline_list'],
        })
      }
      case 'bi_list_seeds': {
        requireScope('intel:read')
        const seeds = await bi.listSeeds(requireWorkspaceId(), {
          enabled: a.enabled,
          marketplace: a.marketplace,
          country: a.country,
        })
        return jsonResult({ seeds })
      }
      case 'bi_upsert_seed': {
        requireScope('intel:write')
        const seed = await bi.upsertSeed(requireWorkspaceId(), a)
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'marketplace_crawl_seeds',
            entity_id: seed.id,
            status: seed.enabled === false ? 'disabled' : 'enabled',
            is_draft: false,
            operation: 'UPDATE',
            after_data: seed,
          },
          { seed },
        )
      }
      case 'bi_set_cadence': {
        requireScope('intel:write')
        const seed = await bi.setSeedCadence(requireWorkspaceId(), String(a.seed_id), a)
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'marketplace_crawl_seeds',
            entity_id: seed.id,
            status: seed.enabled === false ? 'disabled' : 'enabled',
            is_draft: false,
            operation: 'UPDATE',
            after_data: seed,
          },
          { seed },
        )
      }
      case 'bi_run_seed_now': {
        requireScope('intel:write')
        const job = await bi.runSeedNow(requireWorkspaceId(), String(a.seed_id))
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'marketplace_crawl_jobs',
            entity_id: job.id,
            status: job.status || 'pending',
            is_draft: false,
            operation: 'INSERT',
            after_data: job,
            metadata: { seed_id: a.seed_id },
          },
          {
            job,
            note: 'Job enqueued as pending. Run POST /api/internal/marketplace/process-jobs (or worker) to collect.',
          },
        )
      }
      case 'bi_job_status': {
        requireScope('intel:read')
        const jobs = await bi.listJobs(requireWorkspaceId(), {
          job_id: a.job_id,
          seed_id: a.seed_id,
          status: a.status,
          limit: a.limit,
        })
        return jsonResult({ jobs })
      }
      case 'bi_query_snapshots': {
        requireScope('intel:read')
        const snapshots = await bi.querySnapshots(requireWorkspaceId(), a)
        return jsonResult({ snapshots, count: snapshots.length })
      }
      case 'bi_export_table': {
        requireScope('intel:read')
        const result = await bi.exportTable(requireWorkspaceId(), a)
        return jsonResult(result)
      }
      case 'bi_list_metrics': {
        requireScope('intel:read')
        const metrics = await bi.listMetrics(requireWorkspaceId(), a)
        return jsonResult({ metrics })
      }
      case 'bi_latest_digest': {
        requireScope('intel:read')
        const digest = await bi.latestDigest(requireWorkspaceId())
        return jsonResult({ digest: digest || null })
      }
      case 'po_preview_clone': {
        requireScope('intel:read')
        const preview = await po.previewClone(requireWorkspaceId(), String(a.source_po_id), {
          exclude_brands: a.exclude_brands,
          exclude_skus: a.exclude_skus,
          exclude_title_contains: a.exclude_title_contains,
        })
        return jsonResult({
          ...preview,
          object_type: 'internal_purchase_orders',
          id: preview.source_po?.id,
          status: 'preview',
          is_draft: true,
          channel: 'mcp',
          next_allowed_actions: ['po_clone_as_draft'],
        })
      }
      case 'po_clone_as_draft': {
        requireScope('po:draft')
        const result = await po.cloneAsDraft(
          requireWorkspaceId(),
          String(a.source_po_id),
          {
            exclude_brands: a.exclude_brands,
            exclude_skus: a.exclude_skus,
            exclude_title_contains: a.exclude_title_contains,
          },
          {
            notes: a.notes,
            supplier_name: a.supplier_name,
            idempotency_key: a.idempotency_key,
          },
        )
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'internal_purchase_orders',
            entity_id: result.po.id,
            status: 'draft',
            is_draft: true,
            operation: result.deduped ? 'UPDATE' : 'INSERT',
            after_data: result.po,
            metadata: {
              source_po_id: a.source_po_id,
              clone: result.clone,
              deep_link_hint: `/actions/internal-pos/${result.po.id}`,
            },
          },
          {
            ...result,
            deep_link: `/actions/internal-pos/${result.po.id}`,
            note: 'DRAFT created only — not submitted. Review in SKUMS Actions UI or call po_submit (full profile).',
          },
        )
      }
      case 'po_create_draft': {
        requireScope('po:draft')
        const result = await po.createDraft({
          workspace_id: requireWorkspaceId(),
          ...a,
        })
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'internal_purchase_orders',
            entity_id: result.po.id,
            status: result.po.status,
            is_draft: true,
            operation: result.deduped ? 'UPDATE' : 'INSERT',
            after_data: result.po,
            metadata: { deep_link_hint: `/actions/internal-pos/${result.po.id}` },
          },
          {
            ...result,
            deep_link: `/actions/internal-pos/${result.po.id}`,
            note: 'DRAFT only — not submitted.',
          },
        )
      }
      case 'po_update_draft': {
        requireScope('po:draft')
        const result = await po.updateDraft(
          requireWorkspaceId(),
          String(a.po_id),
          a,
        )
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'internal_purchase_orders',
            entity_id: result.po.id,
            status: result.po.status,
            is_draft: result.po.status === 'draft',
            operation: 'UPDATE',
            after_data: result.po,
          },
          result,
        )
      }
      case 'po_add_lines': {
        requireScope('po:draft')
        const result = await po.addLines(
          requireWorkspaceId(),
          String(a.po_id),
          a.lines || [],
        )
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'internal_purchase_orders',
            entity_id: result.po.id,
            status: result.po.status,
            is_draft: result.po.status === 'draft',
            operation: 'UPDATE',
            after_data: { po: result.po, line_count: result.lines?.length },
            metadata: { lines_added: Array.isArray(a.lines) ? a.lines.length : 0 },
          },
          result,
        )
      }
      case 'po_suggest_qty': {
        requireScope('intel:read')
        return jsonResult(po.suggestQty(a))
      }
      case 'po_submit': {
        requireScope('po:submit')
        const result = await po.submitWithEvent(requireWorkspaceId(), String(a.po_id))
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'internal_purchase_orders',
            entity_id: result.po.id,
            status: result.po.status,
            is_draft: false,
            operation: 'UPDATE',
            event_type: 'po.submitted',
            after_data: result.po,
            metadata: { lifecycle_event: 'po.submitted' },
          },
          result,
        )
      }
      case 'po_decide': {
        requireScope('po:decide')
        const result = await po.decideWithEvent({
          workspace_id: requireWorkspaceId(),
          po_id: String(a.po_id),
          decision: a.decision,
          decision_note: a.decision_note,
        })
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'internal_purchase_orders',
            entity_id: result.po.id,
            status: result.po.status,
            is_draft: false,
            operation: 'UPDATE',
            event_type: result.lifecycle_event || 'po.decided',
            after_data: result.po,
            metadata: { lifecycle_event: result.lifecycle_event },
          },
          result,
        )
      }
      case 'po_get': {
        requireScope('intel:read')
        const pack = await po.getPo(requireWorkspaceId(), String(a.po_id))
        if (!pack) throw new Error('PO not found')
        return jsonResult(pack)
      }
      case 'po_list': {
        requireScope('intel:read')
        const list = await po.listPos(requireWorkspaceId(), {
          status: a.status,
          limit: a.limit,
        })
        return jsonResult({ purchase_orders: list })
      }
      case 'po_export': {
        requireScope('intel:read')
        const pack = await po.getPo(requireWorkspaceId(), String(a.po_id))
        if (!pack) throw new Error('PO not found')
        return jsonResult(po.exportPo(pack.po, pack.lines))
      }
      case 'store_ops_list_requests': {
        requireScope('store_ops:read')
        return jsonResult(await storeOps.listOpenRequests({
          status: a.status,
          limit: a.limit,
        }))
      }
      case 'store_ops_list_waves': {
        requireScope('store_ops:read')
        return jsonResult(await storeOps.listWaves({ limit: a.limit }))
      }
      case 'store_ops_recommend': {
        requireScope('store_ops:read')
        return jsonResult(await storeOps.recommendDecision(String(a.request_id)))
      }
      case 'projection_create': {
        requireScope('projection:run')
        const run = await projection.create({
          workspace_id: requireWorkspaceId(),
          title: a.title,
          assumptions: {
            unit_cost: a.unit_cost,
            retail_price: a.retail_price,
            units_per_week_low: a.units_per_week_low,
            units_per_week_high: a.units_per_week_high,
            horizon_weeks: a.horizon_weeks,
            payment_fees_pct: a.payment_fees_pct,
            shipping_per_unit: a.shipping_per_unit,
            returns_pct: a.returns_pct,
            quantity_on_order: a.quantity_on_order,
            currency: a.currency,
          },
          force_offline: a.force_offline === true,
        })
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'projection_runs',
            entity_id: run.id,
            status: run.status || 'completed',
            is_draft: false,
            operation: 'INSERT',
            after_data: run,
          },
          { projection: run },
        )
      }
      case 'projection_from_po': {
        requireScope('projection:run')
        const run = await projection.fromPo(requireWorkspaceId(), String(a.po_id), a)
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'projection_runs',
            entity_id: run.id,
            status: run.status || 'completed',
            is_draft: false,
            operation: 'INSERT',
            after_data: run,
            metadata: { po_id: a.po_id },
          },
          { projection: run },
        )
      }
      case 'projection_from_study': {
        requireScope('projection:run')
        const run = await projection.fromStudy(
          requireWorkspaceId(),
          String(a.study_session_id),
          a,
        )
        return withMcpAudit(
          name,
          requestId,
          {
            object_type: 'projection_runs',
            entity_id: run.id,
            status: run.status || 'completed',
            is_draft: false,
            operation: 'INSERT',
            after_data: run,
            metadata: { study_session_id: a.study_session_id },
          },
          { projection: run },
        )
      }
      case 'projection_get': {
        requireScope('intel:read')
        const run = await projection.get(requireWorkspaceId(), String(a.projection_id))
        if (!run) throw new Error('Projection not found')
        return jsonResult({ projection: run })
      }
      case 'projection_list': {
        requireScope('intel:read')
        const runs = await projection.list(requireWorkspaceId(), {
          source_type: a.source_type,
          limit: a.limit,
        })
        return jsonResult({ projections: runs })
      }
      case 'projection_export': {
        requireScope('intel:read')
        const run = await projection.get(requireWorkspaceId(), String(a.projection_id))
        if (!run) throw new Error('Projection not found')
        return jsonResult(projection.exportRun(run))
      }
      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (err) {
    return errorResult(err)
  }
}
