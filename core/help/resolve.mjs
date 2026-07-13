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
    // Include body excerpt for top match so the model can summarize accurately
    const top = (data || []).find((a) => a.slug === result.matches[0]?.slug)
    if (top) {
      result.matches[0].body_excerpt = String(top.body_md || '').slice(0, 2500)
      result.matches[0].steps_preview = extractStepsPreview(top.body_md)
    }
  }

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
