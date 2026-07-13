import type { HelpArticle, HelpArticleListItem } from '~/types'

export function useHelp() {
  const client = useSupabaseClient()

  const articles = ref<HelpArticleListItem[]>([])
  const loading = ref(false)
  const error = ref('')

  async function fetchArticles(category?: string) {
    loading.value = true
    error.value = ''
    try {
      let q = client
        .from('help_articles')
        .select(
          'id, slug, title, summary, category, primary_path, related_paths, intent_tags, sort_order, updated_at',
        )
        .eq('published', true)
        .order('sort_order', { ascending: true })
      if (category) q = q.eq('category', category)
      const { data, error: err } = await q
      if (err) throw err
      articles.value = (data || []).map((row: any) => ({
        ...row,
        help_path: `/help/${row.slug}`,
      })) as HelpArticleListItem[]
    } catch (e: any) {
      error.value = e?.message || 'Failed to load help'
      articles.value = []
    } finally {
      loading.value = false
    }
  }

  async function getBySlug(slug: string): Promise<HelpArticle | null> {
    const { data, error: err } = await client
      .from('help_articles')
      .select('*')
      .eq('slug', slug)
      .eq('published', true)
      .maybeSingle()
    if (err) throw err
    if (!data) return null
    return {
      ...(data as any),
      help_path: `/help/${(data as any).slug}`,
    } as HelpArticle
  }

  return {
    articles,
    loading,
    error,
    fetchArticles,
    getBySlug,
  }
}
