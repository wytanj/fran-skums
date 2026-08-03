/**
 * Parse Shopee-style sold labels into a numeric lower bound.
 * "4.5k+" → 4500, "1.2M" → 1200000, "123 sold" → 123
 */

/**
 * Upper bound for a credible per-listing lifetime sold count.
 *
 * Exists because the grid scraper reads the whole product card, and some
 * titles contain their own marketing copy — a real example that reached the
 * warehouse was "Shopee x BANILA CO 7.7 Brand Box 100M Sold Cleansing Balm",
 * parsed as 100,000,000 and enough on its own to make that brand the top
 * seller in every rollup.
 *
 * Generous on purpose: this is defence-in-depth behind the extraction fix, not
 * the primary guard. Only absurdities should trip it.
 */
export const MAX_PLAUSIBLE_SOLD = 10_000_000

/**
 * @param {number | null | undefined} n
 * @returns {boolean} false when the figure is too large to be a real listing
 */
export function isPlausibleSoldCount(n) {
  if (n == null) return true
  const v = Number(n)
  if (!Number.isFinite(v)) return false
  return v >= 0 && v <= MAX_PLAUSIBLE_SOLD
}

/**
 * Detect period implied by the label text.
 * Shopee keyword SERP under sortBy=sales often shows "517 Sold/Month".
 * Mall shop grids usually show lifetime "1.2k sold" (no /month).
 * @param {string} raw
 * @returns {'month' | 'lifetime' | null}
 */
export function detectSoldPeriod(raw) {
  const s = String(raw || '')
  if (!s.trim()) return null
  if (/sold\s*\/\s*month|monthly\s*sales?|\/\s*mo\b/i.test(s)) return 'month'
  if (/\bsold\b/i.test(s)) return 'lifetime'
  return null
}

/**
 * @param {string | null | undefined} label
 * @returns {{
 *   label: string | null,
 *   lower_bound: number | null,
 *   is_bucket: boolean,
 *   period: 'month' | 'lifetime' | null
 * }}
 */
export function parseSoldLabel(label) {
  if (label == null) {
    return { label: null, lower_bound: null, is_bucket: false, period: null }
  }
  const raw = String(label).trim()
  if (!raw) {
    return { label: null, lower_bound: null, is_bucket: false, period: null }
  }

  const period = detectSoldPeriod(raw)
  // Keep "Sold/Month" parseable: strip sold(/month) so k/m/num matchers see the figure.
  const cleaned = raw
    .replace(/,/g, '')
    .replace(/\s*sold\s*(?:\/\s*month)?/gi, ' ')
    .replace(/\s*monthly\s*sales?/gi, ' ')
    .trim()
  const isBucket = /\+|plus|over|more than/i.test(cleaned) || /[kKmM]\+?$/.test(cleaned.replace(/\s/g, ''))

  const mMatch = cleaned.match(/([0-9]+(?:\.[0-9]+)?)\s*[mM]\+?/)
  if (mMatch) {
    return {
      label: raw,
      lower_bound: Math.round(parseFloat(mMatch[1]) * 1_000_000),
      is_bucket: true,
      period,
    }
  }

  const kMatch = cleaned.match(/([0-9]+(?:\.[0-9]+)?)\s*[kK]\+?/)
  if (kMatch) {
    return {
      label: raw,
      lower_bound: Math.round(parseFloat(kMatch[1]) * 1_000),
      is_bucket: true,
      period,
    }
  }

  const numMatch = cleaned.match(/([0-9]+(?:\.[0-9]+)?)/)
  if (numMatch) {
    const n = Math.round(parseFloat(numMatch[1]))
    return {
      label: raw,
      lower_bound: Number.isFinite(n) ? n : null,
      is_bucket: isBucket,
      period,
    }
  }

  return { label: raw, lower_bound: null, is_bucket: false, period }
}
