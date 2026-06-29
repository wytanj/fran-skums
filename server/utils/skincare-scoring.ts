import { getServiceClient } from './supabase'

// ── Types ───────────────────────────────────────────────────

interface IngredientSafetyRow {
  inci_name: string
  ewg_score: number | null
  tier: string | null
  function: string | null
  concerns_addressed: string[]
  trend: string | null
  ips_penalty: number
  ips_bonus: number
  is_hwahae_blacklisted: boolean
}

interface SkincareConcernRow {
  id: string
  label: string
  key_ingredients: string[]
}

export interface SkincareScores {
  ips_score: number
  skin_type_fit: Record<string, number>
  concern_tags: string[]
  top_tier_ingredient: string | null
  ingredient_trend_signal: string | null
  conflict_flags: Array<{ family: string; ingredients: string[] }>
}

// ── Ingredient Safety Cache ─────────────────────────────────

let ingredientCache: Map<string, IngredientSafetyRow> | null = null
let concernCache: SkincareConcernRow[] | null = null

async function getIngredientCache(): Promise<Map<string, IngredientSafetyRow>> {
  if (ingredientCache) return ingredientCache

  const db = getServiceClient()
  const { data } = await db.from('ingredient_safety').select('*')

  ingredientCache = new Map()
  for (const row of data ?? []) {
    // Store both exact name and lowercase for flexible matching
    ingredientCache.set(row.inci_name.toLowerCase(), row)
  }

  return ingredientCache
}

async function getConcernCache(): Promise<SkincareConcernRow[]> {
  if (concernCache) return concernCache

  const db = getServiceClient()
  const { data } = await db.from('skincare_concerns').select('*').order('sort_order')

  concernCache = data ?? []
  return concernCache
}

// ── IPS Calculation ─────────────────────────────────────────

/**
 * Compute Ingredient Profile Score (0–100).
 * Based on the framework in cheerful-soaring-puffin.md:
 *   IPS = 100 - sum(penalties) + sum(bonuses)
 *   - Each ingredient with EWG > 5: -5 penalty
 *   - Each Hwahae blacklisted ingredient: -10 penalty
 *   - Each proven active (tier1-3): +3 bonus
 *   - Custom IPS penalties/bonuses from ingredient_safety table
 */
function computeIPS(
  ingredients: string[],
  safetyMap: Map<string, IngredientSafetyRow>
): { score: number; details: { bonuses: number; penalties: number; matched: number } } {
  let bonuses = 0
  let penalties = 0
  let matched = 0

  for (const ingredient of ingredients) {
    const key = ingredient.toLowerCase().trim()
    const safety = safetyMap.get(key)

    if (!safety) continue
    matched++

    // Custom penalties (from ingredient_safety table)
    if (safety.ips_penalty < 0) {
      penalties += Math.abs(safety.ips_penalty)
    }

    // Custom bonuses
    if (safety.ips_bonus > 0) {
      bonuses += safety.ips_bonus
    }

    // EWG > 5 penalty
    if (safety.ewg_score && safety.ewg_score > 5) {
      penalties += 5
    }

    // Hwahae blacklist penalty
    if (safety.is_hwahae_blacklisted) {
      penalties += 10
    }
  }

  // Deduplicate — don't double-count EWG + hwahae + custom for same ingredient
  // The custom penalty already accounts for severity, so just use max(custom, generic)
  // For simplicity, we sum all — the seed data is calibrated accordingly

  const score = Math.max(0, Math.min(100, 100 - penalties + bonuses))

  return { score, details: { bonuses, penalties, matched } }
}

// ── Skin Type Fit ───────────────────────────────────────────

/**
 * Estimate skin type compatibility from ingredients.
 * Returns 0.0–1.0 fit for each skin type.
 */
function computeSkinTypeFit(
  ingredients: string[],
  safetyMap: Map<string, IngredientSafetyRow>
): Record<string, number> {
  // Ingredient → skin type affinity mapping
  const SKIN_TYPE_SIGNALS: Record<string, Record<string, number>> = {
    // Hydrating/barrier = good for dry, sensitive
    'hyaluronic acid': { dry: 0.9, oily: 0.3, combination: 0.7, sensitive: 0.7, acne: 0.2 },
    'sodium hyaluronate': { dry: 0.9, oily: 0.3, combination: 0.7, sensitive: 0.7, acne: 0.2 },
    'glycerin': { dry: 0.7, oily: 0.4, combination: 0.6, sensitive: 0.6, acne: 0.3 },
    'ceramide np': { dry: 0.9, oily: 0.3, combination: 0.6, sensitive: 0.9, acne: 0.3 },
    'ceramide ap': { dry: 0.9, oily: 0.3, combination: 0.6, sensitive: 0.9, acne: 0.3 },
    'squalane': { dry: 0.8, oily: 0.2, combination: 0.5, sensitive: 0.7, acne: 0.1 },
    'petrolatum': { dry: 0.9, oily: 0.1, combination: 0.3, sensitive: 0.5, acne: 0.0 },
    'shea butter': { dry: 0.8, oily: 0.1, combination: 0.3, sensitive: 0.5, acne: 0.0 },
    'panthenol': { dry: 0.7, oily: 0.4, combination: 0.6, sensitive: 0.8, acne: 0.3 },

    // Oil control / acne = good for oily, acne
    'salicylic acid': { dry: 0.1, oily: 0.9, combination: 0.6, sensitive: 0.3, acne: 0.9 },
    'niacinamide': { dry: 0.5, oily: 0.8, combination: 0.7, sensitive: 0.6, acne: 0.7 },
    'benzoyl peroxide': { dry: 0.1, oily: 0.7, combination: 0.4, sensitive: 0.1, acne: 0.9 },
    'tea tree': { dry: 0.1, oily: 0.6, combination: 0.4, sensitive: 0.2, acne: 0.7 },
    'zinc oxide': { dry: 0.3, oily: 0.6, combination: 0.5, sensitive: 0.5, acne: 0.4 },
    'witch hazel': { dry: 0.1, oily: 0.7, combination: 0.4, sensitive: 0.2, acne: 0.5 },

    // Retinoids — not great for sensitive, good for anti-aging all types
    'retinol': { dry: 0.5, oily: 0.6, combination: 0.6, sensitive: 0.2, acne: 0.7 },
    'retinal': { dry: 0.5, oily: 0.6, combination: 0.6, sensitive: 0.2, acne: 0.6 },
    'bakuchiol': { dry: 0.6, oily: 0.5, combination: 0.6, sensitive: 0.7, acne: 0.4 },

    // Brightening
    'ascorbic acid': { dry: 0.4, oily: 0.5, combination: 0.5, sensitive: 0.3, acne: 0.3 },
    'tranexamic acid': { dry: 0.5, oily: 0.5, combination: 0.5, sensitive: 0.6, acne: 0.3 },
    'arbutin': { dry: 0.5, oily: 0.5, combination: 0.5, sensitive: 0.6, acne: 0.3 },

    // Soothing = great for sensitive
    'centella asiatica extract': { dry: 0.6, oily: 0.4, combination: 0.5, sensitive: 0.9, acne: 0.5 },
    'madecassoside': { dry: 0.6, oily: 0.4, combination: 0.5, sensitive: 0.9, acne: 0.4 },
    'allantoin': { dry: 0.6, oily: 0.4, combination: 0.5, sensitive: 0.8, acne: 0.3 },
    'aloe barbadensis leaf extract': { dry: 0.6, oily: 0.4, combination: 0.5, sensitive: 0.7, acne: 0.3 },

    // Exfoliants — not for sensitive
    'glycolic acid': { dry: 0.3, oily: 0.7, combination: 0.5, sensitive: 0.1, acne: 0.6 },
    'lactic acid': { dry: 0.5, oily: 0.5, combination: 0.5, sensitive: 0.3, acne: 0.4 },

    // Problematic for sensitive
    'parfum': { dry: 0.3, oily: 0.3, combination: 0.3, sensitive: 0.0, acne: 0.2 },
    'alcohol denat.': { dry: 0.0, oily: 0.4, combination: 0.2, sensitive: 0.0, acne: 0.2 },
    'sodium lauryl sulfate': { dry: 0.0, oily: 0.3, combination: 0.1, sensitive: 0.0, acne: 0.1 },
  }

  const skinTypes = ['dry', 'oily', 'combination', 'sensitive', 'acne']
  const scores: Record<string, number[]> = {}
  skinTypes.forEach(t => { scores[t] = [] })

  for (const ingredient of ingredients) {
    const key = ingredient.toLowerCase().trim()

    // Direct mapping
    const signal = SKIN_TYPE_SIGNALS[key]
    if (signal) {
      skinTypes.forEach(t => scores[t].push(signal[t]))
      continue
    }

    // Fuzzy match: check if ingredient contains a key
    for (const [signalKey, signalVal] of Object.entries(SKIN_TYPE_SIGNALS)) {
      if (key.includes(signalKey) || signalKey.includes(key)) {
        skinTypes.forEach(t => scores[t].push(signalVal[t]))
        break
      }
    }
  }

  // Average the signals per skin type
  const fit: Record<string, number> = {}
  skinTypes.forEach(t => {
    if (scores[t].length === 0) {
      fit[t] = 0.5 // Default: neutral fit
    } else {
      fit[t] = Math.round((scores[t].reduce((a, b) => a + b, 0) / scores[t].length) * 100) / 100
    }
  })

  return fit
}

// ── Concern Tags ────────────────────────────────────────────

/**
 * Determine which skincare concerns a product addresses based on ingredients.
 */
function computeConcernTags(
  ingredients: string[],
  concerns: SkincareConcernRow[]
): string[] {
  const tags: string[] = []
  const lowerIngredients = ingredients.map(i => i.toLowerCase().trim())

  for (const concern of concerns) {
    const matchCount = concern.key_ingredients.filter(ki =>
      lowerIngredients.some(li => li.includes(ki.toLowerCase()) || ki.toLowerCase().includes(li))
    ).length

    // Require at least 1 key ingredient match
    if (matchCount >= 1) {
      tags.push(concern.id)
    }
  }

  return tags
}

// ── Tier & Trend Detection ──────────────────────────────────

function detectTopTier(
  ingredients: string[],
  safetyMap: Map<string, IngredientSafetyRow>
): string | null {
  const tierOrder = ['tier1', 'tier2', 'tier3', 'tier4']

  for (const tier of tierOrder) {
    for (const ingredient of ingredients) {
      const safety = safetyMap.get(ingredient.toLowerCase().trim())
      if (safety?.tier === tier) return tier
    }
  }

  return null
}

function detectBestTrend(
  ingredients: string[],
  safetyMap: Map<string, IngredientSafetyRow>
): string | null {
  const trendPriority = ['rising', 'stable', 'declining']

  for (const trend of trendPriority) {
    for (const ingredient of ingredients) {
      const safety = safetyMap.get(ingredient.toLowerCase().trim())
      if (safety?.trend === trend && ['tier1', 'tier2', 'tier3'].includes(safety.tier ?? '')) {
        return trend
      }
    }
  }

  return null
}

// ── Conflict Detection ──────────────────────────────────────

interface ConflictFlag {
  family: string
  ingredients: string[]
}

async function detectConflicts(ingredients: string[]): Promise<ConflictFlag[]> {
  const db = getServiceClient()
  const lowerIngredients = ingredients.map(i => i.toLowerCase().trim())

  // Fetch all conflict family members
  const { data: members } = await db
    .from('ingredient_conflict_members')
    .select('family_id, inci_name')

  if (!members || members.length === 0) return []

  // Group by family
  const familyMembers = new Map<string, string[]>()
  for (const m of members) {
    if (!familyMembers.has(m.family_id)) familyMembers.set(m.family_id, [])
    familyMembers.get(m.family_id)!.push(m.inci_name.toLowerCase())
  }

  const flags: ConflictFlag[] = []

  familyMembers.forEach((familyInciNames, familyId) => {
    const found = familyInciNames.filter(fi =>
      lowerIngredients.some(li => li.includes(fi) || fi.includes(li))
    )
    if (found.length > 0) {
      flags.push({ family: familyId, ingredients: found })
    }
  })

  return flags
}

// ── Main Scoring Function ───────────────────────────────────

/**
 * Compute all skincare scores for a product based on its ingredient list.
 */
export async function computeSkincareScores(ingredients: string[]): Promise<SkincareScores> {
  if (ingredients.length === 0) {
    return {
      ips_score: 50, // Neutral if no ingredients
      skin_type_fit: { dry: 0.5, oily: 0.5, combination: 0.5, sensitive: 0.5, acne: 0.5 },
      concern_tags: [],
      top_tier_ingredient: null,
      ingredient_trend_signal: null,
      conflict_flags: [],
    }
  }

  const safetyMap = await getIngredientCache()
  const concerns = await getConcernCache()

  const { score: ips_score } = computeIPS(ingredients, safetyMap)
  const skin_type_fit = computeSkinTypeFit(ingredients, safetyMap)
  const concern_tags = computeConcernTags(ingredients, concerns)
  const top_tier_ingredient = detectTopTier(ingredients, safetyMap)
  const ingredient_trend_signal = detectBestTrend(ingredients, safetyMap)
  const conflict_flags = await detectConflicts(ingredients)

  return {
    ips_score,
    skin_type_fit,
    concern_tags,
    top_tier_ingredient,
    ingredient_trend_signal,
    conflict_flags,
  }
}

/**
 * Clear caches (call when reference data is updated).
 */
export function clearSkincareCache(): void {
  ingredientCache = null
  concernCache = null
}
