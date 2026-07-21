/**
 * MH-7 — Attribute a product title to a brand_key from an allowlist.
 *
 * Used for multi-brand distributor Malls where one shop hosts many brands.
 * Prefer longer / more specific tokens so "Beauty of Joseon" beats "Beauty".
 */

function compact(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function normalizeSpace(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Build match candidates for one brand universe row.
 * @param {{ brand_key: string, display_name?: string, aliases?: string[] }} brand
 * @returns {{ brand_key: string, display_name: string, needles: string[] }}
 */
export function buildBrandMatchProfile(brand) {
  const brand_key = String(brand.brand_key || '')
    .toLowerCase()
    .trim()
  const display_name = String(brand.display_name || brand_key).trim()
  const needles = new Set()

  if (display_name) {
    needles.add(normalizeSpace(display_name))
    needles.add(compact(display_name))
  }
  if (brand_key) {
    needles.add(brand_key.replace(/-/g, ' '))
    needles.add(compact(brand_key))
  }
  for (const a of brand.aliases || []) {
    if (!a) continue
    needles.add(normalizeSpace(a))
    needles.add(compact(a))
  }

  // Drop tiny tokens (noise)
  const list = [...needles].filter((n) => n && n.length >= 3)
  return { brand_key, display_name, needles: list }
}

/**
 * @param {string} title
 * @param {Array<{ brand_key: string, display_name?: string, aliases?: string[] }>} brands
 * @returns {{
 *   brand_key: string | null
 *   display_name: string | null
 *   method: 'title_match' | 'none'
 *   score: number
 *   matched_needle: string | null
 * }}
 */
export function attributeBrandFromTitle(title, brands) {
  const raw = String(title || '')
  const space = normalizeSpace(raw)
  const compactTitle = compact(raw)

  if (!space || !Array.isArray(brands) || !brands.length) {
    return {
      brand_key: null,
      display_name: null,
      method: 'none',
      score: 0,
      matched_needle: null,
    }
  }

  let best = null
  for (const b of brands) {
    const profile = buildBrandMatchProfile(b)
    for (const needle of profile.needles) {
      let hit = false
      let score = 0
      if (needle.includes(' ') || /[a-z]/.test(needle)) {
        // spaced form: word-boundary-ish
        if (space.includes(needle)) {
          hit = true
          score = needle.length * 2 + (space.startsWith(needle) ? 5 : 0)
        }
      }
      if (!hit && compactTitle.includes(compact(needle))) {
        hit = true
        score = Math.max(score, compact(needle).length)
      }
      if (!hit) continue
      // Prefer longer needles
      if (!best || score > best.score) {
        best = {
          brand_key: profile.brand_key,
          display_name: profile.display_name,
          method: 'title_match',
          score,
          matched_needle: needle,
        }
      }
    }
  }

  return (
    best || {
      brand_key: null,
      display_name: null,
      method: 'none',
      score: 0,
      matched_needle: null,
    }
  )
}

/**
 * Apply attribution to a list of product-like rows ({ name|title }).
 * @param {Array<object>} products
 * @param {Array<object>} brands
 * @param {{ titleKey?: string }} [opts]
 */
export function attributeProductsToBrands(products, brands, opts = {}) {
  const titleKey = opts.titleKey || 'name'
  return (products || []).map((p) => {
    const title = p[titleKey] || p.title || p.name || ''
    const attr = attributeBrandFromTitle(title, brands)
    return {
      ...p,
      brand_key: attr.brand_key,
      brand_attribution: attr,
    }
  })
}

/**
 * Normalize allowlist brand keys.
 * @param {unknown} keys
 * @returns {string[]}
 */
export function normalizeBrandKeyList(keys) {
  if (!Array.isArray(keys)) return []
  const out = []
  const seen = new Set()
  for (const k of keys) {
    const key = String(k || '')
      .toLowerCase()
      .trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}
