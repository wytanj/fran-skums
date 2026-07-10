/**
 * Fran MCP tool definitions + handlers (BI + study + pipeline).
 */
import {
  errorResult,
  jsonResult,
  requireScope,
  requireWorkspaceId,
} from './context.mjs'
import * as bi from './lib/bi.mjs'
import * as pipeline from './lib/pipeline.mjs'
import * as po from './lib/po.mjs'
import * as projection from './lib/projection.mjs'
import * as study from './lib/study.mjs'

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
      'Execute an accepted candidate. Phase 3/4: watchlist_seed → crawl seed; catalog_product → draft product.',
    inputSchema: {
      type: 'object',
      properties: { candidate_id: { type: 'string' } },
      required: ['candidate_id'],
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
          description: 'mock | shopee_puppeteer | cloudflare_browser_run',
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
    name: 'po_create_draft',
    description: 'Create an internal purchase order draft (decision-layer, not inventory PO).',
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
    description: 'Submit draft PO for approval (draft → pending_approval).',
    inputSchema: {
      type: 'object',
      properties: { po_id: { type: 'string' } },
      required: ['po_id'],
    },
  },
  {
    name: 'po_decide',
    description: 'Approve or reject a pending internal PO.',
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
]

/**
 * @param {string} name
 * @param {Record<string, unknown>} args
 */
export async function handleTool(name, args = {}) {
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
        return jsonResult({ session })
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
        return jsonResult(result)
      }
      case 'study_match_catalog': {
        requireScope('study:write')
        const result = await study.runStudyMatchCatalog(
          String(a.session_id),
          requireWorkspaceId(),
          { force_offline: a.force_offline === true },
        )
        return jsonResult(result)
      }
      case 'study_propose': {
        requireScope('pipeline:propose')
        const result = await pipeline.proposeFromStudyBrief({
          workspace_id: requireWorkspaceId(),
          study_session_id: String(a.session_id),
          kinds: Array.isArray(a.kinds) ? a.kinds.map(String) : undefined,
        })
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
        return jsonResult(result)
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
        return jsonResult({ candidate })
      }
      case 'pipeline_execute': {
        requireScope('pipeline:execute')
        const candidate = await pipeline.executePipelineCandidate({
          workspace_id: requireWorkspaceId(),
          candidate_id: String(a.candidate_id),
        })
        return jsonResult({ candidate })
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
        return jsonResult({ seed })
      }
      case 'bi_set_cadence': {
        requireScope('intel:write')
        const seed = await bi.setSeedCadence(requireWorkspaceId(), String(a.seed_id), a)
        return jsonResult({ seed })
      }
      case 'bi_run_seed_now': {
        requireScope('intel:write')
        const job = await bi.runSeedNow(requireWorkspaceId(), String(a.seed_id))
        return jsonResult({
          job,
          note: 'Job enqueued as pending. Run POST /api/internal/marketplace/process-jobs (or worker) to collect.',
        })
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
      case 'po_create_draft': {
        requireScope('po:draft')
        const result = await po.createDraft({
          workspace_id: requireWorkspaceId(),
          ...a,
        })
        return jsonResult(result)
      }
      case 'po_update_draft': {
        requireScope('po:draft')
        const result = await po.updateDraft(
          requireWorkspaceId(),
          String(a.po_id),
          a,
        )
        return jsonResult(result)
      }
      case 'po_add_lines': {
        requireScope('po:draft')
        const result = await po.addLines(
          requireWorkspaceId(),
          String(a.po_id),
          a.lines || [],
        )
        return jsonResult(result)
      }
      case 'po_suggest_qty': {
        requireScope('intel:read')
        return jsonResult(po.suggestQty(a))
      }
      case 'po_submit': {
        requireScope('po:submit')
        const result = await po.submit(requireWorkspaceId(), String(a.po_id))
        return jsonResult(result)
      }
      case 'po_decide': {
        requireScope('po:decide')
        const result = await po.decide({
          workspace_id: requireWorkspaceId(),
          po_id: String(a.po_id),
          decision: a.decision,
          decision_note: a.decision_note,
        })
        return jsonResult(result)
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
        return jsonResult({ projection: run })
      }
      case 'projection_from_po': {
        requireScope('projection:run')
        const run = await projection.fromPo(requireWorkspaceId(), String(a.po_id), a)
        return jsonResult({ projection: run })
      }
      case 'projection_from_study': {
        requireScope('projection:run')
        const run = await projection.fromStudy(
          requireWorkspaceId(),
          String(a.study_session_id),
          a,
        )
        return jsonResult({ projection: run })
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
