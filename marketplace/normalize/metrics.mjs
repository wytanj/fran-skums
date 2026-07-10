/**
 * Pure BI metrics from snapshot observation rows.
 * No I/O — unit-testable.
 */

const TRUSTED = new Set(['mall', 'preferred_plus', 'preferred', 'official_brand'])

/**
 * @param {Array<Record<string, any>>} rows
 *   Each row: seller_type, price, sold_count_lower_bound, rank_position, shop_id, item_id, title?
 * @param {{ query?: string, marketplace?: string, country?: string }} [meta]
 */
export function computeSellerMixMetrics(rows, meta = {}) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : []
  const n = list.length

  /** @type {Record<string, number>} */
  const byType = {
    mall: 0,
    preferred_plus: 0,
    preferred: 0,
    official_brand: 0,
    normal: 0,
    unknown: 0,
  }

  const prices = []
  const soldBounds = []
  let trusted = 0
  let overseas = 0
  let preorder = 0

  for (const r of list) {
    const t = String(r.seller_type || 'unknown')
    if (byType[t] != null) byType[t]++
    else byType.unknown++

    if (TRUSTED.has(t)) trusted++

    if (r.price != null && Number.isFinite(Number(r.price))) {
      prices.push(Number(r.price))
    }
    if (r.sold_count_lower_bound != null && Number.isFinite(Number(r.sold_count_lower_bound))) {
      soldBounds.push(Number(r.sold_count_lower_bound))
    }

    const signals = r.signals && typeof r.signals === 'object' ? r.signals : {}
    if (signals.ships_from_overseas) overseas++
    if (signals.preorder) preorder++
  }

  const pct = (count) => (n === 0 ? 0 : Math.round((count / n) * 1000) / 10)

  const mallRefPrices = list
    .filter((r) => r.seller_type === 'mall' || r.seller_type === 'official_brand')
    .map((r) => Number(r.price))
    .filter((p) => Number.isFinite(p) && p > 0)

  const mallPriceP50 = percentile(mallRefPrices, 0.5)
  const undercutters = []

  if (mallPriceP50 != null) {
    for (const r of list) {
      const p = Number(r.price)
      if (!Number.isFinite(p) || p <= 0) continue
      if (r.seller_type === 'mall' || r.seller_type === 'official_brand') continue
      const undercutPct = Math.round(((mallPriceP50 - p) / mallPriceP50) * 1000) / 10
      if (undercutPct > 0) {
        undercutters.push({
          shop_id: r.shop_id,
          item_id: r.item_id,
          title: r.title || null,
          seller_type: r.seller_type || 'unknown',
          price: p,
          undercut_vs_mall_p50_pct: undercutPct,
        })
      }
    }
    undercutters.sort((a, b) => b.undercut_vs_mall_p50_pct - a.undercut_vs_mall_p50_pct)
  }

  return {
    query: meta.query || null,
    marketplace: meta.marketplace || 'shopee',
    country: meta.country || 'sg',
    listing_count: n,
    seller_mix: {
      counts: byType,
      pct: {
        mall: pct(byType.mall),
        preferred_plus: pct(byType.preferred_plus),
        preferred: pct(byType.preferred),
        official_brand: pct(byType.official_brand),
        normal: pct(byType.normal),
        unknown: pct(byType.unknown),
      },
      trusted_share_pct: pct(trusted),
      official_store_share_pct: pct(byType.mall + byType.official_brand),
    },
    price: {
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
      p50: percentile(prices, 0.5),
      p25: percentile(prices, 0.25),
      p75: percentile(prices, 0.75),
      mall_p50: mallPriceP50,
    },
    sold: {
      sum_lower_bound: soldBounds.reduce((a, b) => a + b, 0),
      p50_lower_bound: percentile(soldBounds, 0.5),
      max_lower_bound: soldBounds.length ? Math.max(...soldBounds) : null,
    },
    signals: {
      overseas_share_pct: pct(overseas),
      preorder_share_pct: pct(preorder),
      overseas_count: overseas,
      preorder_count: preorder,
    },
    reseller_pressure: {
      undercut_count: undercutters.length,
      undercut_share_pct: pct(undercutters.length),
      top_undercutters: undercutters.slice(0, 10),
    },
  }
}

/**
 * Flatten latest SERP-style rows into sheet-ready export objects.
 * @param {Array<Record<string, any>>} rows
 *   Prefer joined shape: snapshot fields + listing nested or flat shop_id/item_id/title
 */
export function buildExportTable(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  return list.map((r, i) => {
    const listing = r.marketplace_listings || r.listing || {}
    const shop_id = r.shop_id || listing.shop_id || null
    const item_id = r.item_id || listing.item_id || null
    const title = r.title || listing.title || null
    const shop_name = r.shop_name || listing.shop_name || null
    const listing_url = r.listing_url || listing.listing_url || null
    const seller_type = r.seller_type || listing.seller_type || 'unknown'
    const signals = r.signals && typeof r.signals === 'object' ? r.signals : {}

    return {
      rank: r.rank_position ?? i + 1,
      marketplace: opts.marketplace || r.marketplace || 'shopee',
      country: opts.country || r.country || 'sg',
      search_query: r.search_query || opts.query || null,
      shop_id,
      item_id,
      title,
      shop_name,
      seller_type,
      price: r.price ?? null,
      original_price: r.original_price ?? null,
      currency: r.currency || 'SGD',
      rating: r.rating ?? null,
      review_count: r.review_count ?? null,
      sold_label: r.sold_label ?? null,
      sold_count_lower_bound: r.sold_count_lower_bound ?? null,
      ships_from_overseas: Boolean(signals.ships_from_overseas),
      preorder: Boolean(signals.preorder),
      listing_url,
      crawled_at: r.crawled_at || null,
      snapshot_id: r.id || null,
      listing_row_id: r.listing_id || listing.id || null,
    }
  })
}

/**
 * Convert export rows to CSV string.
 * @param {Array<Record<string, any>>} rows
 */
export function exportRowsToCsv(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return ''

  const keys = Object.keys(list[0])
  const escape = (v) => {
    if (v == null) return ''
    const s = String(v)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }

  const lines = [keys.join(',')]
  for (const row of list) {
    lines.push(keys.map((k) => escape(row[k])).join(','))
  }
  return lines.join('\n')
}

/**
 * @param {number[]} sortedOrNot
 * @param {number} p 0..1
 */
export function percentile(values, p) {
  const arr = (values || []).filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b)
  if (!arr.length) return null
  if (arr.length === 1) return arr[0]
  const idx = (arr.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return arr[lo]
  const w = idx - lo
  return Math.round((arr[lo] * (1 - w) + arr[hi] * w) * 100) / 100
}
