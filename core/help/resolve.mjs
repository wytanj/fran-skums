/**
 * Deterministic help article resolution for Catalog AI + Help UI.
 */

const STOP = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'at', 'my', 'me', 'i',
  'do', 'does', 'how', 'what', 'where', 'which', 'can', 'should', 'would',
  'go', 'get', 'with', 'from', 'and', 'or', 'is', 'are', 'be', 'this', 'that',
  'please', 'help', 'need', 'want', 'page', 'screen',
])

/**
 * @param {string} text
 */
export function tokenizeHelpQuery(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s\-/]/g, ' ')
    .split(/[\s/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t))
}

/**
 * @param {Record<string, any>} article
 * @param {string[]} tokens
 * @param {string} rawQuery
 */
export function scoreHelpArticle(article, tokens, rawQuery = '') {
  if (!article) return 0
  const q = String(rawQuery || '').toLowerCase()
  const title = String(article.title || '').toLowerCase()
  const summary = String(article.summary || '').toLowerCase()
  const slug = String(article.slug || '').toLowerCase()
  const tags = Array.isArray(article.intent_tags)
    ? article.intent_tags.map((t) => String(t).toLowerCase())
    : []
  const body = String(article.body_md || '').toLowerCase().slice(0, 2000)

  let score = 0
  for (const t of tokens) {
    if (tags.some((tag) => tag === t || tag.includes(t) || t.includes(tag))) score += 4
    if (title.includes(t)) score += 3
    if (slug.includes(t)) score += 2
    if (summary.includes(t)) score += 2
    if (body.includes(t)) score += 0.5
  }

  // Phrase boosts for common nav intents
  if (/\b(where|which page|go to|navigate|open|find the)\b/.test(q)) score += 1
  if (/\bedit\b/.test(q) && /product/.test(title + tags.join(' '))) score += 3
  if (/\bimport|upload|csv|xlsx\b/.test(q) && /import/.test(slug + tags.join(' '))) score += 4
  if (/\bapprove|draft po|actions|inbox\b/.test(q) && /action/.test(slug + tags.join(' '))) score += 4
  if (/\binventory|stock|on.?hand\b/.test(q) && /inventory/.test(slug + tags.join(' '))) score += 4
  if (/\bpos\b/.test(q) && /pos/.test(slug + tags.join(' '))) score += 4
  if (/\bmcp\b/.test(q) && /mcp/.test(slug + tags.join(' '))) score += 5

  // Store ops / Loft / floor (operator runbook topics)
  const blob = `${slug} ${title} ${tags.join(' ')} ${summary}`
  if (/\b(store.?ops|replenish|wave|lift|defer|monday|thursday)\b/.test(q) && /store|replenish|wave|lift/.test(blob)) score += 5
  if (/\b(receive|receiving|exception|short|damaged|wrong.?sku|self.?collect)\b/.test(q) && /receive|exception|floor|store/.test(blob)) score += 5
  if (/\b(damage|found|cycle.?count|stocktake|floor|adjustment|shrink)\b/.test(q) && /floor|damage|found|cycle|adjust|stock/.test(blob)) score += 5
  if (/\b(loft|worldsyntech|ofs|3pl|asn|inbound|pre.?alert|loft-sg)\b/.test(q) && /loft|worldsyntech|inbound|3pl|ofs|asn/.test(blob)) score += 6
  if (/\b(ledger|stock truth|who owns|points|crm)\b/.test(q) && /inventory|pos|crm|ledger|truth|operator/.test(blob)) score += 4
  if (/\b(operator|runbook|how do we|operate)\b/.test(q) && /operator|runbook|store-ops|getting-started/.test(blob)) score += 5

  return score
}

/**
 * @param {Record<string, any>} article
 */
export function compactHelpArticle(article) {
  if (!article) return null
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    summary: article.summary || null,
    category: article.category,
    primary_path: article.primary_path || null,
    related_paths: article.related_paths || [],
    intent_tags: article.intent_tags || [],
    help_path: `/help/${article.slug}`,
    sort_order: article.sort_order ?? 100,
  }
}

/**
 * Rank in-memory articles (for tests + fallbacks).
 * @param {Array<Record<string, any>>} articles
 * @param {string} query
 * @param {{ limit?: number, min_score?: number }} [opts]
 */
export function rankHelpArticles(articles, query, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 5, 1), 10)
  const minScore = opts.min_score ?? 2
  const tokens = tokenizeHelpQuery(query)
  const ranked = (articles || [])
    .map((a) => ({
      article: a,
      score: scoreHelpArticle(a, tokens, query),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score || (a.article.sort_order ?? 100) - (b.article.sort_order ?? 100))
    .slice(0, limit)

  return {
    query: String(query || ''),
    tokens,
    matches: ranked.map((r) => ({
      ...compactHelpArticle(r.article),
      confidence: Math.min(0.99, Math.round((r.score / 20) * 100) / 100),
      score: r.score,
      steps_preview: extractStepsPreview(r.article.body_md),
    })),
    needs_clarification: ranked.length === 0,
    help_index_path: '/help',
  }
}

/**
 * @param {string} body
 */
function extractStepsPreview(body) {
  const lines = String(body || '').split(/\r?\n/)
  const steps = []
  for (const line of lines) {
    const m = line.match(/^\d+\.\s+(.+)/)
    if (m) steps.push(m[1].trim())
    if (steps.length >= 5) break
  }
  return steps
}

/**
 * Load published articles and rank.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {string} query
 * @param {{ limit?: number }} [opts]
 */
export async function resolveHelp(db, query, opts = {}) {
  const { data, error } = await db
    .from('help_articles')
    .select(
      'id, slug, title, summary, body_md, category, primary_path, related_paths, intent_tags, sort_order, published',
    )
    .eq('published', true)
    .order('sort_order', { ascending: true })

  if (error) throw new Error(error.message)

  const result = rankHelpArticles(data || [], query, opts)

  // Always attach top browse list when weak match
  if (result.needs_clarification || result.matches.length === 0) {
    result.suggestions = (data || []).slice(0, 8).map(compactHelpArticle)
    result.message =
      'No strong help match. Browse /help or pick a suggestion. Do not invent app paths.'
  } else {
    // Include body excerpts for top matches so the assistant can answer without a second hop
    const bySlug = new Map((data || []).map((a) => [a.slug, a]))
    for (let i = 0; i < Math.min(3, result.matches.length); i++) {
      const full = bySlug.get(result.matches[i].slug)
      if (!full) continue
      result.matches[i].body_excerpt = String(full.body_md || '').slice(0, 4000)
      result.matches[i].steps_preview = extractStepsPreview(full.body_md)
    }
  }

  result.hint =
    'Prefer summarizing body_excerpt / steps_preview. For the full article call get_help_article (assistant) or help_get (MCP) with the slug. Always link /help/{slug}.'

  return result
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{ category?: string | null }} [opts]
 */
export async function listHelpArticles(db, opts = {}) {
  let q = db
    .from('help_articles')
    .select(
      'id, slug, title, summary, category, primary_path, related_paths, intent_tags, sort_order, updated_at',
    )
    .eq('published', true)
    .order('sort_order', { ascending: true })
  if (opts.category) q = q.eq('category', opts.category)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data || []).map(compactHelpArticle)
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {string} slug
 */
export async function getHelpArticleBySlug(db, slug) {
  const { data, error } = await db
    .from('help_articles')
    .select('*')
    .eq('slug', slug)
    .eq('published', true)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Full article payload for assistant / MCP (body included for accurate how-to answers).
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {string} slug
 * @param {{ max_body_chars?: number }} [opts]
 */
export async function getHelpArticleForAgent(db, slug, opts = {}) {
  const maxBody = Math.min(Math.max(Number(opts.max_body_chars) || 12000, 500), 20000)
  const raw = String(slug || '').trim().replace(/^\/?help\//, '')
  if (!raw) {
    return { found: false, message: 'slug is required', help_index_path: '/help' }
  }
  const article = await getHelpArticleBySlug(db, raw)
  if (!article) {
    return {
      found: false,
      slug: raw,
      message: `No published help article for slug "${raw}". Use resolve_help or list_help_articles.`,
      help_index_path: '/help',
    }
  }
  const body = String(article.body_md || '')
  return {
    found: true,
    slug: article.slug,
    title: article.title,
    summary: article.summary || null,
    category: article.category,
    primary_path: article.primary_path || null,
    related_paths: article.related_paths || [],
    intent_tags: article.intent_tags || [],
    help_path: `/help/${article.slug}`,
    steps_preview: extractStepsPreview(body),
    body_md: body.length > maxBody ? `${body.slice(0, maxBody)}\n\n…(truncated)` : body,
    body_truncated: body.length > maxBody,
    updated_at: article.updated_at || null,
  }
}
