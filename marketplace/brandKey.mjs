/**
 * Brand universe key helpers — weekly marketplace brand radar.
 * Shared by import script, materialize (PR-2), and tests.
 */

/**
 * Deterministic brand_key for universe unique constraint + metrics dimension_key.
 * @param {string} name
 * @returns {string}
 */
export function brandKeyFromDisplayName(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    // strip apostrophes / right-single-quote (d'Alba, I'm from)
    .replace(/['\u2019]/g, '')
    // strip stylized colons (Su:m37 → sum37) before separator collapse
    .replace(/:/g, '')
    // non-alphanumeric → hyphen (periods, spaces, slashes, ampersands)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Parse Yes/No/blank CSV flag.
 * blank → null (unknown); Yes/Y/true → true; No/N/false → false
 * @param {string | null | undefined} raw
 * @returns {boolean | null}
 */
export function parseYesNoNull(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  const lower = s.toLowerCase()
  if (lower === 'yes' || lower === 'y' || lower === 'true' || lower === '1') return true
  if (lower === 'no' || lower === 'n' || lower === 'false' || lower === '0') return false
  return null
}

/**
 * Category parse rules (sample-brands.csv):
 * - "Hair / Body" stays one label (slash with spaces is part of the name)
 * - "Skincare/ Cosmetics" or "Skincare/Cosmetics" (no spaces around /) splits dual tags
 * - otherwise single category trimmed
 * @param {string | null | undefined} raw
 * @returns {string[]}
 */
export function parseCategories(raw) {
  if (raw == null) return []
  const s = String(raw).trim()
  if (!s) return []

  // Dual-category only when slash has no spaces on both sides of a clean split
  // e.g. "Skincare/ Cosmetics" or "Skincare/Cosmetics"
  // "Hair / Body" has spaces around / → keep as one
  if (/\//.test(s) && !/\s\/\s/.test(s)) {
    return s
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean)
  }
  return [s]
}

/**
 * Seed priority: raise if Official interest OR Shopee Mall interest.
 * Official=null + Mall=true → 120
 * @param {boolean | null | undefined} officialInterest
 * @param {boolean | null | undefined} shopeeMallInterest
 * @returns {number}
 */
export function brandUniversePriority(officialInterest, shopeeMallInterest) {
  if (officialInterest === true || shopeeMallInterest === true) return 120
  return 80
}

/**
 * Merge categories uniquely (preserve order of first appearance).
 * @param {string[]} a
 * @param {string[]} b
 * @returns {string[]}
 */
export function mergeCategories(a, b) {
  const out = []
  const seen = new Set()
  for (const c of [...(a || []), ...(b || [])]) {
    const t = String(c || '').trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/**
 * Parse sample-brands.csv text into brand universe row drafts (no workspace).
 * Handles leading empty column, blank Official → null, House of Hur dual-category merge.
 *
 * @param {string} csvText
 * @param {{ source?: string }} [opts]
 * @returns {{
 *   rows: Array<{
 *     brand_key: string
 *     display_name: string
 *     categories: string[]
 *     origin_country: string | null
 *     official_interest: boolean | null
 *     shopee_mall_interest: boolean
 *     iherb_interest: boolean
 *     followers_note: string | null
 *     priority: number
 *     source: string
 *     csv_nos: number[]
 *   }>
 *   skipped: Array<{ reason: string, line?: number, raw?: string }>
 *   stats: { input_data_rows: number, unique_brands: number }
 * }}
 */
export function parseSampleBrandsCsv(csvText, opts = {}) {
  const source = opts.source || 'sample-brands.csv'
  const lines = String(csvText || '').split(/\r?\n/)
  const skipped = []
  /** @type {Map<string, any>} */
  const byKey = new Map()
  let inputDataRows = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !line.trim()) continue

    // Skip header-ish rows
    if (i === 0 || /brand/i.test(line) && /category/i.test(line)) {
      if (/brand/i.test(line) && /category/i.test(line)) continue
    }

    const cols = splitCsvLine(line)
    // Leading empty columns: ,No.,Brand,... or empty first cells
    let start = 0
    while (start < cols.length && !String(cols[start] || '').trim()) start++

    // Expect: No., Brand, Category, Country, Official, ShopeeMall, iHerb, Followers?
    const noRaw = cols[start]
    const brand = cols[start + 1]
    const category = cols[start + 2]
    const country = cols[start + 3]
    const official = cols[start + 4]
    const mall = cols[start + 5]
    const iherb = cols[start + 6]
    const followers = cols[start + 7]

    if (!brand || !String(brand).trim()) {
      skipped.push({ reason: 'empty_brand', line: i + 1, raw: line.slice(0, 80) })
      continue
    }

    // Skip pure empty header garbage like ",,,,,,,"
    if (!String(noRaw || '').trim() && !String(category || '').trim()) {
      skipped.push({ reason: 'empty_row', line: i + 1 })
      continue
    }

    inputDataRows++
    const display_name = String(brand).trim()
    const brand_key = brandKeyFromDisplayName(display_name)
    if (!brand_key) {
      skipped.push({ reason: 'empty_brand_key', line: i + 1, raw: display_name })
      continue
    }

    const categories = parseCategories(category)
    const official_interest = parseYesNoNull(official)
    const shopee_mall_interest = parseYesNoNull(mall) === true
    const iherb_interest = parseYesNoNull(iherb) === true
    const followers_note = followers && String(followers).trim() ? String(followers).trim() : null
    const origin_country = country && String(country).trim() ? String(country).trim() : null
    const csvNo = Number(String(noRaw || '').trim())
    const priority = brandUniversePriority(official_interest, shopee_mall_interest)

    const existing = byKey.get(brand_key)
    if (existing) {
      existing.categories = mergeCategories(existing.categories, categories)
      // Prefer known booleans over null when merging
      if (existing.official_interest == null && official_interest != null) {
        existing.official_interest = official_interest
      } else if (official_interest === true) {
        existing.official_interest = true
      }
      existing.shopee_mall_interest = existing.shopee_mall_interest || shopee_mall_interest
      existing.iherb_interest = existing.iherb_interest || iherb_interest
      if (!existing.followers_note && followers_note) existing.followers_note = followers_note
      if (!existing.origin_country && origin_country) existing.origin_country = origin_country
      existing.priority = brandUniversePriority(
        existing.official_interest,
        existing.shopee_mall_interest,
      )
      if (Number.isFinite(csvNo)) existing.csv_nos.push(csvNo)
      continue
    }

    byKey.set(brand_key, {
      brand_key,
      display_name,
      categories,
      origin_country,
      official_interest,
      shopee_mall_interest,
      iherb_interest,
      followers_note,
      priority,
      source,
      csv_nos: Number.isFinite(csvNo) ? [csvNo] : [],
    })
  }

  const rows = [...byKey.values()].sort((a, b) => a.display_name.localeCompare(b.display_name))
  return {
    rows,
    skipped,
    stats: { input_data_rows: inputDataRows, unique_brands: rows.length },
  }
}

/**
 * Minimal CSV line split (handles quoted fields).
 * @param {string} line
 * @returns {string[]}
 */
function splitCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

/** Deterministic pilot allowlist (Appendix A). */
export const PILOT_BRAND_KEYS = Object.freeze([
  'anua',
  'cosrx',
  'beauty-of-joseon',
  'numbuzin',
  'medicube',
  'celimax',
  'axis-y',
  'biodance',
  'mixsoon',
  'dr-althea',
  'haruharu-wonder',
  'mediheal',
])
