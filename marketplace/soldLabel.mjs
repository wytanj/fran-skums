/**
 * Parse Shopee-style sold labels into a numeric lower bound.
 * "4.5k+" → 4500, "1.2M" → 1200000, "123 sold" → 123
 */

/**
 * @param {string | null | undefined} label
 * @returns {{ label: string | null, lower_bound: number | null, is_bucket: boolean }}
 */
export function parseSoldLabel(label) {
  if (label == null) {
    return { label: null, lower_bound: null, is_bucket: false }
  }
  const raw = String(label).trim()
  if (!raw) {
    return { label: null, lower_bound: null, is_bucket: false }
  }

  const cleaned = raw.replace(/,/g, '').replace(/\s*sold\s*/gi, ' ').trim()
  const isBucket = /\+|plus|over|more than/i.test(cleaned) || /[kKmM]\+?$/.test(cleaned.replace(/\s/g, ''))

  const mMatch = cleaned.match(/([0-9]+(?:\.[0-9]+)?)\s*[mM]\+?/)
  if (mMatch) {
    return {
      label: raw,
      lower_bound: Math.round(parseFloat(mMatch[1]) * 1_000_000),
      is_bucket: true,
    }
  }

  const kMatch = cleaned.match(/([0-9]+(?:\.[0-9]+)?)\s*[kK]\+?/)
  if (kMatch) {
    return {
      label: raw,
      lower_bound: Math.round(parseFloat(kMatch[1]) * 1_000),
      is_bucket: true,
    }
  }

  const numMatch = cleaned.match(/([0-9]+(?:\.[0-9]+)?)/)
  if (numMatch) {
    const n = Math.round(parseFloat(numMatch[1]))
    return {
      label: raw,
      lower_bound: Number.isFinite(n) ? n : null,
      is_bucket: isBucket,
    }
  }

  return { label: raw, lower_bound: null, is_bucket: false }
}
