import type {
  ProductQualitySnapshot,
  ProductQualityAnalysis,
  QualityAnalysisResult,
  PriceHistoryEntry,
  ScrapeQueueItem,
} from '~/types'

export function useProductQuality() {
  const client = useSupabaseClient()
  const { currentWorkspace } = useWorkspace()

  const analyses = ref<ProductQualityAnalysis[]>([])
  const selectedAnalysis = ref<ProductQualityAnalysis | null>(null)
  const selectedSnapshots = ref<ProductQualitySnapshot[]>([])
  const priceHistory = ref<PriceHistoryEntry[]>([])
  const queueItems = ref<ScrapeQueueItem[]>([])
  const loading = ref(false)
  const analysing = ref(false)
  const error = ref<string | null>(null)

  // ── Load all analyses for workspace ────────────────────────
  async function loadAnalyses() {
    if (!currentWorkspace.value?.id) return
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await client
        .from('product_quality_analyses')
        .select('*')
        .eq('workspace_id', currentWorkspace.value.id)
        .order('overall_score', { ascending: false })
      if (err) throw err
      analyses.value = (data ?? []) as ProductQualityAnalysis[]
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  // ── Load latest analysis for a single product ───────────────
  async function loadAnalysis(productId: string) {
    if (!currentWorkspace.value?.id) return
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await client
        .from('product_quality_analyses')
        .select('*')
        .eq('workspace_id', currentWorkspace.value.id)
        .eq('product_id', productId)
        .single()
      if (err && err.code !== 'PGRST116') throw err
      selectedAnalysis.value = data as ProductQualityAnalysis | null

      if (data?.snapshot_ids?.length) {
        const { data: snaps } = await client
          .from('product_quality_snapshots')
          .select('*')
          .in('id', data.snapshot_ids)
          .order('marketplace')
        selectedSnapshots.value = (snaps ?? []) as ProductQualitySnapshot[]
      } else {
        selectedSnapshots.value = []
      }
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  // ── Run AI + crawl analysis (free tier) ───────────────────
  async function analyseProduct(params: {
    product_id: string
    product_title: string
    brand_name?: string | null
    category_name?: string | null
    ean?: string | null
    asin?: string | null
    retail_price?: number | null
    currency?: string
  }): Promise<QualityAnalysisResult | null> {
    if (!currentWorkspace.value?.id) return null
    analysing.value = true
    error.value = null
    try {
      const result = await $fetch<QualityAnalysisResult>('/api/quality', {
        method: 'POST',
        body: {
          ...params,
          workspace_id: currentWorkspace.value.id,
        },
      })

      // Refresh the analyses list and select this product
      await loadAnalyses()
      await loadAnalysis(params.product_id)

      return result
    } catch (e: any) {
      error.value = e?.data?.message ?? e.message ?? 'Analysis failed'
      return null
    } finally {
      analysing.value = false
    }
  }

  // ── Load price history for a product ──────────────────────
  async function loadPriceHistory(productId: string, days?: number) {
    if (!currentWorkspace.value?.id) return
    try {
      let query = client
        .from('v_price_history')
        .select('*')
        .eq('workspace_id', currentWorkspace.value.id)
        .eq('product_id', productId)
        .order('crawled_at', { ascending: true })

      if (days) {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
        query = query.gte('crawled_at', since)
      }

      const { data } = await query
      priceHistory.value = (data ?? []) as PriceHistoryEntry[]
    } catch {
      priceHistory.value = []
    }
  }

  // ── Load scrape queue status ──────────────────────────────
  async function loadQueueStatus() {
    if (!currentWorkspace.value?.id) return
    try {
      const { data } = await client
        .from('v_scrape_queue_summary')
        .select('*')
        .eq('workspace_id', currentWorkspace.value.id)
        .in('status', ['pending', 'processing'])
        .limit(50)
      queueItems.value = (data ?? []) as ScrapeQueueItem[]
    } catch {
      queueItems.value = []
    }
  }

  // ── Check if a product is queued for scraping ─────────────
  function isQueued(productId: string): ScrapeQueueItem | undefined {
    return queueItems.value.find(q => q.product_id === productId)
  }

  // ── Helpers ─────────────────────────────────────────────────
  function scoreColor(score: number | null): string {
    if (score === null) return 'text-gray-500'
    if (score >= 80) return 'text-emerald-400'
    if (score >= 60) return 'text-yellow-400'
    if (score >= 40) return 'text-orange-400'
    return 'text-red-400'
  }

  function scoreBg(score: number | null): string {
    if (score === null) return 'bg-gray-800'
    if (score >= 80) return 'bg-emerald-500/10 border-emerald-500/30'
    if (score >= 60) return 'bg-yellow-500/10 border-yellow-500/30'
    if (score >= 40) return 'bg-orange-500/10 border-orange-500/30'
    return 'bg-red-500/10 border-red-500/30'
  }

  function positionLabel(pos: string | null): string {
    const map: Record<string, string> = {
      market_leader: 'Market Leader',
      competitive: 'Competitive',
      at_risk: 'At Risk',
      lagging: 'Lagging',
      niche: 'Niche',
    }
    return pos ? (map[pos] ?? pos) : '—'
  }

  function positionBadgeClass(pos: string | null): string {
    const map: Record<string, string> = {
      market_leader: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
      competitive:   'bg-blue-500/20 text-blue-400 border border-blue-500/30',
      at_risk:       'bg-orange-500/20 text-orange-400 border border-orange-500/30',
      lagging:       'bg-red-500/20 text-red-400 border border-red-500/30',
      niche:         'bg-purple-500/20 text-purple-400 border border-purple-500/30',
    }
    return pos ? (map[pos] ?? 'bg-gray-700 text-gray-400') : 'bg-gray-700 text-gray-400'
  }

  function priceBadgeClass(pos: string | null): string {
    const map: Record<string, string> = {
      cheapest:     'bg-emerald-500/20 text-emerald-400',
      competitive:  'bg-blue-500/20 text-blue-400',
      premium:      'bg-yellow-500/20 text-yellow-400',
      overpriced:   'bg-red-500/20 text-red-400',
      unknown:      'bg-gray-700 text-gray-400',
    }
    return pos ? (map[pos] ?? 'bg-gray-700 text-gray-400') : 'bg-gray-700 text-gray-400'
  }

  function marketplaceLabel(m: string): string {
    const map: Record<string, string> = {
      shopee:  'Shopee SG',
      lazada:  'Lazada SG',
      amazon:  'Amazon',
      iherb:   'iHerb',
    }
    return map[m] ?? m
  }

  function marketplaceBadge(m: string): string {
    const map: Record<string, string> = {
      shopee:  'bg-orange-500/20 text-orange-300',
      lazada:  'bg-blue-500/20 text-blue-300',
      amazon:  'bg-yellow-500/20 text-yellow-300',
      iherb:   'bg-green-500/20 text-green-300',
    }
    return map[m] ?? 'bg-gray-700 text-gray-300'
  }

  function dataSourceBadge(source: string | null): { label: string; class: string } {
    if (source === 'scraped') {
      return { label: 'Live Data', class: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' }
    }
    return { label: 'AI Estimated', class: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' }
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  }

  function formatCurrency(amount: number | null, currency = 'SGD'): string {
    if (amount === null) return '—'
    return `${currency} ${amount.toFixed(2)}`
  }

  return {
    analyses,
    selectedAnalysis,
    selectedSnapshots,
    priceHistory,
    queueItems,
    loading,
    analysing,
    error,
    loadAnalyses,
    loadAnalysis,
    analyseProduct,
    loadPriceHistory,
    loadQueueStatus,
    isQueued,
    scoreColor,
    scoreBg,
    positionLabel,
    positionBadgeClass,
    priceBadgeClass,
    marketplaceLabel,
    marketplaceBadge,
    dataSourceBadge,
    timeAgo,
    formatCurrency,
  }
}
