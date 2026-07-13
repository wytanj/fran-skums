/**
 * Pure payload builders for pipeline execute adapters (no I/O).
 */

/**
 * @param {Record<string, any>} candidate
 * @param {Record<string, any>} [context]
 */
export function buildWatchlistSeedPayload(candidate, context = {}) {
  const p = candidate.payload && typeof candidate.payload === 'object' ? candidate.payload : {}
  const target = String(p.target || p.query || context.query || candidate.title || '').trim()
  if (!target) {
    throw new Error('watchlist_seed requires payload.target or query')
  }

  return {
    marketplace: p.marketplace || context.marketplace || 'shopee',
    country: String(p.country || context.country || 'sg').toLowerCase(),
    mode: p.mode || 'keyword',
    target,
    enabled: p.enabled !== false,
    schedule_kind: p.schedule_kind || 'daily',
    preferred_hour: Number(p.preferred_hour ?? 2),
    weekly_day: p.weekly_day != null ? Number(p.weekly_day) : 1,
    max_pages: Number(p.max_pages ?? 2),
    max_listings: Number(p.max_listings ?? 40),
    detail_top_n: Number(p.detail_top_n ?? 15),
    priority: Number(p.priority ?? 100),
    collector_id: p.collector_id || 'mock',
    metadata: {
      source: 'pipeline_execute',
      pipeline_candidate_id: candidate.id || null,
      study_session_id: candidate.source_study_id || null,
      ...(p.metadata && typeof p.metadata === 'object' ? p.metadata : {}),
    },
  }
}

/**
 * @param {Record<string, any>} candidate
 * @param {Record<string, any>} [context]
 */
export function buildCatalogProductPayload(candidate, context = {}) {
  const p = candidate.payload && typeof candidate.payload === 'object' ? candidate.payload : {}
  const title = String(p.title || candidate.title || context.hypothesis || '').trim()
  if (!title) throw new Error('catalog_product requires title')

  // M5: pipeline execute always creates draft / POS-off; promote via UI "Activate for POS"
  const product_data = {
    source: 'pipeline_execute',
    pipeline_candidate_id: candidate.id || null,
    study_session_id: candidate.source_study_id || null,
    marketplace: p.marketplace || context.marketplace || 'shopee',
    country: p.country || context.country || 'sg',
    listing_url: p.listing_url || null,
    shop_id: p.shop_id || null,
    item_id: p.item_id || null,
    evidence_refs: candidate.evidence_refs || [],
    ...(p.product_data && typeof p.product_data === 'object' ? p.product_data : {}),
    pos_enabled: false,
    sellable_in_pos: false,
  }

  return {
    title,
    status: 'draft',
    description: p.description || candidate.summary || null,
    brand_name: p.brand_name || null,
    retail_price: p.retail_price ?? p.price ?? null,
    currency: p.currency || 'SGD',
    tags: Array.isArray(p.tags) ? p.tags : ['marketplace-study', 'pipeline'],
    product_data,
  }
}

/**
 * Validate transition for decide.
 * @param {string} from
 * @param {string} to
 */
export function canDecide(from, to) {
  if (from !== 'proposed' && from !== 'deferred') return false
  return ['accepted', 'rejected', 'deferred'].includes(to)
}

/**
 * @param {string} status
 */
export function canExecute(status) {
  return status === 'accepted'
}
