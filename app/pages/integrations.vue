<script setup lang="ts">
import type {
  IntegrationNodeDefinition,
  IntegrationCredential,
  IntegrationConnection,
  NodeCategory,
  CredentialSchemaProperty,
  ConnectionStatus,
  Brand,
  Category,
} from '~/types'

const supabaseClient = useSupabaseClient()
const { currentWorkspace } = useWorkspace()

const {
  nodeDefinitions,
  credentials,
  connections,
  executions,
  loading,
  nodesByCategory,
  loadAll,
  createCredential,
  updateCredential,
  deleteCredential,
  testCredential,
  createConnection,
  updateConnection,
  deleteConnection,
  activateConnection,
  pauseConnection,
  pullWooCommerceProducts,
  syncWorldsyntechReferenceData,
  pullWorldsyntechInventory,
  fetchExecutions,
  getCredentialsForNode,
} = useIntegrations()

// ── Tabs ──
const activeTab = ref<'nodes' | 'connections' | 'credentials' | 'executions'>('nodes')

// ── Skincare Intelligence (app mode — accessed from node catalog) ──
const skincareMode = ref(false)
const skincareTab = ref<'catalog' | 'url-analyser' | 'methodology'>('catalog')

// ── URL Analyser (embedded in Skincare Intelligence) ──────────
const URL_CHECK_PLATFORMS = [
  { key: 'hwahae',     label: 'Hwahae',      domain: 'hwahae.com',     color: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
  { key: 'oliveyoung', label: 'Olive Young',  domain: 'oliveyoung.com', color: 'bg-green-500/20 text-green-300 border-green-500/30' },
  { key: 'sephora_sg', label: 'Sephora SG',   domain: 'sephora.sg',     color: 'bg-gray-400/20 text-gray-200 border-gray-400/30' },
  { key: 'sephora_us', label: 'Sephora US',   domain: 'sephora.com',    color: 'bg-gray-400/20 text-gray-200 border-gray-400/30' },
  { key: 'shopee_sg',  label: 'Shopee SG',    domain: 'shopee.sg',      color: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  { key: 'lazada_sg',  label: 'Lazada SG',    domain: 'lazada.sg',      color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  { key: 'amazon',     label: 'Amazon',       domain: 'amazon.com',     color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
  { key: 'iherb',      label: 'iHerb',        domain: 'iherb.com',      color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
]

const uaInput = ref('')
const uaChecking = ref(false)
const uaError = ref<string | null>(null)
const uaResult = ref<any>(null)
const uaSavedProductId = ref<string | null>(null)

const showUaSaveModal = ref(false)
const uaSaving = ref(false)
const uaSaveError = ref<string | null>(null)
const uaSaveMode = ref<'new' | 'link'>('new')
const uaLinkSearch = ref('')
const uaLinkResults = ref<any[]>([])
const uaLinkSearchLoading = ref(false)
const uaSelectedLink = ref<any>(null)
const uaBrands = ref<Brand[]>([])
const uaCategories = ref<Category[]>([])
const uaNewForm = ref({
  title: '',
  brand_id: null as string | null,
  category_id: null as string | null,
  retail_price: null as number | null,
  currency: 'SGD',
  ean: '',
})

const uaDetectedPlatform = computed(() => {
  const u = uaInput.value.toLowerCase()
  return URL_CHECK_PLATFORMS.find(p => u.includes(p.domain)) ?? null
})

async function runUaCheck() {
  if (!uaInput.value.trim()) return
  uaChecking.value = true
  uaError.value = null
  uaResult.value = null
  uaSavedProductId.value = null
  try {
    uaResult.value = await $fetch('/api/quality/url-analyse', {
      method: 'POST',
      body: { url: uaInput.value.trim() },
    })
    if (uaResult.value?.product) {
      const p = uaResult.value.product
      uaNewForm.value.title = p.name ?? ''
      uaNewForm.value.retail_price = p.price_sgd ?? null
    }
  } catch (e: any) {
    uaError.value = e?.data?.statusMessage ?? e?.data?.message ?? e.message ?? 'Analysis failed'
  } finally {
    uaChecking.value = false
  }
}

function resetUaCheck() {
  uaInput.value = ''
  uaResult.value = null
  uaError.value = null
  uaSavedProductId.value = null
}

async function openUaSaveModal() {
  showUaSaveModal.value = true
  uaSaveMode.value = 'new'
  if (!uaBrands.value.length && currentWorkspace.value?.id) {
    const [{ data: bData }, { data: cData }] = await Promise.all([
      supabaseClient.from('brands').select('id, name').eq('workspace_id', currentWorkspace.value.id).order('name'),
      supabaseClient.from('categories').select('id, name').eq('workspace_id', currentWorkspace.value.id).order('name'),
    ])
    uaBrands.value = (bData ?? []) as Brand[]
    uaCategories.value = (cData ?? []) as Category[]
  }
}

watch(uaLinkSearch, async () => {
  if (!currentWorkspace.value?.id || uaLinkSearch.value.length < 2) { uaLinkResults.value = []; return }
  uaLinkSearchLoading.value = true
  const { data } = await supabaseClient
    .from('products')
    .select('id, title, sku, retail_price, currency')
    .eq('workspace_id', currentWorkspace.value.id)
    .or(`title.ilike.%${uaLinkSearch.value}%,sku.ilike.%${uaLinkSearch.value}%`)
    .limit(8)
  uaLinkResults.value = data ?? []
  uaLinkSearchLoading.value = false
})

async function uaSaveToDatabase() {
  if (!currentWorkspace.value?.id || !uaResult.value) return
  uaSaving.value = true
  uaSaveError.value = null
  try {
    if (uaSaveMode.value === 'new') {
      const { data: product, error: pErr } = await supabaseClient
        .from('products')
        .insert({
          workspace_id: currentWorkspace.value.id,
          title: uaNewForm.value.title || uaResult.value.product?.name || 'Unnamed Product',
          brand_id: uaNewForm.value.brand_id || null,
          category_id: uaNewForm.value.category_id || null,
          retail_price: uaNewForm.value.retail_price || null,
          currency: uaNewForm.value.currency || 'SGD',
          ean: uaNewForm.value.ean || null,
          status: 'draft',
        })
        .select('id')
        .single()
      if (pErr) throw pErr
      uaSavedProductId.value = product.id
      await uaSaveQualityAnalysis(product.id)
    } else if (uaSaveMode.value === 'link' && uaSelectedLink.value) {
      uaSavedProductId.value = uaSelectedLink.value.id
      await uaSaveQualityAnalysis(uaSelectedLink.value.id)
    }
    showUaSaveModal.value = false
  } catch (e: any) {
    uaSaveError.value = e.message ?? 'Save failed'
  } finally {
    uaSaving.value = false
  }
}

async function uaSaveQualityAnalysis(productId: string) {
  if (!currentWorkspace.value?.id || !uaResult.value) return
  const r = uaResult.value
  const now = new Date().toISOString()
  if (r.product) {
    await supabaseClient.from('product_quality_snapshots').insert({
      workspace_id: currentWorkspace.value.id,
      product_id: productId,
      marketplace: r.platform?.key ?? 'unknown',
      found: true,
      listing_title: r.product.name ?? null,
      external_url: r.url ?? null,
      price: r.product.price_sgd ?? null,
      currency: 'SGD',
      rating: r.product.rating ?? null,
      review_count: r.product.review_count ?? null,
      units_sold_label: r.product.units_sold_label ?? null,
      seller_name: null,
      availability: r.product.availability ?? 'unknown',
      data_source: r.html_fetched ? 'scraped' : 'ai_estimated',
      crawled_at: now,
    })
  }
  if (r.analysis) {
    await supabaseClient.from('product_quality_analyses').upsert({
      workspace_id: currentWorkspace.value.id,
      product_id: productId,
      overall_score: r.analysis.overall_score ?? null,
      price_score: r.analysis.value_score ?? null,
      review_score: r.analysis.rating_score ?? null,
      availability_score: r.analysis.popularity_score ?? null,
      competitive_position: r.analysis.competitive_position ?? null,
      price_position: null,
      ai_summary: r.analysis.market_context ?? null,
      recommendations: r.analysis.recommendations ?? null,
      sources_checked: [r.platform?.key ?? 'unknown'],
      analysed_at: now,
    }, { onConflict: 'workspace_id,product_id' })
  }
}

function uaSc(score: number | null) {
  if (score === null) return 'text-gray-500'
  if (score >= 80) return 'text-emerald-400'
  if (score >= 60) return 'text-yellow-400'
  if (score >= 40) return 'text-orange-400'
  return 'text-red-400'
}
function uaScBg(score: number | null) {
  if (score === null) return 'bg-gray-800 border-gray-700'
  if (score >= 80) return 'bg-emerald-500/10 border-emerald-500/30'
  if (score >= 60) return 'bg-yellow-500/10 border-yellow-500/30'
  if (score >= 40) return 'bg-orange-500/10 border-orange-500/30'
  return 'bg-red-500/10 border-red-500/30'
}
function uaPosClass(p: string | null) {
  const m: Record<string, string> = { market_leader: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', competitive: 'bg-blue-500/20 text-blue-400 border-blue-500/30', at_risk: 'bg-orange-500/20 text-orange-400 border-orange-500/30', lagging: 'bg-red-500/20 text-red-400 border-red-500/30', niche: 'bg-purple-500/20 text-purple-400 border-purple-500/30' }
  return p ? (m[p] ?? 'bg-gray-700 text-gray-400') : 'bg-gray-700 text-gray-400'
}
function uaPosText(p: string | null) {
  const m: Record<string, string> = { market_leader: 'Market Leader', competitive: 'Competitive', at_risk: 'At Risk', lagging: 'Lagging', niche: 'Niche' }
  return p ? (m[p] ?? p) : '—'
}
function uaPlatformColor(key: string) {
  return URL_CHECK_PLATFORMS.find(p => p.key === key)?.color ?? 'bg-gray-700 text-gray-300'
}

// ── Skincare Intelligence ──
const skincareStats = ref<any>(null)
const skincareProducts = ref<any[]>([])
const skincareProductsTotal = ref(0)
const skincareJobs = ref<any[]>([])
const skincareLoading = ref(false)
const skincareCrawling = ref(false)
const crawlSource = ref<'hwahae' | 'oliveyoung'>('hwahae')
const crawlSelectedCategories = ref<string[]>([])
const crawlDetailPages = ref(true)

const HWAHAE_CATEGORIES = [
  { id: 'toner', label: 'Toner', group: 'skincare' },
  { id: 'emulsion', label: 'Emulsion', group: 'skincare' },
  { id: 'serum', label: 'Serum/Ampoule', group: 'skincare' },
  { id: 'cream', label: 'Cream', group: 'skincare' },
  { id: 'eye_cream', label: 'Eye Cream', group: 'skincare' },
  { id: 'cleanser', label: 'Cleanser', group: 'skincare' },
  { id: 'cleansing_oil', label: 'Cleansing Oil', group: 'skincare' },
  { id: 'mask', label: 'Mask/Pack', group: 'skincare' },
  { id: 'suncare', label: 'Sun Care', group: 'skincare' },
  { id: 'mist', label: 'Mist', group: 'skincare' },
  { id: 'lip_care', label: 'Lip Care', group: 'skincare' },
  { id: 'peeling', label: 'Peeling/Scrub', group: 'skincare' },
  { id: 'foundation', label: 'Foundation', group: 'makeup' },
  { id: 'primer', label: 'Primer', group: 'makeup' },
  { id: 'concealer', label: 'Concealer', group: 'makeup' },
  { id: 'powder', label: 'Powder', group: 'makeup' },
  { id: 'blush', label: 'Blush', group: 'makeup' },
  { id: 'mascara', label: 'Mascara', group: 'makeup' },
  { id: 'eyeliner', label: 'Eyeliner', group: 'makeup' },
  { id: 'lipstick', label: 'Lipstick', group: 'makeup' },
  { id: 'lip_tint', label: 'Lip Tint', group: 'makeup' },
]

const OY_CATEGORIES = [
  { id: 'moisturizers', label: 'Moisturizers', group: 'skincare' },
  { id: 'cleansers', label: 'Cleansers', group: 'skincare' },
  { id: 'serums', label: 'Serums', group: 'skincare' },
  { id: 'toners', label: 'Toners', group: 'skincare' },
  { id: 'eye_care', label: 'Eye Care', group: 'skincare' },
  { id: 'lip_care', label: 'Lip Care', group: 'skincare' },
  { id: 'face_makeup', label: 'Face Makeup', group: 'makeup' },
  { id: 'eye_makeup', label: 'Eye Makeup', group: 'makeup' },
  { id: 'lip_makeup', label: 'Lip Makeup', group: 'makeup' },
  { id: 'masks', label: 'Face Masks', group: 'extra' },
  { id: 'suncare', label: 'Sun Care', group: 'extra' },
]

const crawlCategories = computed(() =>
  crawlSource.value === 'hwahae' ? HWAHAE_CATEGORIES : OY_CATEGORIES
)
const crawlSkincareCategories = computed(() => crawlCategories.value.filter(c => c.group === 'skincare'))
const crawlMakeupCategories = computed(() => crawlCategories.value.filter(c => c.group === 'makeup'))
const crawlExtraCategories = computed(() => crawlCategories.value.filter(c => c.group === 'extra'))

function toggleCategory(id: string) {
  const idx = crawlSelectedCategories.value.indexOf(id)
  if (idx >= 0) crawlSelectedCategories.value.splice(idx, 1)
  else crawlSelectedCategories.value.push(id)
}

function selectAllCategories(group?: string) {
  const cats = group ? crawlCategories.value.filter(c => c.group === group) : crawlCategories.value
  crawlSelectedCategories.value = [...new Set([...crawlSelectedCategories.value, ...cats.map(c => c.id)])]
}

function deselectAllCategories() {
  crawlSelectedCategories.value = []
}

// Reset selection when switching source
watch(crawlSource, () => { crawlSelectedCategories.value = [] })

const skincareFilters = reactive({
  source: '' as string,
  subcategory: '' as string,
  concern: '' as string,
  skin_type: '' as string,
  min_ips: '' as string,
  trend: '' as string,
  search: '' as string,
  sort_by: 'ips_score',
  sort_dir: 'desc',
  page: 1,
})
const selectedSkincareProduct = ref<any>(null)
const showSkincareDetailModal = ref(false)
const skincareDetailLoading = ref(false)
const skincareDetailData = ref<any>(null)

// ── Crawl Log Viewer ──
const crawlLogs = ref<Array<{ timestamp: string; level: string; message: string }>>([])
const crawlLogIndex = ref(0)
const crawlLogJobId = ref('')
let logPollTimer: ReturnType<typeof setInterval> | null = null

function viewLogs(jobId: string) {
  crawlLogJobId.value = jobId
  crawlLogs.value = []
  crawlLogIndex.value = 0
  pollLogs()
  if (logPollTimer) clearInterval(logPollTimer)
  logPollTimer = setInterval(pollLogs, 2000)
}

function stopLogPolling() {
  if (logPollTimer) { clearInterval(logPollTimer); logPollTimer = null }
  crawlLogJobId.value = ''
}

async function pollLogs() {
  if (!crawlLogJobId.value) return
  try {
    const data: any = await $fetch('/api/skincare/logs', {
      params: { job_id: crawlLogJobId.value, since: crawlLogIndex.value },
    })
    if (data.logs?.length) {
      crawlLogs.value.push(...data.logs)
      crawlLogIndex.value = data.nextIndex
      // Auto-scroll
      nextTick(() => {
        const el = document.getElementById('crawl-log-container')
        if (el) el.scrollTop = el.scrollHeight
      })
    }
  } catch {}
}

function logLevelColor(level: string): string {
  if (level === 'error') return 'text-red-400'
  if (level === 'warn') return 'text-amber-400'
  return 'text-gray-400'
}

async function loadSkincareStats() {
  try {
    const data = await $fetch('/api/skincare/stats')
    skincareStats.value = data
  } catch {}
}

async function loadSkincareProducts() {
  skincareLoading.value = true
  try {
    const params: Record<string, string> = {
      sort_by: skincareFilters.sort_by,
      sort_dir: skincareFilters.sort_dir,
      page: String(skincareFilters.page),
      per_page: '50',
    }
    if (skincareFilters.source) params.source = skincareFilters.source
    if (skincareFilters.subcategory) params.subcategory = skincareFilters.subcategory
    if (skincareFilters.concern) params.concern = skincareFilters.concern
    if (skincareFilters.skin_type) params.skin_type = skincareFilters.skin_type
    if (skincareFilters.min_ips) params.min_ips = skincareFilters.min_ips
    if (skincareFilters.trend) params.trend = skincareFilters.trend
    if (skincareFilters.search) params.search = skincareFilters.search

    const data = await $fetch('/api/skincare/products', { params })
    skincareProducts.value = (data as any).products
    skincareProductsTotal.value = (data as any).total
  } catch {} finally {
    skincareLoading.value = false
  }
}

async function loadSkincareJobs() {
  try {
    const data = await $fetch('/api/skincare/jobs')
    skincareJobs.value = (data as any).jobs
  } catch {}
}

let crawlPollTimer: ReturnType<typeof setInterval> | null = null

async function startCrawl() {
  if (crawlSelectedCategories.value.length === 0) {
    alert('Select at least one category to crawl')
    return
  }
  skincareCrawling.value = true
  try {
    const result: any = await $fetch('/api/skincare/crawl', {
      method: 'POST',
      body: {
        source: crawlSource.value,
        categories: crawlSelectedCategories.value,
        detail_pages: crawlDetailPages.value,
        job_type: 'category',
      },
    })
    await loadSkincareJobs()
    startCrawlPolling()
    if (result.job_id) viewLogs(result.job_id)
  } catch (e: any) {
    alert(e.data?.message || e.message || 'Crawl failed')
  } finally {
    skincareCrawling.value = false
  }
}

function startCrawlPolling() {
  if (crawlPollTimer) return
  crawlPollTimer = setInterval(async () => {
    await loadSkincareJobs()
    await loadSkincareStats()
    // Stop polling if no running jobs
    const hasRunning = skincareJobs.value.some((j: any) => j.status === 'running' || j.status === 'pending')
    if (!hasRunning && crawlPollTimer) {
      clearInterval(crawlPollTimer)
      crawlPollTimer = null
      await loadSkincareProducts()
    }
  }, 5000)
}

async function refreshSkincare() {
  await Promise.all([loadSkincareStats(), loadSkincareProducts(), loadSkincareJobs()])
}

async function openSkincareProduct(product: any) {
  selectedSkincareProduct.value = product
  showSkincareDetailModal.value = true
  skincareDetailLoading.value = true
  try {
    const data = await $fetch(`/api/skincare/product/${product.id}`)
    skincareDetailData.value = data
  } catch {} finally {
    skincareDetailLoading.value = false
  }
}

function ipsColor(score: number | null): string {
  if (!score) return 'text-gray-500'
  if (score >= 85) return 'text-emerald-400'
  if (score >= 60) return 'text-blue-400'
  if (score >= 30) return 'text-amber-400'
  return 'text-red-400'
}

function ipsBg(score: number | null): string {
  if (!score) return 'bg-gray-800'
  if (score >= 85) return 'bg-emerald-500/10'
  if (score >= 60) return 'bg-blue-500/10'
  if (score >= 30) return 'bg-amber-500/10'
  return 'bg-red-500/10'
}

function ipsLabel(score: number | null): string {
  if (!score) return 'Unknown'
  if (score >= 85) return 'Clean'
  if (score >= 60) return 'Standard'
  if (score >= 30) return 'Caution'
  return 'Avoid'
}

function trendIcon(trend: string | null): string {
  if (trend === 'rising') return '↑'
  if (trend === 'declining') return '↓'
  return '→'
}

function trendColor(trend: string | null): string {
  if (trend === 'rising') return 'text-emerald-400'
  if (trend === 'declining') return 'text-red-400'
  return 'text-gray-400'
}

function tierLabel(tier: string | null): string {
  if (!tier) return '—'
  return tier.replace('tier', 'Tier ')
}

function tierColor(tier: string | null): string {
  if (tier === 'tier1') return 'text-amber-300'
  if (tier === 'tier2') return 'text-blue-400'
  if (tier === 'tier3') return 'text-purple-400'
  if (tier === 'tier4') return 'text-gray-400'
  return 'text-gray-500'
}

function skinTypeFitBar(fit: Record<string, number> | null, type: string): number {
  if (!fit) return 50
  return Math.round((fit[type] ?? 0.5) * 100)
}

// ── Category labels ──
const CATEGORY_LABELS: Record<NodeCategory, string> = {
  ecommerce: 'E-Commerce',
  marketplace: 'Marketplaces',
  automation: 'Automation',
  productivity: 'Productivity',
  communication: 'Communication',
  database: 'Databases',
  analytics: 'Analytics',
  shipping: 'Shipping & Fulfillment',
  payment: 'Payments',
  other: 'Other',
}

const CATEGORY_ORDER: NodeCategory[] = [
  'ecommerce', 'marketplace', 'automation', 'productivity',
  'communication', 'database', 'analytics', 'shipping', 'payment', 'other',
]

// ── Node Detail Modal ──
const selectedNode = ref<IntegrationNodeDefinition | null>(null)
const showNodeModal = ref(false)

function openNode(node: IntegrationNodeDefinition) {
  selectedNode.value = node
  showNodeModal.value = true
}

function nodeGlyph(icon?: string | null): string {
  if (icon === 'warehouse') return '3PL'
  if (icon === 'api') return 'API'
  if (icon === 'ims') return 'IMS'
  if (icon === 'woocommerce') return 'Woo'
  if (icon === 'shopify') return 'Shop'
  if (icon === 'amazon') return 'AMZ'
  if (icon === 'ebay') return 'eBay'
  if (icon === 'google-sheets') return 'G'
  if (icon === 'notion') return 'N'
  if (icon === 'airtable') return 'Air'
  if (icon === 'slack') return 'Slack'
  if (icon === 'zapier') return 'Zap'
  if (icon === 'n8n') return 'n8n'
  return 'App'
}

// ── Credential Modal ──
const showCredModal = ref(false)
const credModalMode = ref<'create' | 'edit'>('create')
const credEditing = ref<IntegrationCredential | null>(null)
const credForm = reactive({
  nodeDefId: '',
  name: '',
  data: {} as Record<string, any>,
})
const credError = ref('')
const credSaving = ref(false)

function openCreateCredential(nodeDefId?: string) {
  credModalMode.value = 'create'
  credEditing.value = null
  credForm.nodeDefId = nodeDefId || ''
  credForm.name = ''
  credForm.data = {}
  credError.value = ''
  showCredModal.value = true
}

function openEditCredential(cred: IntegrationCredential) {
  credModalMode.value = 'edit'
  credEditing.value = cred
  credForm.nodeDefId = cred.node_def_id
  credForm.name = cred.name
  credForm.data = { ...cred.credential_data }
  credError.value = ''
  showCredModal.value = true
}

const credNodeDef = computed(() =>
  nodeDefinitions.value.find(n => n.id === credForm.nodeDefId),
)

const credSchemaFields = computed<Array<[string, CredentialSchemaProperty]>>(() => {
  const schema = credNodeDef.value?.credential_schema
  if (!schema?.properties) return []
  return Object.entries(schema.properties)
})

async function handleSaveCredential() {
  if (!credForm.name.trim()) {
    credError.value = 'Name is required'
    return
  }
  credSaving.value = true
  credError.value = ''
  try {
    if (credModalMode.value === 'create') {
      await createCredential(credForm.nodeDefId, credForm.name, credForm.data)
    } else if (credEditing.value) {
      await updateCredential(credEditing.value.id, { name: credForm.name, credential_data: credForm.data })
    }
    showCredModal.value = false
  } catch (e: any) {
    credError.value = e.message
  } finally {
    credSaving.value = false
  }
}

async function handleDeleteCredential(cred: IntegrationCredential) {
  if (!confirm(`Delete credential "${cred.name}"? Connections using it will lose their authentication.`)) return
  try { await deleteCredential(cred.id) } catch {}
}

const testingCredentialId = ref<string | null>(null)

function integrationSlug(item: { node_def_id: string; node_definition?: IntegrationNodeDefinition | null }): string {
  return item.node_definition?.slug || nodeDefinitions.value.find(n => n.id === item.node_def_id)?.slug || ''
}

function isWooCommerceCredential(cred: IntegrationCredential): boolean {
  return integrationSlug(cred) === 'woocommerce'
}

function isWooCommerceConnection(conn: IntegrationConnection): boolean {
  return integrationSlug(conn) === 'woocommerce'
}

function isWorldsyntechCredential(cred: IntegrationCredential): boolean {
  return integrationSlug(cred) === 'worldsyntech-ofs'
}

function isWorldsyntechConnection(conn: IntegrationConnection): boolean {
  return integrationSlug(conn) === 'worldsyntech-ofs'
}

async function handleTestCredential(cred: IntegrationCredential) {
  testingCredentialId.value = cred.id
  try {
    const result = await testCredential(cred.id)
    if (!result.valid && result.error) alert(result.error)
  } finally {
    testingCredentialId.value = null
  }
}

// ── Connection Setup Modal ──
const showConnModal = ref(false)
const connForm = reactive({
  nodeDefId: '',
  credentialId: '' as string | null,
  name: '',
  syncDirection: 'push' as 'push' | 'pull' | 'bidirectional',
  syncFrequency: 'manual' as string,
})
const connError = ref('')
const connSaving = ref(false)

function openCreateConnection(nodeDefId?: string) {
  const node = nodeDefinitions.value.find(n => n.id === nodeDefId)
  connForm.nodeDefId = nodeDefId || ''
  connForm.credentialId = null
  connForm.name = node ? `${node.name} Connection` : ''
  connForm.syncDirection = node?.slug === 'woocommerce' || node?.slug === 'worldsyntech-ofs' ? 'pull' : 'push'
  connForm.syncFrequency = 'manual'
  connError.value = ''
  showConnModal.value = true
}

const connNodeDef = computed(() =>
  nodeDefinitions.value.find(n => n.id === connForm.nodeDefId),
)

const connAvailableCreds = computed(() =>
  credentials.value.filter(c => c.node_def_id === connForm.nodeDefId),
)

async function handleSaveConnection() {
  if (!connForm.name.trim() || !connForm.nodeDefId) {
    connError.value = 'Name and node are required'
    return
  }
  connSaving.value = true
  connError.value = ''
  try {
    await createConnection({
      nodeDefId: connForm.nodeDefId,
      credentialId: connForm.credentialId || undefined,
      name: connForm.name,
      syncDirection: connForm.syncDirection,
      syncFrequency: connForm.syncFrequency as any,
    })
    showConnModal.value = false
  } catch (e: any) {
    connError.value = e.message
  } finally {
    connSaving.value = false
  }
}

async function handleDeleteConnection(conn: IntegrationConnection) {
  if (!confirm(`Delete connection "${conn.name}"?`)) return
  try { await deleteConnection(conn.id) } catch {}
}

async function handleToggleConnection(conn: IntegrationConnection) {
  if (conn.status === 'active') {
    await pauseConnection(conn.id)
  } else {
    await activateConnection(conn.id)
  }
}

const pullingConnectionId = ref<string | null>(null)
const pullResults = ref<Record<string, any>>({})
const pullErrors = ref<Record<string, string>>({})
const worldsyntechActionId = ref<string | null>(null)
const worldsyntechActionResults = ref<Record<string, any>>({})
const worldsyntechActionErrors = ref<Record<string, string>>({})

async function handlePullWooCommerce(conn: IntegrationConnection, reset = false) {
  pullingConnectionId.value = conn.id
  pullErrors.value = { ...pullErrors.value, [conn.id]: '' }
  try {
    const result = await pullWooCommerceProducts(conn.id, {
      reset,
      perPage: 100,
      maxPages: 5,
      includeVariations: true,
    })
    pullResults.value = { ...pullResults.value, [conn.id]: result }
    if (activeTab.value === 'executions') await fetchExecutions()
  } catch (e: any) {
    pullErrors.value = {
      ...pullErrors.value,
      [conn.id]: e?.data?.statusMessage || e?.data?.message || e?.message || 'WooCommerce pull failed',
    }
  } finally {
    pullingConnectionId.value = null
  }
}

async function handleSyncWorldsyntechReferenceData(conn: IntegrationConnection) {
  worldsyntechActionId.value = conn.id
  worldsyntechActionErrors.value = { ...worldsyntechActionErrors.value, [conn.id]: '' }
  try {
    const result = await syncWorldsyntechReferenceData(conn.id, { maxPages: 5 })
    worldsyntechActionResults.value = {
      ...worldsyntechActionResults.value,
      [conn.id]: { action: 'reference_data', ...result },
    }
    if (activeTab.value === 'executions') await fetchExecutions()
  } catch (e: any) {
    worldsyntechActionErrors.value = {
      ...worldsyntechActionErrors.value,
      [conn.id]: e?.data?.statusMessage || e?.data?.message || e?.message || 'WorldSyntech/OFS reference sync failed',
    }
  } finally {
    worldsyntechActionId.value = null
  }
}

async function handlePullWorldsyntechInventory(conn: IntegrationConnection, reset = false) {
  worldsyntechActionId.value = conn.id
  worldsyntechActionErrors.value = { ...worldsyntechActionErrors.value, [conn.id]: '' }
  try {
    const result = await pullWorldsyntechInventory(conn.id, {
      reset,
      limit: 250,
    })
    worldsyntechActionResults.value = {
      ...worldsyntechActionResults.value,
      [conn.id]: { action: 'inventory', ...result },
    }
    if (activeTab.value === 'executions') await fetchExecutions()
  } catch (e: any) {
    worldsyntechActionErrors.value = {
      ...worldsyntechActionErrors.value,
      [conn.id]: e?.data?.statusMessage || e?.data?.message || e?.message || 'WorldSyntech/OFS inventory pull failed',
    }
  } finally {
    worldsyntechActionId.value = null
  }
}

function getStatusClass(status: ConnectionStatus) {
  const map: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
    inactive: 'bg-gray-500/10 text-gray-400 ring-gray-500/20',
    paused: 'bg-yellow-500/10 text-yellow-400 ring-yellow-500/20',
    error: 'bg-red-500/10 text-red-400 ring-red-500/20',
  }
  return map[status] || map.inactive
}

function getExecStatusClass(status: string) {
  const map: Record<string, string> = {
    running: 'text-blue-400',
    success: 'text-emerald-400',
    error: 'text-red-400',
    cancelled: 'text-gray-400',
    timeout: 'text-yellow-400',
  }
  return map[status] || 'text-gray-400'
}

function formatDuration(ms: number | null): string {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ── Init ──
onMounted(async () => {
  await loadAll()
})

watch(activeTab, async (tab) => {
  if (tab === 'executions') {
    await fetchExecutions()
  }
})

watch(skincareMode, async (active) => {
  if (active) {
    await Promise.all([loadSkincareStats(), loadSkincareProducts(), loadSkincareJobs()])
    // Auto-start polling if there are running jobs
    const hasRunning = skincareJobs.value.some((j: any) => j.status === 'running' || j.status === 'pending')
    if (hasRunning) startCrawlPolling()
  } else {
    if (crawlPollTimer) { clearInterval(crawlPollTimer); crawlPollTimer = null }
    stopLogPolling()
    skincareTab.value = 'catalog'
  }
})

watch(() => [skincareFilters.source, skincareFilters.subcategory, skincareFilters.concern, skincareFilters.skin_type, skincareFilters.min_ips, skincareFilters.trend, skincareFilters.sort_by, skincareFilters.sort_dir], () => {
  skincareFilters.page = 1
  loadSkincareProducts()
})
</script>

<template>
  <div>
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-white">Integrations</h1>
        <p class="mt-1 text-sm text-gray-400">Connect external systems using the node-based integration framework</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-secondary" @click="openCreateCredential()">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
          </svg>
          New Credential
        </button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="mb-6 flex gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
      <button
        v-for="tab in [
          { key: 'nodes', label: 'Node Catalog' },
          { key: 'connections', label: 'Connections' },
          { key: 'credentials', label: 'Credentials' },
          { key: 'executions', label: 'Execution Log' },
        ]"
        :key="tab.key"
        :class="[
          'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all',
          activeTab === tab.key ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white',
        ]"
        @click="activeTab = tab.key as any"
      >
        {{ tab.label }}
        <span
          v-if="tab.key === 'connections' && connections.length > 0"
          class="ml-1.5 rounded-full bg-indigo-500/10 px-1.5 py-0.5 text-xs text-indigo-400"
        >{{ connections.length }}</span>
      </button>
    </div>

    <!-- ═══ NODE CATALOG ═══ -->
    <div v-if="activeTab === 'nodes' && !skincareMode" class="space-y-8">
      <template v-for="cat in CATEGORY_ORDER" :key="cat">
        <div v-if="nodesByCategory[cat]?.length">
          <h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">{{ CATEGORY_LABELS[cat] }}</h2>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="node in nodesByCategory[cat]"
              :key="node.id"
              class="card p-5 transition-all hover:border-gray-700 cursor-pointer"
              @click="openNode(node)"
            >
              <div class="flex items-start gap-4">
                <div :class="['flex h-10 w-10 items-center justify-center rounded-lg ring-1 ring-inset text-lg', node.color || 'bg-gray-800 text-gray-400']">
                  {{ nodeGlyph(node.icon) }}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <h3 class="font-semibold text-white truncate">{{ node.name }}</h3>
                    <span v-if="node.is_coming_soon" class="shrink-0 rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-400">
                      Soon
                    </span>
                    <span v-if="node.node_type === 'both'" class="shrink-0 rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-400">
                      Trigger + Action
                    </span>
                    <span v-else-if="node.node_type === 'trigger'" class="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                      Trigger
                    </span>
                    <span v-else class="shrink-0 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-400">
                      Action
                    </span>
                  </div>
                  <p class="mt-1 text-sm text-gray-400 line-clamp-2">{{ node.description }}</p>
                </div>
              </div>
              <div class="mt-3 flex items-center gap-2 text-xs text-gray-600">
                <span v-if="node.actions?.length">{{ node.actions.length }} action{{ node.actions.length !== 1 ? 's' : '' }}</span>
                <span v-if="node.actions?.length && node.triggers?.length">&middot;</span>
                <span v-if="node.triggers?.length">{{ node.triggers.length }} trigger{{ node.triggers.length !== 1 ? 's' : '' }}</span>
                <span v-if="node.supports_webhooks">&middot; Webhooks</span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Intelligence Apps ── -->
      <div>
        <h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Intelligence Apps</h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div
            class="card p-5 transition-all hover:border-pink-500/30 cursor-pointer border-pink-500/10"
            @click="skincareMode = true"
          >
            <div class="flex items-start gap-4">
              <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-pink-500/10 ring-1 ring-inset ring-pink-500/20 text-lg">
                🧴
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <h3 class="font-semibold text-white">Skincare Intelligence</h3>
                  <span class="shrink-0 rounded-full bg-pink-500/10 px-2 py-0.5 text-[10px] font-medium text-pink-400">
                    App
                  </span>
                </div>
                <p class="mt-1 text-sm text-gray-400 line-clamp-2">Crawl Hwahae and Olive Young for skincare product data, ingredient analysis, IPS scoring, skin type compatibility, and conflict detection.</p>
              </div>
            </div>
            <div class="mt-3 flex items-center gap-2 text-xs text-gray-600">
              <span>2 sources</span>
              <span>&middot;</span>
              <span>IPS scoring</span>
              <span>&middot;</span>
              <span>Ingredient analysis</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ CONNECTIONS ═══ -->
    <div v-if="activeTab === 'connections'">
      <div v-if="connections.length === 0" class="card p-12 text-center">
        <svg class="mx-auto h-10 w-10 text-gray-700" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
        </svg>
        <h3 class="mt-3 text-lg font-semibold text-white">No connections yet</h3>
        <p class="mt-1 text-sm text-gray-400">Browse the Node Catalog and set up your first connection.</p>
      </div>
      <div v-else class="space-y-4">
        <div v-for="conn in connections" :key="conn.id" class="card p-5">
          <div class="flex items-start justify-between">
            <div class="flex items-start gap-4">
              <div :class="['flex h-10 w-10 items-center justify-center rounded-lg ring-1 ring-inset text-lg', conn.node_definition?.color || 'bg-gray-800']">
                {{ nodeGlyph(conn.node_definition?.icon) }}
              </div>
              <div>
                <h3 class="font-semibold text-white">{{ conn.name }}</h3>
                <p class="text-sm text-gray-400">{{ conn.node_definition?.name || 'Unknown node' }}</p>
                <div class="mt-2 flex items-center gap-3">
                  <span :class="['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset capitalize', getStatusClass(conn.status)]">
                    {{ conn.status }}
                  </span>
                  <span class="text-xs text-gray-600">
                    {{ conn.sync_direction }} &middot; {{ conn.sync_frequency }}
                  </span>
                  <span v-if="conn.last_synced_at" class="text-xs text-gray-600">
                    Last sync: {{ new Date(conn.last_synced_at).toLocaleString() }}
                  </span>
                </div>
                <div v-if="conn.last_error" class="mt-1 text-xs text-red-400">{{ conn.last_error }}</div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                v-if="isWooCommerceConnection(conn)"
                class="btn-ghost text-xs"
                :disabled="pullingConnectionId === conn.id || !conn.credential_id"
                @click="handlePullWooCommerce(conn)"
              >
                {{ pullingConnectionId === conn.id ? 'Pulling...' : ((pullResults[conn.id]?.has_more || conn.config?.woocommerce?.has_more) ? 'Continue pull' : 'Pull products') }}
              </button>
              <button
                v-if="isWooCommerceConnection(conn) && (pullResults[conn.id] || conn.config?.woocommerce?.last_pull_finished_at)"
                class="btn-ghost text-xs"
                :disabled="pullingConnectionId === conn.id || !conn.credential_id"
                @click="handlePullWooCommerce(conn, true)"
              >
                Restart
              </button>
              <button
                v-if="isWorldsyntechConnection(conn)"
                class="btn-ghost text-xs"
                :disabled="worldsyntechActionId === conn.id || !conn.credential_id"
                @click="handleSyncWorldsyntechReferenceData(conn)"
              >
                {{ worldsyntechActionId === conn.id ? 'Running...' : 'Sync refs' }}
              </button>
              <button
                v-if="isWorldsyntechConnection(conn)"
                class="btn-ghost text-xs"
                :disabled="worldsyntechActionId === conn.id || !conn.credential_id"
                @click="handlePullWorldsyntechInventory(conn)"
              >
                {{ worldsyntechActionId === conn.id ? 'Running...' : ((worldsyntechActionResults[conn.id]?.has_more || conn.config?.worldsyntech_ofs?.inventory?.has_more) ? 'Continue inventory' : 'Pull inventory') }}
              </button>
              <button
                v-if="isWorldsyntechConnection(conn) && (worldsyntechActionResults[conn.id] || conn.config?.worldsyntech_ofs?.inventory?.last_pulled_at)"
                class="btn-ghost text-xs"
                :disabled="worldsyntechActionId === conn.id || !conn.credential_id"
                @click="handlePullWorldsyntechInventory(conn, true)"
              >
                Restart inventory
              </button>
              <button
                class="btn-ghost text-xs"
                @click="handleToggleConnection(conn)"
              >
                {{ conn.status === 'active' ? 'Pause' : 'Activate' }}
              </button>
              <button
                class="btn-ghost !p-1.5 text-red-400 hover:text-red-300"
                @click="handleDeleteConnection(conn)"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            </div>
          </div>
          <div v-if="conn.total_synced > 0 || conn.total_errors > 0" class="mt-3 flex gap-4 border-t border-gray-800 pt-3 text-xs">
            <span class="text-gray-500">{{ conn.total_synced }} synced</span>
            <span v-if="conn.total_errors" class="text-red-400">{{ conn.total_errors }} errors</span>
          </div>
          <div v-if="pullResults[conn.id]" class="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
            WooCommerce pull: {{ pullResults[conn.id].created }} created, {{ pullResults[conn.id].updated }} updated, {{ pullResults[conn.id].failed }} failed.
            <span v-if="pullResults[conn.id].has_more"> More products available from page {{ pullResults[conn.id].next_page }}.</span>
          </div>
          <div v-if="pullErrors[conn.id]" class="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
            {{ pullErrors[conn.id] }}
          </div>
          <div v-if="worldsyntechActionResults[conn.id]" class="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-200">
            <template v-if="worldsyntechActionResults[conn.id].action === 'reference_data'">
              OFS refs: {{ worldsyntechActionResults[conn.id].counts?.addresses || 0 }} addresses,
              {{ worldsyntechActionResults[conn.id].counts?.countries || 0 }} countries,
              {{ worldsyntechActionResults[conn.id].counts?.zones || 0 }} zones,
              {{ worldsyntechActionResults[conn.id].counts?.delivery_methods || 0 }} delivery methods.
            </template>
            <template v-else>
              OFS inventory: {{ worldsyntechActionResults[conn.id].fetched || 0 }} fetched, {{ worldsyntechActionResults[conn.id].stored || 0 }} stored.
              <span v-if="worldsyntechActionResults[conn.id].has_more"> More inventory available from offset {{ worldsyntechActionResults[conn.id].next_offset }}.</span>
            </template>
          </div>
          <div v-if="worldsyntechActionErrors[conn.id]" class="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
            {{ worldsyntechActionErrors[conn.id] }}
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ CREDENTIALS ═══ -->
    <div v-if="activeTab === 'credentials'">
      <div v-if="credentials.length === 0" class="card p-12 text-center">
        <svg class="mx-auto h-10 w-10 text-gray-700" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
        </svg>
        <h3 class="mt-3 text-lg font-semibold text-white">No credentials yet</h3>
        <p class="mt-1 text-sm text-gray-400">Credentials are encrypted and stored separately from connections for security.</p>
        <button class="btn-primary mt-4" @click="openCreateCredential()">Create Credential</button>
      </div>
      <div v-else class="space-y-3">
        <div v-for="cred in credentials" :key="cred.id" class="card flex items-center justify-between p-4">
          <div class="flex items-center gap-4">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-800 text-lg">
              <svg class="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
              </svg>
            </div>
            <div>
              <h3 class="font-medium text-white">{{ cred.name }}</h3>
              <p class="text-xs text-gray-500">
                {{ cred.node_definition?.name || 'Unknown' }}
                &middot; Created {{ new Date(cred.created_at).toLocaleDateString() }}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="cred.is_valid === true" class="text-xs text-emerald-400">Verified</span>
            <span v-else-if="cred.is_valid === false" class="text-xs text-red-400">Invalid</span>
            <span v-else class="text-xs text-gray-600">Untested</span>
            <button
              v-if="isWooCommerceCredential(cred) || isWorldsyntechCredential(cred)"
              class="btn-ghost text-xs"
              :disabled="testingCredentialId === cred.id"
              @click="handleTestCredential(cred)"
            >
              {{ testingCredentialId === cred.id ? 'Testing...' : 'Test' }}
            </button>
            <button class="btn-ghost text-xs" @click="openEditCredential(cred)">Edit</button>
            <button class="btn-ghost !p-1.5 text-red-400" @click="handleDeleteCredential(cred)">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ EXECUTION LOG ═══ -->
    <div v-if="activeTab === 'executions'">
      <div v-if="executions.length === 0" class="card p-12 text-center">
        <svg class="mx-auto h-10 w-10 text-gray-700" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
        </svg>
        <h3 class="mt-3 text-lg font-semibold text-white">No executions yet</h3>
        <p class="mt-1 text-sm text-gray-400">Execution logs will appear here when connections run.</p>
      </div>
      <div v-else class="overflow-hidden rounded-lg border border-gray-800">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-800 bg-gray-900/50">
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400">Status</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400">Type</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400">Action / Trigger</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400">Items</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400">Duration</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400">Time</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-800/50">
            <tr v-for="exec in executions" :key="exec.id" class="hover:bg-gray-800/20">
              <td class="px-4 py-3">
                <span :class="['font-medium capitalize', getExecStatusClass(exec.status)]">{{ exec.status }}</span>
              </td>
              <td class="px-4 py-3 text-gray-400 capitalize">{{ exec.execution_type }}</td>
              <td class="px-4 py-3 text-gray-300">{{ exec.action_key || exec.trigger_key || '—' }}</td>
              <td class="px-4 py-3 text-gray-400">
                {{ exec.items_processed }} processed
                <span v-if="exec.items_failed" class="text-red-400">({{ exec.items_failed }} failed)</span>
              </td>
              <td class="px-4 py-3 text-gray-500">{{ formatDuration(exec.duration_ms) }}</td>
              <td class="px-4 py-3 text-gray-600 text-xs">{{ new Date(exec.started_at).toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ═══ SKINCARE INTELLIGENCE APP ═══ -->
    <div v-if="skincareMode" class="space-y-6">
      <!-- Back Button -->
      <button class="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors" @click="skincareMode = false">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
        Back to Node Catalog
      </button>

      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-pink-500/10 ring-1 ring-inset ring-pink-500/20 text-lg">🧴</div>
          <div>
            <h2 class="text-xl font-bold text-white">Skincare Intelligence</h2>
            <p class="text-sm text-gray-400">Crawl, analyze, and score skincare products from Hwahae and Olive Young</p>
          </div>
        </div>
        <!-- Sub-tabs -->
        <div class="flex rounded-lg border border-gray-800 bg-gray-900 p-1 gap-1">
          <button
            :class="['rounded-md px-4 py-1.5 text-sm font-medium transition-all', skincareTab === 'catalog' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white']"
            @click="skincareTab = 'catalog'"
          >Product Catalog</button>
          <button
            :class="['rounded-md px-4 py-1.5 text-sm font-medium transition-all flex items-center gap-1.5', skincareTab === 'url-analyser' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white']"
            @click="skincareTab = 'url-analyser'"
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
            URL Analyser
          </button>
          <button
            :class="['rounded-md px-4 py-1.5 text-sm font-medium transition-all flex items-center gap-1.5', skincareTab === 'methodology' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white']"
            @click="skincareTab = 'methodology'"
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
            Methodology
          </button>
        </div>
      </div>

      <!-- ── CATALOG TAB ── -->
      <template v-if="skincareTab === 'catalog'">

      <!-- Crawl Controls & Stats -->
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="card p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Total Products</p>
          <p class="mt-1 text-2xl font-bold text-white">{{ skincareStats?.total_products ?? '—' }}</p>
          <div class="mt-2 flex gap-3 text-xs text-gray-400">
            <span>Hwahae: {{ skincareStats?.by_source?.hwahae ?? 0 }}</span>
            <span>Olive Young: {{ skincareStats?.by_source?.oliveyoung ?? 0 }}</span>
          </div>
        </div>
        <div class="card p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500">IPS Distribution</p>
          <div class="mt-2 space-y-1">
            <div class="flex items-center justify-between text-xs">
              <span class="text-emerald-400">Clean (85+)</span>
              <span class="text-white font-medium">{{ skincareStats?.ips_distribution?.clean ?? 0 }}</span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-blue-400">Standard (60-84)</span>
              <span class="text-white font-medium">{{ skincareStats?.ips_distribution?.standard ?? 0 }}</span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-amber-400">Caution (30-59)</span>
              <span class="text-white font-medium">{{ skincareStats?.ips_distribution?.caution ?? 0 }}</span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-red-400">Avoid (&lt;30)</span>
              <span class="text-white font-medium">{{ skincareStats?.ips_distribution?.avoid ?? 0 }}</span>
            </div>
          </div>
        </div>
        <div class="card p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Trending</p>
          <p class="mt-1 text-2xl font-bold text-emerald-400">{{ skincareStats?.trending_products ?? 0 }}</p>
          <p class="mt-1 text-xs text-gray-400">Products with rising ingredients</p>
        </div>
        <div class="card p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Actions</p>
          <div class="mt-2 flex flex-col gap-1.5">
            <button class="btn-ghost !py-1 !px-2 !text-xs self-start" @click="refreshSkincare()">Refresh Data</button>
          </div>
        </div>
      </div>

      <!-- ── Crawl Batch Selector ── -->
      <div class="card overflow-hidden">
        <div class="flex items-center justify-between border-b border-gray-800 bg-gray-900/50 px-4 py-3">
          <h3 class="text-sm font-semibold text-white">Crawl Batch</h3>
          <div class="flex items-center gap-2">
            <!-- Source toggle -->
            <button
              v-for="src in (['hwahae', 'oliveyoung'] as const)"
              :key="src"
              :class="[
                'rounded-md px-3 py-1 text-xs font-medium transition-all',
                crawlSource === src
                  ? (src === 'hwahae' ? 'bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30' : 'bg-green-500/15 text-green-400 ring-1 ring-green-500/30')
                  : 'text-gray-500 hover:text-gray-300'
              ]"
              @click="crawlSource = src"
            >
              {{ src === 'hwahae' ? 'Hwahae' : 'Olive Young' }}
            </button>
          </div>
        </div>

        <div class="p-4 space-y-4">
          <!-- Skincare categories -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Skincare</span>
              <button class="text-[10px] text-indigo-400 hover:text-indigo-300" @click="selectAllCategories('skincare')">Select all</button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="cat in crawlSkincareCategories"
                :key="cat.id"
                :class="[
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-all ring-1 ring-inset',
                  crawlSelectedCategories.includes(cat.id)
                    ? 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30'
                    : 'bg-gray-800/50 text-gray-500 ring-gray-700/50 hover:text-gray-300 hover:ring-gray-600'
                ]"
                @click="toggleCategory(cat.id)"
              >
                {{ cat.label }}
              </button>
            </div>
          </div>

          <!-- Makeup categories -->
          <div v-if="crawlMakeupCategories.length">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Makeup</span>
              <button class="text-[10px] text-indigo-400 hover:text-indigo-300" @click="selectAllCategories('makeup')">Select all</button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="cat in crawlMakeupCategories"
                :key="cat.id"
                :class="[
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-all ring-1 ring-inset',
                  crawlSelectedCategories.includes(cat.id)
                    ? 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30'
                    : 'bg-gray-800/50 text-gray-500 ring-gray-700/50 hover:text-gray-300 hover:ring-gray-600'
                ]"
                @click="toggleCategory(cat.id)"
              >
                {{ cat.label }}
              </button>
            </div>
          </div>

          <!-- Extra categories (OY only) -->
          <div v-if="crawlExtraCategories.length">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Other</span>
              <button class="text-[10px] text-indigo-400 hover:text-indigo-300" @click="selectAllCategories('extra')">Select all</button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="cat in crawlExtraCategories"
                :key="cat.id"
                :class="[
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-all ring-1 ring-inset',
                  crawlSelectedCategories.includes(cat.id)
                    ? 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30'
                    : 'bg-gray-800/50 text-gray-500 ring-gray-700/50 hover:text-gray-300 hover:ring-gray-600'
                ]"
                @click="toggleCategory(cat.id)"
              >
                {{ cat.label }}
              </button>
            </div>
          </div>

          <!-- Options + Run -->
          <div class="flex items-center justify-between border-t border-gray-800/50 pt-3">
            <div class="flex items-center gap-4">
              <label class="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                <input type="checkbox" v-model="crawlDetailPages" class="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0 h-3.5 w-3.5" />
                Scrape detail pages
              </label>
              <span class="text-[10px] text-gray-600">{{ crawlSelectedCategories.length }} selected</span>
              <button v-if="crawlSelectedCategories.length > 0" class="text-[10px] text-gray-500 hover:text-gray-300" @click="deselectAllCategories()">Clear</button>
            </div>
            <button
              class="btn-primary !py-1.5 !px-4 !text-xs"
              :disabled="skincareCrawling || crawlSelectedCategories.length === 0"
              @click="startCrawl()"
            >
              {{ skincareCrawling ? 'Starting...' : `Crawl ${crawlSelectedCategories.length} categor${crawlSelectedCategories.length === 1 ? 'y' : 'ies'}` }}
            </button>
          </div>
        </div>
      </div>

      <!-- Active/Recent Crawl Jobs -->
      <div v-if="skincareJobs.length > 0" class="card overflow-hidden">
        <div class="border-b border-gray-800 bg-gray-900/50 px-4 py-3">
          <h3 class="text-sm font-semibold text-white">Recent Crawl Jobs</h3>
        </div>
        <div class="divide-y divide-gray-800/50">
          <div v-for="job in skincareJobs.slice(0, 5)" :key="job.id" class="px-4 py-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <span :class="[
                  'inline-flex h-2 w-2 rounded-full',
                  job.status === 'running' ? 'bg-blue-400 animate-pulse' :
                  job.status === 'completed' ? 'bg-emerald-400' :
                  job.status === 'failed' ? 'bg-red-400' : 'bg-gray-500'
                ]" />
                <span class="text-sm text-white capitalize">{{ job.source }}</span>
                <span class="text-xs text-gray-500">{{ job.job_type }}</span>
              </div>
              <div class="flex items-center gap-4 text-xs text-gray-400">
                <span v-if="job.status === 'running'">
                  {{ job.processed_products }}/{{ job.total_products }} products
                  <span v-if="job.current_category" class="text-gray-500">({{ job.current_category }})</span>
                </span>
                <span v-else>
                  {{ job.processed_products }}/{{ job.total_products }} products
                  <span v-if="job.failed_products > 0" class="text-red-400">({{ job.failed_products }} failed)</span>
                </span>
                <span :class="[
                  'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                  job.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                  job.status === 'running' ? 'bg-blue-500/10 text-blue-400' :
                  job.status === 'failed' ? 'bg-red-500/10 text-red-400' : 'bg-gray-800 text-gray-500'
                ]">{{ job.status }}</span>
              </div>
            </div>
            <p v-if="job.error" class="mt-1 text-xs text-red-400/70 truncate pl-5">{{ job.error }}</p>
            <button
              class="mt-1 pl-5 text-[10px] text-indigo-400 hover:text-indigo-300"
              @click.stop="viewLogs(job.id)"
            >View Logs</button>
          </div>
        </div>
      </div>

      <!-- ── Crawl Log Viewer ── -->
      <div v-if="crawlLogJobId" class="card overflow-hidden">
        <div class="flex items-center justify-between border-b border-gray-800 bg-gray-900/50 px-4 py-2">
          <h3 class="text-xs font-semibold text-white font-mono">
            Crawl Log
            <span class="text-gray-500 ml-2">{{ crawlLogJobId.slice(0, 8) }}...</span>
          </h3>
          <div class="flex items-center gap-3">
            <span class="text-[10px] text-gray-500">{{ crawlLogs.length }} lines</span>
            <button class="text-[10px] text-gray-400 hover:text-white" @click="stopLogPolling()">Close</button>
          </div>
        </div>
        <div
          id="crawl-log-container"
          class="max-h-64 overflow-y-auto bg-gray-950 p-3 font-mono text-[11px] leading-relaxed"
        >
          <div v-if="crawlLogs.length === 0" class="text-gray-600">Waiting for logs...</div>
          <div
            v-for="(entry, idx) in crawlLogs"
            :key="idx"
            class="flex gap-2"
          >
            <span class="shrink-0 text-gray-600">{{ entry.timestamp.slice(11, 19) }}</span>
            <span :class="[
              'shrink-0 w-8 text-right uppercase',
              logLevelColor(entry.level)
            ]">{{ entry.level === 'info' ? 'INF' : entry.level === 'warn' ? 'WRN' : 'ERR' }}</span>
            <span :class="logLevelColor(entry.level)">{{ entry.message }}</span>
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="flex flex-wrap gap-2">
        <select v-model="skincareFilters.source" class="input-field !w-auto !py-1.5 !px-2.5 !text-xs">
          <option value="">All Sources</option>
          <option value="hwahae">Hwahae</option>
          <option value="oliveyoung">Olive Young</option>
        </select>
        <select v-model="skincareFilters.subcategory" class="input-field !w-auto !py-1.5 !px-2.5 !text-xs">
          <option value="">All Categories</option>
          <option value="toner">Toner</option>
          <option value="serum">Serum</option>
          <option value="cream">Cream</option>
          <option value="cleanser">Cleanser</option>
          <option value="suncare">Sun Care</option>
          <option value="mask">Mask</option>
          <option value="moisturizers">Moisturizers</option>
          <option value="emulsion">Emulsion</option>
          <option value="eye_cream">Eye Cream</option>
          <option value="lip_care">Lip Care</option>
          <option value="peeling">Peeling</option>
        </select>
        <select v-model="skincareFilters.concern" class="input-field !w-auto !py-1.5 !px-2.5 !text-xs">
          <option value="">All Concerns</option>
          <option value="hydration">Hydration</option>
          <option value="soothing">Soothing</option>
          <option value="brightening">Brightening</option>
          <option value="anti_aging">Anti-Aging</option>
          <option value="pore_care">Pore Care</option>
          <option value="acne">Acne</option>
          <option value="exfoliation">Exfoliation</option>
          <option value="moisturizing">Moisturizing</option>
        </select>
        <select v-model="skincareFilters.skin_type" class="input-field !w-auto !py-1.5 !px-2.5 !text-xs">
          <option value="">All Skin Types</option>
          <option value="dry">Dry Skin</option>
          <option value="oily">Oily Skin</option>
          <option value="combination">Combination</option>
          <option value="sensitive">Sensitive</option>
          <option value="acne">Acne-Prone</option>
        </select>
        <select v-model="skincareFilters.trend" class="input-field !w-auto !py-1.5 !px-2.5 !text-xs">
          <option value="">All Trends</option>
          <option value="rising">Rising</option>
          <option value="stable">Stable</option>
          <option value="declining">Declining</option>
        </select>
        <input
          v-model="skincareFilters.search"
          type="text"
          placeholder="Search products..."
          class="input-field !w-48 !py-1.5 !px-2.5 !text-xs"
          @keyup.enter="loadSkincareProducts()"
        />
        <select v-model="skincareFilters.sort_by" class="input-field !w-auto !py-1.5 !px-2.5 !text-xs">
          <option value="ips_score">Sort by IPS</option>
          <option value="rating">Sort by Rating</option>
          <option value="review_count">Sort by Reviews</option>
          <option value="price">Sort by Price</option>
          <option value="crawled_at">Sort by Date</option>
        </select>
      </div>

      <!-- Product Table -->
      <div class="overflow-hidden rounded-lg border border-gray-800">
        <div v-if="skincareLoading" class="p-12 text-center text-gray-500">Loading products...</div>
        <div v-else-if="skincareProducts.length === 0" class="p-12 text-center">
          <h3 class="text-lg font-semibold text-white">No products yet</h3>
          <p class="mt-1 text-sm text-gray-400">Start a crawl to discover skincare products from Hwahae or Olive Young.</p>
        </div>
        <table v-else class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-800 bg-gray-900/50">
              <th class="px-3 py-3 text-left text-xs font-medium text-gray-400">Product</th>
              <th class="px-3 py-3 text-left text-xs font-medium text-gray-400">Source</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-400">IPS</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-400">Rating</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-400">Reviews</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-400">Top Tier</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-400">Trend</th>
              <th class="px-3 py-3 text-left text-xs font-medium text-gray-400">Concerns</th>
              <th class="px-3 py-3 text-left text-xs font-medium text-gray-400">Skin Fit</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-800/50">
            <tr
              v-for="product in skincareProducts"
              :key="product.id"
              class="cursor-pointer hover:bg-gray-800/20 transition-colors"
              @click="openSkincareProduct(product)"
            >
              <td class="px-3 py-3">
                <div class="flex items-center gap-3">
                  <img
                    v-if="product.image_url"
                    :src="product.image_url"
                    class="h-10 w-10 rounded-lg object-cover bg-gray-800"
                    loading="lazy"
                  />
                  <div class="h-10 w-10 rounded-lg bg-gray-800" v-else />
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-white max-w-[280px]">{{ product.product_name }}</p>
                    <p class="text-xs text-gray-500">{{ product.brand_name || 'Unknown Brand' }}</p>
                  </div>
                </div>
              </td>
              <td class="px-3 py-3">
                <span :class="[
                  'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                  product.source === 'hwahae' ? 'bg-pink-500/10 text-pink-400' : 'bg-green-500/10 text-green-400'
                ]">{{ product.source === 'hwahae' ? 'HH' : 'OY' }}</span>
              </td>
              <td class="px-3 py-3 text-center">
                <span :class="['rounded-full px-2 py-0.5 text-xs font-semibold', ipsBg(product.ips_score), ipsColor(product.ips_score)]">
                  {{ product.ips_score ?? '—' }}
                </span>
              </td>
              <td class="px-3 py-3 text-center text-gray-300">
                {{ product.rating ? product.rating.toFixed(1) : '—' }}
              </td>
              <td class="px-3 py-3 text-center text-gray-400">
                {{ product.review_count ? product.review_count.toLocaleString() : '—' }}
              </td>
              <td class="px-3 py-3 text-center">
                <span :class="tierColor(product.top_tier_ingredient)" class="text-xs font-medium">
                  {{ tierLabel(product.top_tier_ingredient) }}
                </span>
              </td>
              <td class="px-3 py-3 text-center">
                <span :class="trendColor(product.ingredient_trend_signal)" class="text-sm">
                  {{ trendIcon(product.ingredient_trend_signal) }}
                </span>
              </td>
              <td class="px-3 py-3">
                <div class="flex flex-wrap gap-1">
                  <span
                    v-for="tag in (product.concern_tags || []).slice(0, 3)"
                    :key="tag"
                    class="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400"
                  >{{ tag.replace('_', ' ') }}</span>
                </div>
              </td>
              <td class="px-3 py-3">
                <div v-if="product.skin_type_fit" class="flex gap-1">
                  <div
                    v-for="type in ['dry', 'oily', 'sensitive']"
                    :key="type"
                    class="flex flex-col items-center"
                  >
                    <div class="h-4 w-1.5 rounded-full bg-gray-800 overflow-hidden">
                      <div
                        :style="{ height: skinTypeFitBar(product.skin_type_fit, type) + '%' }"
                        :class="[
                          'w-full rounded-full transition-all',
                          skinTypeFitBar(product.skin_type_fit, type) > 70 ? 'bg-emerald-400' :
                          skinTypeFitBar(product.skin_type_fit, type) > 40 ? 'bg-blue-400' : 'bg-gray-600'
                        ]"
                      />
                    </div>
                    <span class="mt-0.5 text-[8px] text-gray-600">{{ type[0].toUpperCase() }}</span>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="skincareProductsTotal > 50" class="flex items-center justify-between text-sm">
        <p class="text-gray-500">{{ skincareProductsTotal }} products total</p>
        <div class="flex gap-2">
          <button
            class="btn-ghost !py-1 !px-3 !text-xs"
            :disabled="skincareFilters.page <= 1"
            @click="skincareFilters.page--; loadSkincareProducts()"
          >Previous</button>
          <span class="py-1 px-2 text-xs text-gray-400">Page {{ skincareFilters.page }}</span>
          <button
            class="btn-ghost !py-1 !px-3 !text-xs"
            :disabled="skincareFilters.page * 50 >= skincareProductsTotal"
            @click="skincareFilters.page++; loadSkincareProducts()"
          >Next</button>
        </div>
      </div>

      </template>
      <!-- ── END CATALOG TAB ── -->

      <!-- ── URL ANALYSER TAB ── -->
      <template v-if="skincareTab === 'url-analyser'">
        <!-- Input bar -->
        <div class="card overflow-hidden">
          <div class="border-b border-gray-800 bg-gray-900/50 px-5 py-4">
            <div class="flex gap-3">
              <div class="relative flex-1">
                <input
                  v-model="uaInput"
                  type="url"
                  placeholder="https://www.hwahae.com/en/products/... or sephora.sg/product/..."
                  class="input-field w-full pl-4 pr-36"
                  :disabled="uaChecking"
                  @keydown.enter="runUaCheck"
                />
                <div v-if="uaDetectedPlatform" class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <span class="rounded border px-2 py-0.5 text-xs font-medium" :class="uaDetectedPlatform.color">
                    {{ uaDetectedPlatform.label }}
                  </span>
                </div>
              </div>
              <button
                class="btn-primary flex shrink-0 items-center gap-2"
                :disabled="!uaInput.trim() || uaChecking"
                @click="runUaCheck"
              >
                <svg v-if="uaChecking" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
                </svg>
                <svg v-else class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                </svg>
                {{ uaChecking ? 'Analysing...' : 'Analyse' }}
              </button>
              <button v-if="uaResult" class="btn-secondary text-sm" @click="resetUaCheck">New URL</button>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <span v-if="uaChecking" class="text-xs text-indigo-400 animate-pulse">Fetching page → extracting data → scoring competitiveness...</span>
              <span v-else-if="uaError" class="text-xs text-red-400">{{ uaError }}</span>
              <template v-else-if="!uaResult">
                <span class="text-xs text-gray-600 mr-1">Supports:</span>
                <span v-for="p in URL_CHECK_PLATFORMS" :key="p.key" class="rounded border px-1.5 py-0.5 text-xs" :class="p.color">{{ p.label }}</span>
              </template>
              <template v-else>
                <span class="text-xs text-gray-500">Analysed · Not saved</span>
                <span v-if="uaSavedProductId" class="ml-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                  ✓ Saved
                  <NuxtLink :to="`/products/${uaSavedProductId}`" class="ml-1 underline">View product →</NuxtLink>
                </span>
              </template>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div v-if="!uaResult && !uaChecking" class="flex flex-col items-center justify-center py-20 text-center">
          <div class="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-700 bg-gray-800">
            <svg class="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
          </div>
          <p class="text-base font-semibold text-white">Paste any product URL above</p>
          <p class="mt-1 text-sm text-gray-500">Extracts rating, price, ingredients, popularity and scores competitive position</p>
          <div class="mt-8 grid grid-cols-2 gap-3 text-left sm:grid-cols-4">
            <div v-for="p in URL_CHECK_PLATFORMS" :key="p.key" class="rounded-lg border border-gray-700/60 bg-gray-800/30 p-3">
              <span class="inline-flex rounded border px-1.5 py-0.5 text-xs mb-2" :class="p.color">{{ p.label }}</span>
              <p class="text-xs text-gray-600">{{ p.domain }}</p>
            </div>
          </div>
        </div>

        <!-- Loading skeleton -->
        <div v-else-if="uaChecking" class="space-y-4">
          <div class="h-28 animate-pulse rounded-xl bg-gray-800" />
          <div class="grid grid-cols-4 gap-3">
            <div v-for="i in 4" :key="i" class="h-20 animate-pulse rounded-lg bg-gray-800" />
          </div>
          <div class="h-32 animate-pulse rounded-lg bg-gray-800" />
        </div>

        <!-- Results -->
        <div v-else-if="uaResult" class="space-y-4">
          <!-- Product card -->
          <div class="rounded-xl border border-gray-700 bg-gray-800/50 p-5">
            <div class="flex items-start gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-2 mb-2">
                  <span class="rounded border px-2 py-0.5 text-xs font-medium" :class="uaPlatformColor(uaResult.platform?.key)">{{ uaResult.platform?.label ?? 'Unknown' }}</span>
                  <span v-if="uaResult.html_fetched" class="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">Page fetched</span>
                  <span v-else class="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">AI knowledge</span>
                  <span v-if="uaResult.scope?.data_quality === 'high'" class="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">High confidence</span>
                  <span v-else-if="uaResult.scope?.data_quality === 'medium'" class="rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">Partial data</span>
                </div>
                <h2 class="text-lg font-bold text-white leading-snug">{{ uaResult.product?.name ?? '—' }}</h2>
                <p class="mt-0.5 text-sm text-gray-400">{{ uaResult.product?.brand ?? '—' }}</p>
                <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                  <div v-if="uaResult.product?.price_sgd" class="flex items-baseline gap-1">
                    <span class="text-xs text-gray-500">SGD</span>
                    <span class="font-bold text-white">{{ Number(uaResult.product.price_sgd).toFixed(2) }}</span>
                  </div>
                  <div v-else-if="uaResult.product?.price_original" class="flex items-baseline gap-1">
                    <span class="text-xs text-gray-500">{{ uaResult.product.price_original_currency }}</span>
                    <span class="font-bold text-white">{{ uaResult.product.price_original }}</span>
                  </div>
                  <div v-if="uaResult.product?.rating" class="flex items-center gap-0.5">
                    <span class="text-yellow-400">★</span>
                    <span class="font-semibold text-white">{{ Number(uaResult.product.rating).toFixed(1) }}</span>
                  </div>
                  <div v-if="uaResult.product?.review_count" class="flex items-center gap-1 text-gray-300">
                    <span class="text-xs text-gray-500">Reviews</span>
                    <span>{{ uaResult.product.review_count >= 1000 ? (uaResult.product.review_count / 1000).toFixed(1) + 'k' : uaResult.product.review_count }}</span>
                  </div>
                  <div v-if="uaResult.product?.sold_in_30_days" class="flex items-center gap-1 text-gray-300">
                    <span class="text-xs text-gray-500">30d sales</span><span class="font-semibold">{{ uaResult.product.sold_in_30_days >= 1000 ? (uaResult.product.sold_in_30_days / 1000).toFixed(1) + 'k+' : uaResult.product.sold_in_30_days + '+' }}</span>
                  </div>
                  <div v-else-if="uaResult.product?.units_sold_label" class="flex items-center gap-1 text-gray-300">
                    <span class="text-xs text-gray-500">Sold</span><span>{{ uaResult.product.units_sold_label }}</span>
                  </div>
                  <div v-if="uaResult.product?.rank_in_category" class="text-gray-300">
                    <span class="text-xs text-gray-500">Rank </span>#{{ uaResult.product.rank_in_category }}
                  </div>
                  <div v-if="uaResult.product?.volume_size" class="text-gray-400">{{ uaResult.product.volume_size }}</div>
                </div>
              </div>
              <div class="shrink-0">
                <div class="flex h-20 w-20 flex-col items-center justify-center rounded-2xl border-2" :class="uaScBg(uaResult.analysis?.overall_score)">
                  <span class="text-3xl font-black leading-none" :class="uaSc(uaResult.analysis?.overall_score)">{{ uaResult.analysis?.overall_score ?? '—' }}</span>
                  <span class="text-xs text-gray-600 mt-0.5">/ 100</span>
                </div>
                <p class="mt-1 text-center text-xs text-gray-600">Overall</p>
              </div>
            </div>
          </div>

          <!-- Score breakdown: 4 methodology-aligned scores -->
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div v-for="{ label, val, sub } in [
              { label: 'Ingredient Quality (IPS)', val: uaResult.analysis?.ingredient_score, sub: uaResult.analysis?.skincare?.top_tier_ingredient ? ('Best: ' + uaResult.analysis.skincare.top_tier_ingredient) : null },
              { label: 'Rating & Reviews', val: uaResult.analysis?.rating_score, sub: uaResult.product?.rating ? (Number(uaResult.product.rating).toFixed(1) + '★ / ' + (uaResult.product.review_count ?? 0) + ' reviews') : null },
              { label: 'Demand Signal', val: uaResult.analysis?.popularity_score, sub: uaResult.analysis?.lifecycle_stage ? uaResult.analysis.lifecycle_stage.replace('_', ' ').toUpperCase() : null },
              { label: 'Value (Alpha proxy)', val: uaResult.analysis?.value_score, sub: uaResult.product?.volume_size ?? null },
            ]" :key="label" class="rounded-xl border p-4 text-center" :class="uaScBg(val)">
              <div class="text-2xl font-bold" :class="uaSc(val)">{{ val ?? '—' }}</div>
              <div class="mt-1 text-xs text-gray-500">{{ label }}</div>
              <div v-if="sub" class="mt-1 text-xs text-gray-600">{{ sub }}</div>
            </div>
          </div>

          <!-- Skincare Intelligence Panel -->
          <div v-if="uaResult.analysis?.skincare" class="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5 space-y-4">
            <p class="text-xs font-semibold uppercase tracking-wider text-violet-400">Skincare Intelligence</p>

            <!-- Skin Type Fit -->
            <div v-if="uaResult.analysis.skincare.skin_type_fit">
              <p class="mb-2 text-xs text-gray-500">Skin Type Fit (from ingredient analysis)</p>
              <div class="flex flex-wrap gap-2">
                <div v-for="(val, type) in uaResult.analysis.skincare.skin_type_fit" :key="type"
                  class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5"
                  :class="Number(val) >= 0.7 ? 'border-emerald-500/30 bg-emerald-500/10' : Number(val) >= 0.4 ? 'border-yellow-500/20 bg-yellow-500/5' : 'border-gray-700 bg-gray-800/30'">
                  <span class="text-xs font-medium" :class="Number(val) >= 0.7 ? 'text-emerald-300' : Number(val) >= 0.4 ? 'text-yellow-300' : 'text-gray-500'">
                    {{ String(type).charAt(0).toUpperCase() + String(type).slice(1) }}
                  </span>
                  <span class="text-xs font-mono" :class="Number(val) >= 0.7 ? 'text-emerald-400' : Number(val) >= 0.4 ? 'text-yellow-400' : 'text-gray-600'">
                    {{ (Number(val) * 100).toFixed(0) }}%
                  </span>
                </div>
              </div>
            </div>

            <!-- Concern Tags -->
            <div v-if="uaResult.analysis.skincare.concern_tags?.length">
              <p class="mb-2 text-xs text-gray-500">Concerns Addressed (matched from ingredients)</p>
              <div class="flex flex-wrap gap-1.5">
                <span v-for="c in uaResult.analysis.skincare.concern_tags" :key="c"
                  class="rounded-full bg-purple-500/10 border border-purple-500/20 px-3 py-0.5 text-xs text-purple-300">
                  {{ c.replace('_', ' ') }}
                </span>
              </div>
            </div>

            <!-- Ingredient Trend Signal -->
            <div v-if="uaResult.analysis.skincare.ingredient_trend_signal" class="flex items-center gap-2">
              <span class="text-xs text-gray-500">Ingredient Trend:</span>
              <span class="rounded-full px-2.5 py-0.5 text-xs font-medium"
                :class="uaResult.analysis.skincare.ingredient_trend_signal === 'rising' ? 'bg-green-500/20 text-green-300' : uaResult.analysis.skincare.ingredient_trend_signal === 'stable' ? 'bg-gray-500/20 text-gray-300' : 'bg-red-500/20 text-red-300'">
                {{ uaResult.analysis.skincare.ingredient_trend_signal.toUpperCase() }}
              </span>
            </div>

            <!-- Conflict Flags -->
            <div v-if="uaResult.analysis.skincare.conflict_flags?.length">
              <p class="mb-2 text-xs text-red-400 font-medium">Conflict Flags</p>
              <div class="space-y-1.5">
                <div v-for="flag in uaResult.analysis.skincare.conflict_flags" :key="flag.family"
                  class="flex items-start gap-2 rounded border border-red-500/20 bg-red-500/5 px-3 py-2">
                  <span class="shrink-0 text-red-400 mt-0.5 text-xs">⚠</span>
                  <div>
                    <span class="text-xs font-medium text-red-300">{{ flag.family.replace(/_/g, ' ') }}</span>
                    <span class="text-xs text-gray-500"> — found: {{ flag.ingredients.join(', ') }}</span>
                  </div>
                </div>
              </div>
            </div>

            <p class="text-xs text-gray-600">{{ uaResult.analysis.skincare.ingredients_matched ?? 0 }} ingredients scored against safety database</p>
          </div>

          <!-- Position + Lifecycle + availability -->
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="rounded-lg border border-gray-700 bg-gray-800/30 p-4">
              <p class="mb-2.5 text-xs font-semibold uppercase tracking-wider text-gray-500">Competitive Position</p>
              <span class="inline-flex items-center rounded-full border px-4 py-1.5 text-sm font-medium" :class="uaPosClass(uaResult.analysis?.competitive_position)">
                {{ uaPosText(uaResult.analysis?.competitive_position) }}
              </span>
            </div>
            <div v-if="uaResult.analysis?.lifecycle_stage" class="rounded-lg border border-gray-700 bg-gray-800/30 p-4">
              <p class="mb-2.5 text-xs font-semibold uppercase tracking-wider text-gray-500">Lifecycle Stage</p>
              <span class="inline-flex items-center rounded-full border px-4 py-1.5 text-sm font-medium"
                :class="{
                  'border-violet-500/30 bg-violet-500/10 text-violet-300': uaResult.analysis.lifecycle_stage === 'launch',
                  'border-green-500/30 bg-green-500/10 text-green-300': uaResult.analysis.lifecycle_stage === 'rising',
                  'border-blue-500/30 bg-blue-500/10 text-blue-300': uaResult.analysis.lifecycle_stage === 'mature',
                  'border-yellow-500/30 bg-yellow-500/10 text-yellow-300': uaResult.analysis.lifecycle_stage === 'hall_of_fame',
                  'border-red-500/30 bg-red-500/10 text-red-300': uaResult.analysis.lifecycle_stage === 'declining',
                  'border-gray-600 bg-gray-800 text-gray-400': !['launch','rising','mature','hall_of_fame','declining'].includes(uaResult.analysis.lifecycle_stage),
                }">
                {{ uaResult.analysis.lifecycle_stage.replace('_', ' ').toUpperCase() }}
              </span>
            </div>
            <div v-if="uaResult.product?.availability" class="rounded-lg border border-gray-700 bg-gray-800/30 p-4">
              <p class="mb-2.5 text-xs font-semibold uppercase tracking-wider text-gray-500">Availability</p>
              <span class="inline-flex rounded-full px-4 py-1.5 text-sm"
                :class="uaResult.product.availability === 'in_stock' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-400'">
                {{ uaResult.product.availability === 'in_stock' ? 'In Stock' : uaResult.product.availability }}
              </span>
            </div>
          </div>

          <!-- AI Assessment -->
          <div class="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5 space-y-3">
            <p class="text-xs font-semibold uppercase tracking-wider text-indigo-400">AI Assessment</p>
            <p v-if="uaResult.analysis?.market_context" class="text-sm text-gray-300 leading-relaxed">{{ uaResult.analysis.market_context }}</p>
            <div v-if="uaResult.analysis?.sg_market_fit" class="border-t border-indigo-500/20 pt-3">
              <p class="mb-1 text-xs font-medium text-indigo-300">SG Market Fit</p>
              <p class="text-sm text-gray-300 leading-relaxed">{{ uaResult.analysis.sg_market_fit }}</p>
            </div>
          </div>

          <!-- Product profile: ingredients & claims -->
          <div v-if="uaResult.product?.skin_types?.length || uaResult.product?.concerns?.length || uaResult.product?.notable_ingredients?.length || uaResult.product?.key_claims?.length || uaResult.product?.ingredients_full?.length"
            class="rounded-xl border border-gray-700 bg-gray-800/30 p-5 space-y-4">
            <p class="text-xs font-semibold uppercase tracking-wider text-gray-500">Product Profile</p>
            <div v-if="uaResult.product?.skin_types?.length">
              <p class="mb-1.5 text-xs text-gray-500">Skin types (from listing)</p>
              <div class="flex flex-wrap gap-1.5">
                <span v-for="s in uaResult.product.skin_types" :key="s" class="rounded-full bg-blue-500/10 border border-blue-500/20 px-3 py-0.5 text-xs text-blue-300">{{ s }}</span>
              </div>
            </div>
            <div v-if="uaResult.product?.concerns?.length">
              <p class="mb-1.5 text-xs text-gray-500">Concerns (from listing)</p>
              <div class="flex flex-wrap gap-1.5">
                <span v-for="c in uaResult.product.concerns" :key="c" class="rounded-full bg-purple-500/10 border border-purple-500/20 px-3 py-0.5 text-xs text-purple-300">{{ c }}</span>
              </div>
            </div>
            <div v-if="uaResult.product?.notable_ingredients?.length">
              <p class="mb-1.5 text-xs text-gray-500">Hero ingredients</p>
              <div class="flex flex-wrap gap-1.5">
                <span v-for="i in uaResult.product.notable_ingredients" :key="i" class="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-0.5 text-xs text-emerald-300">{{ i }}</span>
              </div>
            </div>
            <div v-if="uaResult.product?.ingredients_full?.length">
              <p class="mb-1.5 text-xs text-gray-500">Full INCI list <span class="text-gray-600">({{ uaResult.product.ingredients_full.length }} ingredients)</span></p>
              <div class="max-h-32 overflow-y-auto rounded bg-gray-900 px-3 py-2">
                <p class="text-xs text-gray-400 leading-relaxed">{{ uaResult.product.ingredients_full.join(', ') }}</p>
              </div>
            </div>
            <div v-if="uaResult.product?.key_claims?.length">
              <p class="mb-1.5 text-xs text-gray-500">Key claims</p>
              <div class="flex flex-wrap gap-1.5">
                <span v-for="c in uaResult.product.key_claims" :key="c" class="rounded bg-gray-700 px-2.5 py-0.5 text-xs text-gray-300">{{ c }}</span>
              </div>
            </div>
            <div v-if="uaResult.product?.certifications?.length">
              <p class="mb-1.5 text-xs text-gray-500">Certifications</p>
              <div class="flex flex-wrap gap-1.5">
                <span v-for="c in uaResult.product.certifications" :key="c" class="rounded-full bg-teal-500/10 border border-teal-500/20 px-3 py-0.5 text-xs text-teal-300">{{ c }}</span>
              </div>
            </div>
            <div v-if="uaResult.product?.awards_badges?.length">
              <p class="mb-1.5 text-xs text-gray-500">Awards & badges</p>
              <div class="flex flex-wrap gap-1.5">
                <span v-for="a in uaResult.product.awards_badges" :key="a" class="rounded-full bg-yellow-500/10 border border-yellow-500/20 px-3 py-0.5 text-xs text-yellow-300">{{ a }}</span>
              </div>
            </div>
            <!-- Metadata row: UPC, category, package qty -->
            <div v-if="uaResult.product?.upc || uaResult.product?.category || uaResult.product?.package_quantity" class="flex flex-wrap gap-x-6 gap-y-2 border-t border-gray-700 pt-3">
              <div v-if="uaResult.product.upc">
                <span class="text-xs text-gray-500">UPC</span>
                <p class="text-xs font-mono text-gray-300">{{ uaResult.product.upc }}</p>
              </div>
              <div v-if="uaResult.product.package_quantity">
                <span class="text-xs text-gray-500">Package</span>
                <p class="text-xs text-gray-300">{{ uaResult.product.package_quantity }}</p>
              </div>
              <div v-if="uaResult.product.category">
                <span class="text-xs text-gray-500">Category</span>
                <p class="text-xs text-gray-300">{{ uaResult.product.category }}</p>
              </div>
            </div>
          </div>

          <!-- Strengths & weaknesses -->
          <div v-if="uaResult.analysis?.strengths?.length || uaResult.analysis?.weaknesses?.length" class="grid gap-3 sm:grid-cols-2">
            <div v-if="uaResult.analysis?.strengths?.length" class="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-emerald-500">Strengths</p>
              <ul class="space-y-1.5">
                <li v-for="s in uaResult.analysis.strengths" :key="s" class="flex items-start gap-2 text-sm text-gray-300">
                  <span class="shrink-0 text-emerald-400 mt-0.5">✓</span>{{ s }}
                </li>
              </ul>
            </div>
            <div v-if="uaResult.analysis?.weaknesses?.length" class="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
              <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-red-400">Weaknesses</p>
              <ul class="space-y-1.5">
                <li v-for="w in uaResult.analysis.weaknesses" :key="w" class="flex items-start gap-2 text-sm text-gray-300">
                  <span class="shrink-0 text-red-400 mt-0.5">✗</span>{{ w }}
                </li>
              </ul>
            </div>
          </div>

          <!-- Recommendations -->
          <div v-if="uaResult.analysis?.recommendations?.length" class="rounded-xl border border-gray-700 bg-gray-800/30 p-5">
            <p class="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-500">Recommendations</p>
            <div class="space-y-3">
              <div v-for="(rec, i) in uaResult.analysis.recommendations" :key="i" class="flex gap-3">
                <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-bold text-indigo-400">{{ i + 1 }}</div>
                <p class="text-sm text-gray-300 leading-relaxed">{{ rec }}</p>
              </div>
            </div>
          </div>

          <!-- Footer CTA -->
          <div class="flex items-center justify-between rounded-xl border border-gray-700 bg-gray-800/20 px-5 py-4">
            <div>
              <p class="text-sm font-medium text-gray-300">Save this analysis to your database?</p>
              <p class="text-xs text-gray-500 mt-0.5">Link to an existing product or create a new one</p>
            </div>
            <div class="flex items-center gap-2">
              <a :href="uaResult.url" target="_blank" rel="noopener noreferrer" class="btn-secondary text-xs flex items-center gap-1.5">
                View listing
                <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </a>
              <button class="btn-primary text-sm" @click="openUaSaveModal">Save to Database</button>
            </div>
          </div>
        </div>

      </template>
      <!-- ── END URL ANALYSER TAB ── -->

      <!-- ── METHODOLOGY TAB ── -->
      <template v-if="skincareTab === 'methodology'">
        <div class="space-y-6">

          <!-- Intro -->
          <div class="card border-blue-500/20 bg-blue-500/5 p-5">
            <div class="flex items-start gap-3">
              <svg class="mt-0.5 h-5 w-5 shrink-0 text-blue-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
              </svg>
              <div>
                <h3 class="text-sm font-semibold text-blue-300">About This Scoring System</h3>
                <p class="mt-1 text-sm text-gray-400">Products are scored using a quantitative finance-inspired framework combined with skincare-specific domain knowledge. The methodology draws from dermatologist consensus studies, EWG hazard scoring, Hwahae ingredient analysis, and K-beauty trend data.</p>
              </div>
            </div>
          </div>

          <!-- ── Section 1: Quantitative Framework ── -->
          <div class="card overflow-hidden">
            <div class="border-b border-gray-800 bg-gray-900/50 px-5 py-4">
              <h3 class="text-base font-semibold text-white">Quantitative Product Metrics</h3>
              <p class="mt-1 text-sm text-gray-400">Finance-inspired metrics adapted for retail procurement</p>
            </div>
            <div class="divide-y divide-gray-800/50">
              <div class="px-5 py-4">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-mono font-bold text-emerald-300">Alpha</span>
                  <span class="text-sm font-medium text-white">Excess Margin Potential</span>
                </div>
                <p class="mt-2 text-sm text-gray-400">Product Alpha = (Your achievable margin) - (Category average margin). A product with +18% Alpha generates excess margin above its category peers. Negative Alpha means margin-dilutive — only stock for strategic reasons.</p>
                <div class="mt-2 rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-300">
                  achievable_margin = (marketplace_avg_price - cost_price) / marketplace_avg_price<br>
                  Alpha = achievable_margin - category_avg_margin
                </div>
              </div>
              <div class="px-5 py-4">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-blue-500/20 px-2 py-0.5 text-xs font-mono font-bold text-blue-300">Beta</span>
                  <span class="text-sm font-medium text-white">Demand Market Sensitivity</span>
                </div>
                <p class="mt-2 text-sm text-gray-400">How sensitive is product demand to category-wide movements? Beta &gt; 1.0 amplifies trends (buy aggressively before seasonal events, destock after). Beta &lt; 1.0 is defensive (steady reorder cycles).</p>
                <div class="mt-2 rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-300">
                  Beta = covariance(product_velocity, category_velocity) / variance(category_velocity)
                </div>
              </div>
              <div class="px-5 py-4">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-mono font-bold text-amber-300">Sigma (σ)</span>
                  <span class="text-sm font-medium text-white">Demand Volatility</span>
                </div>
                <p class="mt-2 text-sm text-gray-400">Coefficient of variation of demand — how erratic sales are. σ &lt; 0.3 = steady, safe to forecast. σ &gt; 0.7 = lumpy, dangerous to overstock. σ &gt; 1.5 = extreme, viral/trend-driven — test batches only.</p>
              </div>
              <div class="px-5 py-4">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-mono font-bold text-purple-300">Sharpe</span>
                  <span class="text-sm font-medium text-white">Risk-Adjusted Procurement Value</span>
                </div>
                <p class="mt-2 text-sm text-gray-400"><strong class="text-white">The single most important metric.</strong> For every unit of demand uncertainty, how much net margin is generated? Sharpe &gt; 2.0 = stock aggressively. Sharpe 1.0–2.0 = reliable. Sharpe &lt; 0.5 = consider dropping.</p>
                <div class="mt-2 rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-300">
                  Sharpe = (margin_velocity - holding_cost) / σ_demand<br>
                  <span class="text-gray-500">where holding_cost = capital cost + storage + expiry write-off risk</span>
                </div>
              </div>
              <div class="px-5 py-4">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-cyan-500/20 px-2 py-0.5 text-xs font-mono font-bold text-cyan-300">Liquidity</span>
                  <span class="text-sm font-medium text-white">Exit Optionality (0–100)</span>
                </div>
                <p class="mt-2 text-sm text-gray-400">How easily can you sell without discounting? Based on platform coverage, marketplace volume signals, and stock turn rate. Liquidity &gt; 70 = easy to move. &lt; 40 = hard to exit. Keep PO sizes small for illiquid products.</p>
              </div>
              <div class="px-5 py-4">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-pink-500/20 px-2 py-0.5 text-xs font-mono font-bold text-pink-300">Momentum</span>
                  <span class="text-sm font-medium text-white">Review &amp; Price Trends</span>
                </div>
                <p class="mt-2 text-sm text-gray-400">Review momentum = Δ reviews over 30 days. Rising momentum + high rating = stock up. Declining momentum = product past peak. Price momentum tracks marketplace pricing trends over 90 days.</p>
              </div>
            </div>
          </div>

          <!-- ── Section 2: Portfolio Matrix ── -->
          <div class="card overflow-hidden">
            <div class="border-b border-gray-800 bg-gray-900/50 px-5 py-4">
              <h3 class="text-base font-semibold text-white">Portfolio Risk-Return Matrix</h3>
              <p class="mt-1 text-sm text-gray-400">Classify all products into four quadrants — like managing an investment portfolio</p>
            </div>
            <div class="p-5">
              <div class="grid grid-cols-2 gap-3">
                <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                  <div class="flex items-center gap-2">
                    <span class="text-lg">🐄</span>
                    <span class="text-sm font-bold text-emerald-300">Cash Cows</span>
                  </div>
                  <p class="mt-1 text-xs text-gray-400">High Sharpe, Low Beta — 40–50% of budget</p>
                  <p class="mt-1 text-xs text-emerald-400/80">Stable margin base. Steady reorders.</p>
                </div>
                <div class="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4">
                  <div class="flex items-center gap-2">
                    <span class="text-lg">⭐</span>
                    <span class="text-sm font-bold text-yellow-300">Stars</span>
                  </div>
                  <p class="mt-1 text-xs text-gray-400">High Sharpe, High Beta — 30–40% of budget</p>
                  <p class="mt-1 text-xs text-yellow-400/80">Growth drivers. Stock aggressively.</p>
                </div>
                <div class="rounded-lg border border-gray-600/30 bg-gray-800/30 p-4">
                  <div class="flex items-center gap-2">
                    <span class="text-lg">🪨</span>
                    <span class="text-sm font-bold text-gray-400">Dead Weight</span>
                  </div>
                  <p class="mt-1 text-xs text-gray-500">Low Sharpe, Low Beta — 0–5% of budget</p>
                  <p class="mt-1 text-xs text-gray-500">Delist or renegotiate cost.</p>
                </div>
                <div class="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4">
                  <div class="flex items-center gap-2">
                    <span class="text-lg">🎰</span>
                    <span class="text-sm font-bold text-violet-300">Lottery Tickets</span>
                  </div>
                  <p class="mt-1 text-xs text-gray-400">Low Sharpe, High Beta — 5–10% of budget</p>
                  <p class="mt-1 text-xs text-violet-400/80">Small test batches only.</p>
                </div>
              </div>
              <div class="mt-4 space-y-1 text-xs text-gray-500">
                <p><strong class="text-gray-400">Concentration limits:</strong> No single product &gt; 8% of inventory value. No single supplier &gt; 30% of PO value. No single category &gt; 25% of inventory.</p>
              </div>
            </div>
          </div>

          <!-- ── Section 3: Skincare-Specific Scoring (IPS) ── -->
          <div class="card overflow-hidden">
            <div class="border-b border-gray-800 bg-gray-900/50 px-5 py-4">
              <h3 class="text-base font-semibold text-white">Ingredient Profile Score (IPS)</h3>
              <p class="mt-1 text-sm text-gray-400">Skincare-specific safety and quality scoring — 0 to 100</p>
            </div>
            <div class="p-5 space-y-4">
              <div class="rounded bg-gray-900 px-4 py-3 font-mono text-xs text-gray-300 space-y-1">
                <p>ingredient_penalty = count(EWG_score &gt; 5) × 5</p>
                <p>blacklist_penalty = count(hwahae_blacklisted) × 10</p>
                <p>active_bonus = count(tier1_or_tier2_active) × 3</p>
                <p class="text-white font-bold">IPS = max(0, 100 - ingredient_penalty - blacklist_penalty + active_bonus)</p>
              </div>
              <div class="grid gap-3 sm:grid-cols-3">
                <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-center">
                  <p class="text-2xl font-bold text-emerald-300">85+</p>
                  <p class="text-xs text-gray-400">"Clean Beauty" positioning</p>
                  <p class="text-xs text-emerald-400/70">Premium pricing, low return risk</p>
                </div>
                <div class="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-center">
                  <p class="text-2xl font-bold text-yellow-300">60–85</p>
                  <p class="text-xs text-gray-400">Standard formulation</p>
                  <p class="text-xs text-yellow-400/70">Acceptable for mass market</p>
                </div>
                <div class="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-center">
                  <p class="text-2xl font-bold text-red-300">&lt; 60</p>
                  <p class="text-xs text-gray-400">Multiple flagged ingredients</p>
                  <p class="text-xs text-red-400/70">Regulatory risk, sensitive-skin returns</p>
                </div>
              </div>
              <p class="text-xs text-gray-500">The Skincare Sharpe formula inflates volatility by the Ingredient Risk Factor: <code class="text-gray-400">1 + (100 - IPS) / 200</code>. A product with IPS = 50 gets a 25% risk penalty.</p>
            </div>
          </div>

          <!-- ── Section 4: Ingredient Tiers ── -->
          <div class="card overflow-hidden">
            <div class="border-b border-gray-800 bg-gray-900/50 px-5 py-4">
              <h3 class="text-base font-semibold text-white">Ingredient Tier Rankings</h3>
              <p class="mt-1 text-sm text-gray-400">Ranked by dermatologist consensus, clinical evidence, and commercial demand</p>
            </div>
            <div class="divide-y divide-gray-800/50">
              <!-- Tier 1 -->
              <div class="px-5 py-4">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-yellow-500/20 px-2 py-0.5 text-xs font-bold text-yellow-300">TIER 1</span>
                  <span class="text-sm font-medium text-white">Gold Standard</span>
                  <span class="text-xs text-gray-500">85%+ dermatologist consensus</span>
                </div>
                <div class="mt-3 flex flex-wrap gap-2">
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Retinoids <span class="text-yellow-500/60">96.8%</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Zinc Oxide <span class="text-yellow-500/60">96.8%</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Hydroquinone <span class="text-yellow-500/60">98.4%</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Benzoyl Peroxide <span class="text-yellow-500/60">95.2%</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Salicylic Acid <span class="text-yellow-500/60">93.6%</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Vitamin C <span class="text-yellow-500/60">88.7%</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Azelaic Acid <span class="text-yellow-500/60">88.7%</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Kojic Acid <span class="text-yellow-500/60">93.6%</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Tranexamic Acid <span class="text-yellow-500/60">87.1%</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Glycolic Acid <span class="text-yellow-500/60">91.9%</span></span>
                </div>
              </div>
              <!-- Tier 2 -->
              <div class="px-5 py-4">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-blue-500/20 px-2 py-0.5 text-xs font-bold text-blue-300">TIER 2</span>
                  <span class="text-sm font-medium text-white">Strong Evidence</span>
                  <span class="text-xs text-gray-500">70–85% consensus</span>
                </div>
                <div class="mt-3 flex flex-wrap gap-2">
                  <span class="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-200">Niacinamide <span class="text-blue-500/60">79%</span></span>
                  <span class="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-200">Ceramides <span class="text-blue-500/60">82.1%</span></span>
                  <span class="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-200">Hyaluronic Acid <span class="text-blue-500/60">79%</span></span>
                  <span class="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-200">Petrolatum <span class="text-blue-500/60">85.5%</span></span>
                  <span class="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-200">Urea <span class="text-blue-500/60">79%</span></span>
                  <span class="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-200">Lactic Acid</span>
                </div>
              </div>
              <!-- Tier 3 -->
              <div class="px-5 py-4">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-violet-500/20 px-2 py-0.5 text-xs font-bold text-violet-300">TIER 3</span>
                  <span class="text-sm font-medium text-white">Emerging / Trending</span>
                  <span class="text-xs text-gray-500">High demand, early evidence</span>
                </div>
                <div class="mt-3 flex flex-wrap gap-2">
                  <span class="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">Peptides <span class="text-green-400">↑</span></span>
                  <span class="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">Bakuchiol <span class="text-green-400">↑</span></span>
                  <span class="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">Centella / Cica</span>
                  <span class="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">PDRN <span class="text-green-400">↑ +700%</span></span>
                  <span class="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">Exosomes <span class="text-green-400">↑</span></span>
                  <span class="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">Adenosine</span>
                  <span class="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">Beta-Glucan <span class="text-green-400">↑ +181%</span></span>
                  <span class="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">Polyglutamic Acid <span class="text-green-400">↑</span></span>
                  <span class="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">Mugwort</span>
                  <span class="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">NAD+ <span class="text-green-400">↑</span></span>
                  <span class="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">Spicules <span class="text-green-400">↑ NEW</span></span>
                </div>
              </div>
              <!-- Tier 4 -->
              <div class="px-5 py-4">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-gray-600/30 px-2 py-0.5 text-xs font-bold text-gray-300">TIER 4</span>
                  <span class="text-sm font-medium text-white">Supportive</span>
                  <span class="text-xs text-gray-500">Essential but not star actives</span>
                </div>
                <div class="mt-3 flex flex-wrap gap-2">
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-300">Glycerin</span>
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-300">Squalane</span>
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-300">Panthenol</span>
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-300">Allantoin</span>
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-300">Vitamin E</span>
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-300">Shea Butter</span>
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-300">Jojoba Oil</span>
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-300">Aloe Vera</span>
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-300">Green Tea</span>
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-300">Propolis</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Section 5: Ingredients to Avoid ── -->
          <div class="card overflow-hidden">
            <div class="border-b border-gray-800 bg-gray-900/50 px-5 py-4">
              <h3 class="text-base font-semibold text-white">Ingredients to Avoid / Watch</h3>
              <p class="mt-1 text-sm text-gray-400">Hwahae 20 blacklist + extended watchlist — IPS penalties applied per ingredient</p>
            </div>
            <div class="divide-y divide-gray-800/50">
              <!-- Level 1: Avoid -->
              <div class="px-5 py-4">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-red-500/20 px-2 py-0.5 text-xs font-bold text-red-300">AVOID</span>
                  <span class="text-sm font-medium text-white">Regulatory bans, strong evidence of harm</span>
                </div>
                <div class="mt-3 overflow-x-auto">
                  <table class="w-full text-xs">
                    <thead><tr class="text-left text-gray-500">
                      <th class="pb-2 pr-4 font-medium">Ingredient</th>
                      <th class="pb-2 pr-4 font-medium">Function</th>
                      <th class="pb-2 pr-4 font-medium">Why Avoid</th>
                      <th class="pb-2 pr-4 font-medium text-center">EWG</th>
                      <th class="pb-2 font-medium text-center">Penalty</th>
                    </tr></thead>
                    <tbody class="text-gray-300">
                      <tr><td class="py-1.5 pr-4 font-medium text-red-300">Formaldehyde</td><td class="pr-4 text-gray-400">Preservative</td><td class="pr-4">IARC Group 1 carcinogen. Banned in EU.</td><td class="text-center"><span class="rounded bg-red-500/20 px-1.5 text-red-300">10</span></td><td class="text-center text-red-400 font-bold">-15</td></tr>
                      <tr><td class="py-1.5 pr-4 font-medium text-red-300">DMDM Hydantoin</td><td class="pr-4 text-gray-400">Preservative (FA releaser)</td><td class="pr-4">Releases formaldehyde. Class-action lawsuits.</td><td class="text-center"><span class="rounded bg-red-500/20 px-1.5 text-red-300">7-8</span></td><td class="text-center text-red-400 font-bold">-10</td></tr>
                      <tr><td class="py-1.5 pr-4 font-medium text-red-300">Imidazolidinyl Urea</td><td class="pr-4 text-gray-400">Preservative (FA releaser)</td><td class="pr-4">Formaldehyde releaser. Cross-reacts with family.</td><td class="text-center"><span class="rounded bg-orange-500/20 px-1.5 text-orange-300">7</span></td><td class="text-center text-red-400 font-bold">-10</td></tr>
                      <tr><td class="py-1.5 pr-4 font-medium text-red-300">Oxybenzone</td><td class="pr-4 text-gray-400">UV Filter</td><td class="pr-4">Endocrine disruptor. Coral reef toxic. Banned in Hawaii.</td><td class="text-center"><span class="rounded bg-red-500/20 px-1.5 text-red-300">8</span></td><td class="text-center text-red-400 font-bold">-12</td></tr>
                      <tr><td class="py-1.5 pr-4 font-medium text-red-300">Triclosan</td><td class="pr-4 text-gray-400">Antimicrobial</td><td class="pr-4">Endocrine disruptor. Antibiotic resistance. Banned EU leave-on.</td><td class="text-center"><span class="rounded bg-red-500/20 px-1.5 text-red-300">7-8</span></td><td class="text-center text-red-400 font-bold">-12</td></tr>
                      <tr><td class="py-1.5 pr-4 font-medium text-red-300">Hormones</td><td class="pr-4 text-gray-400">Anti-aging (historical)</td><td class="pr-4">Endocrine disruptors. Breast cancer risk.</td><td class="text-center"><span class="rounded bg-red-500/20 px-1.5 text-red-300">9-10</span></td><td class="text-center text-red-400 font-bold">-15</td></tr>
                      <tr><td class="py-1.5 pr-4 font-medium text-red-300">Mercury compounds</td><td class="pr-4 text-gray-400">Skin lightener (illegal)</td><td class="pr-4">Neurotoxin. Banned globally.</td><td class="text-center"><span class="rounded bg-red-500/20 px-1.5 text-red-300">10</span></td><td class="text-center text-red-400 font-bold">-15</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <!-- Level 2: Caution -->
              <div class="px-5 py-4">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-yellow-500/20 px-2 py-0.5 text-xs font-bold text-yellow-300">CAUTION</span>
                  <span class="text-sm font-medium text-white">Debated, dose-dependent, or notable sensitization</span>
                </div>
                <div class="mt-3 flex flex-wrap gap-2">
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Parabens <span class="text-yellow-500/60">-5</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">SLS/SLES <span class="text-yellow-500/60">-3</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Fragrance/Parfum <span class="text-yellow-500/60">-5</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Phenoxyethanol <span class="text-yellow-500/60">-2</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">PEG compounds <span class="text-yellow-500/60">-3</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">BHT <span class="text-yellow-500/60">-3</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">BHA (preservative) <span class="text-yellow-500/60">-4</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Avobenzone <span class="text-yellow-500/60">-3</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Synthetic Colors <span class="text-yellow-500/60">-2</span></span>
                  <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-200">Mineral Oil <span class="text-yellow-500/60">-1</span></span>
                </div>
              </div>
              <!-- Level 3: Watch -->
              <div class="px-5 py-4">
                <div class="flex items-center gap-2">
                  <span class="rounded bg-gray-500/20 px-2 py-0.5 text-xs font-bold text-gray-300">WATCH</span>
                  <span class="text-sm font-medium text-white">Controversial, not conclusively harmful</span>
                </div>
                <div class="mt-3 flex flex-wrap gap-2">
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-400">MI (Methylisothiazolinone) <span class="text-red-400/60">-8</span></span>
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-400">Isopropyl Alcohol <span class="text-gray-500">-1</span></span>
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-400">TEA <span class="text-gray-500">-2</span></span>
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-400">Propylene Glycol <span class="text-gray-500">-1</span></span>
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-400">Alcohol Denat. <span class="text-gray-500">-1</span></span>
                  <span class="rounded-full border border-gray-600/30 bg-gray-800/50 px-3 py-1 text-xs text-gray-400">CAPB <span class="text-gray-500">-1</span></span>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Section 6: Ingredient Conflict Matrix ── -->
          <div class="card overflow-hidden">
            <div class="border-b border-gray-800 bg-gray-900/50 px-5 py-4">
              <h3 class="text-base font-semibold text-white">Ingredient Usage Conflict Matrix</h3>
              <p class="mt-1 text-sm text-gray-400">Chemistry conflicts — combining these causes irritation, deactivation, or pH clash</p>
            </div>
            <div class="p-5 overflow-x-auto">
              <table class="w-full text-xs">
                <thead><tr class="text-gray-400">
                  <th class="pb-2 pr-2 text-left font-medium"></th>
                  <th class="pb-2 px-2 font-medium text-center">Retinol</th>
                  <th class="pb-2 px-2 font-medium text-center">Vit C</th>
                  <th class="pb-2 px-2 font-medium text-center">AHA</th>
                  <th class="pb-2 px-2 font-medium text-center">BHA</th>
                  <th class="pb-2 px-2 font-medium text-center">BPO</th>
                  <th class="pb-2 px-2 font-medium text-center">Niacin</th>
                  <th class="pb-2 px-2 font-medium text-center">HA</th>
                  <th class="pb-2 px-2 font-medium text-center">Peptides</th>
                </tr></thead>
                <tbody class="text-center">
                  <tr><td class="py-1.5 pr-2 text-left font-medium text-gray-300">Retinol</td>     <td class="px-2 text-gray-600">—</td><td class="px-2 text-yellow-400">⚠️</td><td class="px-2 text-red-400">✗</td><td class="px-2 text-red-400">✗</td><td class="px-2 text-red-400">✗</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-yellow-400">⚠️</td></tr>
                  <tr><td class="py-1.5 pr-2 text-left font-medium text-gray-300">Vitamin C</td>   <td class="px-2 text-yellow-400">⚠️</td><td class="px-2 text-gray-600">—</td><td class="px-2 text-red-400">✗</td><td class="px-2 text-red-400">✗</td><td class="px-2 text-red-400">✗</td><td class="px-2 text-yellow-400">⚠️</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-emerald-400">✓</td></tr>
                  <tr><td class="py-1.5 pr-2 text-left font-medium text-gray-300">AHA</td>         <td class="px-2 text-red-400">✗</td><td class="px-2 text-red-400">✗</td><td class="px-2 text-gray-600">—</td><td class="px-2 text-yellow-400">⚠️</td><td class="px-2 text-yellow-400">⚠️</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-red-400">✗</td></tr>
                  <tr><td class="py-1.5 pr-2 text-left font-medium text-gray-300">BHA</td>         <td class="px-2 text-red-400">✗</td><td class="px-2 text-red-400">✗</td><td class="px-2 text-yellow-400">⚠️</td><td class="px-2 text-gray-600">—</td><td class="px-2 text-yellow-400">⚠️</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-red-400">✗</td></tr>
                  <tr><td class="py-1.5 pr-2 text-left font-medium text-gray-300">BPO</td>         <td class="px-2 text-red-400">✗</td><td class="px-2 text-red-400">✗</td><td class="px-2 text-yellow-400">⚠️</td><td class="px-2 text-yellow-400">⚠️</td><td class="px-2 text-gray-600">—</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-red-400">✗</td></tr>
                  <tr><td class="py-1.5 pr-2 text-left font-medium text-gray-300">Niacinamide</td> <td class="px-2 text-emerald-400">✓</td><td class="px-2 text-yellow-400">⚠️</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-gray-600">—</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-emerald-400">✓</td></tr>
                  <tr><td class="py-1.5 pr-2 text-left font-medium text-gray-300">HA</td>          <td class="px-2 text-emerald-400">✓</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-gray-600">—</td><td class="px-2 text-emerald-400">✓</td></tr>
                  <tr><td class="py-1.5 pr-2 text-left font-medium text-gray-300">Peptides</td>    <td class="px-2 text-yellow-400">⚠️</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-red-400">✗</td><td class="px-2 text-red-400">✗</td><td class="px-2 text-red-400">✗</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-emerald-400">✓</td><td class="px-2 text-gray-600">—</td></tr>
                </tbody>
              </table>
              <div class="mt-3 flex gap-4 text-xs text-gray-500">
                <span><span class="text-emerald-400">✓</span> Safe together</span>
                <span><span class="text-yellow-400">⚠️</span> Separate AM/PM</span>
                <span><span class="text-red-400">✗</span> Do not combine</span>
              </div>
            </div>
          </div>

          <!-- ── Section 7: Cross-Sensitivity Families ── -->
          <div class="card overflow-hidden">
            <div class="border-b border-gray-800 bg-gray-900/50 px-5 py-4">
              <h3 class="text-base font-semibold text-white">Cross-Sensitivity Families</h3>
              <p class="mt-1 text-sm text-gray-400">If a user is sensitive to one member, flag ALL members of the family</p>
            </div>
            <div class="divide-y divide-gray-800/50">
              <div class="px-5 py-4">
                <div class="flex items-center gap-2 mb-2">
                  <span class="rounded bg-red-500/20 px-2 py-0.5 text-xs font-bold text-red-300">HIGH</span>
                  <span class="text-sm font-medium text-white">Formaldehyde Releasers</span>
                  <span class="text-xs text-gray-500">40-60% cross-reaction rate</span>
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">DMDM Hydantoin</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Imidazolidinyl Urea</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Diazolidinyl Urea</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Quaternium-15</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Bronopol</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Sod. Hydroxymethylglycinate</span>
                </div>
              </div>
              <div class="px-5 py-4">
                <div class="flex items-center gap-2 mb-2">
                  <span class="rounded bg-red-500/20 px-2 py-0.5 text-xs font-bold text-red-300">HIGH</span>
                  <span class="text-sm font-medium text-white">Fragrance Allergens</span>
                  <span class="text-xs text-gray-500">Broadest cross-reactivity web</span>
                </div>
                <p class="text-xs text-gray-400 mb-2">If sensitive to ANY fragrance → safest to avoid ALL fragranced products. <strong class="text-gray-300">Balsam of Peru</strong> is the "super cross-reactor" — reacts with cinnamon, vanilla, citrus oils, clove, eugenol.</p>
                <div class="flex flex-wrap gap-1.5">
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Parfum</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Limonene</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Linalool</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Geraniol</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Citronellol</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Eugenol</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Coumarin</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Cinnamal</span>
                </div>
              </div>
              <div class="px-5 py-4">
                <div class="flex items-center gap-2 mb-2">
                  <span class="rounded bg-red-500/20 px-2 py-0.5 text-xs font-bold text-red-300">HIGH</span>
                  <span class="text-sm font-medium text-white">Para-Amino Compounds (PPD family)</span>
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">PPD (hair dye)</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Benzocaine</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">PABA</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Azo dyes (FD&amp;C)</span>
                </div>
              </div>
              <div class="px-5 py-4">
                <div class="flex items-center gap-2 mb-2">
                  <span class="rounded bg-yellow-500/20 px-2 py-0.5 text-xs font-bold text-yellow-300">MOD</span>
                  <span class="text-sm font-medium text-white">Asteraceae / Compositae Botanicals</span>
                  <span class="text-xs text-gray-500">Cross-reacts with ragweed pollen allergy</span>
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Chamomile</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Arnica</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Calendula</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Echinacea</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Feverfew</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Chrysanthemum</span>
                </div>
              </div>
              <div class="px-5 py-4">
                <div class="flex items-center gap-2 mb-2">
                  <span class="rounded bg-yellow-500/20 px-2 py-0.5 text-xs font-bold text-yellow-300">MOD</span>
                  <span class="text-sm font-medium text-white">Benzophenone UV Filters</span>
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Oxybenzone (BP-3)</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">BP-1</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">BP-4</span>
                  <span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Octocrylene ↔ Ketoprofen</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Section 8: Skincare Concern Matrix ── -->
          <div class="card overflow-hidden">
            <div class="border-b border-gray-800 bg-gray-900/50 px-5 py-4">
              <h3 class="text-base font-semibold text-white">Ingredient × Concern Mapping</h3>
              <p class="mt-1 text-sm text-gray-400">Which ingredients address which skincare concerns — powers the concern coverage gap analysis</p>
            </div>
            <div class="p-5 overflow-x-auto">
              <table class="w-full text-xs">
                <thead><tr class="text-gray-400">
                  <th class="pb-2 pr-3 text-left font-medium"></th>
                  <th class="pb-2 px-1 font-medium text-center">Hydrate</th>
                  <th class="pb-2 px-1 font-medium text-center">Soothe</th>
                  <th class="pb-2 px-1 font-medium text-center">Bright</th>
                  <th class="pb-2 px-1 font-medium text-center">Anti-age</th>
                  <th class="pb-2 px-1 font-medium text-center">Pores</th>
                  <th class="pb-2 px-1 font-medium text-center">Acne</th>
                  <th class="pb-2 px-1 font-medium text-center">Exfol</th>
                  <th class="pb-2 px-1 font-medium text-center">Barrier</th>
                </tr></thead>
                <tbody class="text-center text-gray-500">
                  <tr><td class="py-1 pr-3 text-left font-medium text-gray-300">Retinoids</td>       <td>—</td><td>—</td><td class="text-yellow-400/80">★★</td><td class="text-emerald-400 font-bold">★★★★★</td><td class="text-yellow-400/80">★★★</td><td class="text-emerald-400">★★★★</td><td class="text-yellow-400/80">★★</td><td>—</td></tr>
                  <tr><td class="py-1 pr-3 text-left font-medium text-gray-300">Vitamin C</td>       <td>—</td><td>—</td><td class="text-emerald-400 font-bold">★★★★★</td><td class="text-yellow-400/80">★★★</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
                  <tr><td class="py-1 pr-3 text-left font-medium text-gray-300">Niacinamide</td>     <td class="text-gray-400">★</td><td class="text-yellow-400/80">★★★</td><td class="text-yellow-400/80">★★★</td><td class="text-yellow-400/80">★★</td><td class="text-yellow-400/80">★★★</td><td class="text-yellow-400/80">★★</td><td>—</td><td class="text-yellow-400/80">★★</td></tr>
                  <tr><td class="py-1 pr-3 text-left font-medium text-gray-300">HA</td>              <td class="text-emerald-400 font-bold">★★★★★</td><td>—</td><td>—</td><td class="text-gray-400">★</td><td>—</td><td>—</td><td>—</td><td class="text-gray-400">★</td></tr>
                  <tr><td class="py-1 pr-3 text-left font-medium text-gray-300">Ceramides</td>       <td class="text-yellow-400/80">★★★</td><td class="text-yellow-400/80">★★</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td class="text-emerald-400 font-bold">★★★★★</td></tr>
                  <tr><td class="py-1 pr-3 text-left font-medium text-gray-300">Salicylic Acid</td>  <td>—</td><td>—</td><td>—</td><td>—</td><td class="text-emerald-400 font-bold">★★★★★</td><td class="text-emerald-400 font-bold">★★★★★</td><td class="text-emerald-400">★★★★</td><td>—</td></tr>
                  <tr><td class="py-1 pr-3 text-left font-medium text-gray-300">Glycolic Acid</td>   <td>—</td><td>—</td><td class="text-yellow-400/80">★★★</td><td class="text-yellow-400/80">★★</td><td class="text-yellow-400/80">★★</td><td class="text-yellow-400/80">★★★</td><td class="text-emerald-400 font-bold">★★★★★</td><td>—</td></tr>
                  <tr><td class="py-1 pr-3 text-left font-medium text-gray-300">Azelaic Acid</td>    <td>—</td><td class="text-yellow-400/80">★★</td><td class="text-emerald-400">★★★★</td><td>—</td><td class="text-yellow-400/80">★★</td><td class="text-emerald-400">★★★★</td><td class="text-yellow-400/80">★★</td><td>—</td></tr>
                  <tr><td class="py-1 pr-3 text-left font-medium text-gray-300">Tranexamic</td>      <td>—</td><td>—</td><td class="text-emerald-400 font-bold">★★★★★</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
                  <tr><td class="py-1 pr-3 text-left font-medium text-gray-300">Centella/Cica</td>   <td>—</td><td class="text-emerald-400 font-bold">★★★★★</td><td>—</td><td class="text-gray-400">★</td><td>—</td><td class="text-yellow-400/80">★★</td><td>—</td><td class="text-yellow-400/80">★★★</td></tr>
                  <tr><td class="py-1 pr-3 text-left font-medium text-gray-300">PDRN</td>            <td class="text-yellow-400/80">★★</td><td class="text-yellow-400/80">★★</td><td>—</td><td class="text-emerald-400">★★★★</td><td>—</td><td>—</td><td>—</td><td class="text-yellow-400/80">★★</td></tr>
                  <tr><td class="py-1 pr-3 text-left font-medium text-gray-300">Peptides</td>        <td>—</td><td>—</td><td>—</td><td class="text-emerald-400">★★★★</td><td>—</td><td>—</td><td>—</td><td class="text-gray-400">★</td></tr>
                  <tr><td class="py-1 pr-3 text-left font-medium text-gray-300">Beta-Glucan</td>     <td class="text-emerald-400">★★★★</td><td class="text-yellow-400/80">★★★</td><td>—</td><td class="text-yellow-400/80">★★</td><td>—</td><td>—</td><td>—</td><td class="text-yellow-400/80">★★</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- ── Section 9: Trend Trajectory ── -->
          <div class="card overflow-hidden">
            <div class="border-b border-gray-800 bg-gray-900/50 px-5 py-4">
              <h3 class="text-base font-semibold text-white">Ingredient Trend Trajectory (2024 → 2026)</h3>
            </div>
            <div class="divide-y divide-gray-800/50">
              <div class="px-5 py-4">
                <div class="flex items-center gap-2 mb-3">
                  <span class="rounded bg-green-500/20 px-2 py-0.5 text-xs font-bold text-green-300">RISING</span>
                  <span class="text-xs text-gray-500">Procure aggressively — ride the wave</span>
                </div>
                <div class="grid gap-2 sm:grid-cols-2">
                  <div class="flex items-center justify-between rounded bg-gray-900 px-3 py-2"><span class="text-xs text-gray-300">PDRN (Salmon DNA)</span><span class="text-xs font-bold text-green-400">+700%</span></div>
                  <div class="flex items-center justify-between rounded bg-gray-900 px-3 py-2"><span class="text-xs text-gray-300">Beta-Glucan</span><span class="text-xs font-bold text-green-400">+181%</span></div>
                  <div class="flex items-center justify-between rounded bg-gray-900 px-3 py-2"><span class="text-xs text-gray-300">Tranexamic Acid</span><span class="text-xs font-bold text-green-400">+120%</span></div>
                  <div class="flex items-center justify-between rounded bg-gray-900 px-3 py-2"><span class="text-xs text-gray-300">NAD+</span><span class="text-xs font-bold text-green-400">+90%</span></div>
                  <div class="flex items-center justify-between rounded bg-gray-900 px-3 py-2"><span class="text-xs text-gray-300">Exosomes</span><span class="text-xs font-bold text-green-400">+81%</span></div>
                  <div class="flex items-center justify-between rounded bg-gray-900 px-3 py-2"><span class="text-xs text-gray-300">Bakuchiol</span><span class="text-xs font-bold text-green-400">+60%</span></div>
                  <div class="flex items-center justify-between rounded bg-gray-900 px-3 py-2"><span class="text-xs text-gray-300">Polyglutamic Acid</span><span class="text-xs font-bold text-green-400">+55%</span></div>
                  <div class="flex items-center justify-between rounded bg-gray-900 px-3 py-2"><span class="text-xs text-gray-300">Peptides (multi-blend)</span><span class="text-xs font-bold text-green-400">+40%</span></div>
                  <div class="flex items-center justify-between rounded bg-gray-900 px-3 py-2"><span class="text-xs text-gray-300">Mineral Sunscreens</span><span class="text-xs font-bold text-green-400">+35%</span></div>
                  <div class="flex items-center justify-between rounded bg-gray-900 px-3 py-2"><span class="text-xs text-gray-300">Spicules</span><span class="text-xs font-bold text-green-400">NEW</span></div>
                </div>
              </div>
              <div class="px-5 py-4">
                <div class="flex items-center gap-2 mb-3">
                  <span class="rounded bg-gray-500/20 px-2 py-0.5 text-xs font-bold text-gray-300">STABLE</span>
                  <span class="text-xs text-gray-500">Maintain steady stock</span>
                </div>
                <div class="flex flex-wrap gap-2">
                  <span class="rounded bg-gray-900 px-3 py-1 text-xs text-gray-300">Retinoids</span>
                  <span class="rounded bg-gray-900 px-3 py-1 text-xs text-gray-300">Vitamin C</span>
                  <span class="rounded bg-gray-900 px-3 py-1 text-xs text-gray-300">Niacinamide</span>
                  <span class="rounded bg-gray-900 px-3 py-1 text-xs text-gray-300">Hyaluronic Acid</span>
                  <span class="rounded bg-gray-900 px-3 py-1 text-xs text-gray-300">Centella / Cica</span>
                  <span class="rounded bg-gray-900 px-3 py-1 text-xs text-gray-300">Glycolic Acid</span>
                  <span class="rounded bg-gray-900 px-3 py-1 text-xs text-gray-300">Salicylic Acid</span>
                  <span class="rounded bg-gray-900 px-3 py-1 text-xs text-gray-300">Ceramides</span>
                  <span class="rounded bg-gray-900 px-3 py-1 text-xs text-gray-300">Adenosine</span>
                </div>
              </div>
              <div class="px-5 py-4">
                <div class="flex items-center gap-2 mb-3">
                  <span class="rounded bg-red-500/20 px-2 py-0.5 text-xs font-bold text-red-300">DECLINING</span>
                  <span class="text-xs text-gray-500">Reduce exposure</span>
                </div>
                <div class="flex flex-wrap gap-2">
                  <span class="rounded bg-gray-900 px-3 py-1 text-xs text-gray-400">Chemical sunscreens (oxybenzone, octinoxate)</span>
                  <span class="rounded bg-gray-900 px-3 py-1 text-xs text-gray-400">Topical collagen</span>
                  <span class="rounded bg-gray-900 px-3 py-1 text-xs text-gray-400">Snail mucin (cyclical)</span>
                  <span class="rounded bg-gray-900 px-3 py-1 text-xs text-gray-400">Harsh physical exfoliants</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Sources -->
          <div class="card p-5">
            <h3 class="text-sm font-semibold text-gray-300 mb-3">Sources</h3>
            <div class="space-y-1 text-xs text-gray-500">
              <p>Northwestern Medicine — Delphi consensus study (80 dermatologists, 43 institutions)</p>
              <p>PMC3065000 — Contact-Allergic Reactions to Cosmetics (cross-reactivity patterns)</p>
              <p>PMC3858659 — Allergy to Selected Cosmetic Ingredients</p>
              <p>EWG Skin Deep — Hazard scoring methodology</p>
              <p>Hwahae Global — K-beauty ingredient analysis platform + 20 Ingredients to Avoid</p>
              <p>Beauty Independent — Top Skincare Trends 2026</p>
              <p>Cosmetics Business — Ingredient Trends 2025</p>
              <p>Luxury London — PDRN, Spicules, NAD+ emergence</p>
            </div>
          </div>

        </div>
      </template>
      <!-- ── END METHODOLOGY TAB ── -->

    </div>

    <!-- ═══ SKINCARE PRODUCT DETAIL MODAL ═══ -->
    <Teleport to="body">
      <div
        v-if="showSkincareDetailModal && selectedSkincareProduct"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        @click.self="showSkincareDetailModal = false"
      >
        <div class="w-full max-w-3xl rounded-xl border border-gray-800 bg-gray-950 shadow-2xl">
          <div class="flex items-start justify-between border-b border-gray-800 p-6">
            <div class="flex items-start gap-4">
              <img
                v-if="selectedSkincareProduct.image_url"
                :src="selectedSkincareProduct.image_url"
                class="h-16 w-16 rounded-lg object-cover bg-gray-800"
              />
              <div>
                <h2 class="text-lg font-bold text-white">{{ selectedSkincareProduct.product_name }}</h2>
                <p class="text-sm text-gray-400">{{ selectedSkincareProduct.brand_name }}</p>
                <div class="mt-2 flex items-center gap-3">
                  <span :class="['rounded-full px-2 py-0.5 text-xs font-semibold', ipsBg(selectedSkincareProduct.ips_score), ipsColor(selectedSkincareProduct.ips_score)]">
                    IPS {{ selectedSkincareProduct.ips_score ?? '—' }} / {{ ipsLabel(selectedSkincareProduct.ips_score) }}
                  </span>
                  <span :class="tierColor(selectedSkincareProduct.top_tier_ingredient)" class="text-xs">
                    {{ tierLabel(selectedSkincareProduct.top_tier_ingredient) }}
                  </span>
                  <span :class="trendColor(selectedSkincareProduct.ingredient_trend_signal)" class="text-xs">
                    {{ trendIcon(selectedSkincareProduct.ingredient_trend_signal) }} {{ selectedSkincareProduct.ingredient_trend_signal || 'unknown' }}
                  </span>
                </div>
              </div>
            </div>
            <button class="btn-ghost !p-1.5" @click="showSkincareDetailModal = false">
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div v-if="skincareDetailLoading" class="p-12 text-center text-gray-500">Loading details...</div>
          <div v-else-if="skincareDetailData" class="max-h-[60vh] overflow-y-auto p-6 space-y-6">
            <!-- Skin Type Fit -->
            <div>
              <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Skin Type Compatibility</h3>
              <div class="grid grid-cols-5 gap-3">
                <div v-for="type in ['dry', 'oily', 'combination', 'sensitive', 'acne']" :key="type" class="text-center">
                  <div class="mx-auto h-20 w-3 rounded-full bg-gray-800 overflow-hidden flex flex-col-reverse">
                    <div
                      :style="{ height: skinTypeFitBar(selectedSkincareProduct.skin_type_fit, type) + '%' }"
                      :class="[
                        'w-full rounded-full transition-all',
                        skinTypeFitBar(selectedSkincareProduct.skin_type_fit, type) > 70 ? 'bg-emerald-400' :
                        skinTypeFitBar(selectedSkincareProduct.skin_type_fit, type) > 40 ? 'bg-blue-400' : 'bg-gray-600'
                      ]"
                    />
                  </div>
                  <p class="mt-1 text-xs text-gray-400 capitalize">{{ type }}</p>
                  <p class="text-xs font-medium text-white">{{ skinTypeFitBar(selectedSkincareProduct.skin_type_fit, type) }}%</p>
                </div>
              </div>
            </div>

            <!-- Concerns -->
            <div v-if="selectedSkincareProduct.concern_tags?.length">
              <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Concerns Addressed</h3>
              <div class="flex flex-wrap gap-2">
                <span
                  v-for="tag in selectedSkincareProduct.concern_tags"
                  :key="tag"
                  class="rounded-full bg-indigo-500/10 px-3 py-1 text-xs text-indigo-400"
                >{{ tag.replace('_', ' ') }}</span>
              </div>
            </div>

            <!-- Ingredients Analysis -->
            <div v-if="skincareDetailData.ingredient_details?.length">
              <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
                Ingredients ({{ skincareDetailData.ingredient_details.length }})
              </h3>
              <div class="max-h-48 overflow-y-auto space-y-1">
                <div
                  v-for="ing in skincareDetailData.ingredient_details"
                  :key="ing.inci_name"
                  class="flex items-center justify-between rounded px-2 py-1 text-xs"
                  :class="ing.tier === 'avoid' ? 'bg-red-500/5' : ing.tier === 'caution' ? 'bg-amber-500/5' : ing.tier?.startsWith('tier') ? 'bg-emerald-500/5' : ''"
                >
                  <span class="text-gray-300">{{ ing.inci_name }}</span>
                  <div class="flex items-center gap-2">
                    <span v-if="ing.tier" :class="[
                      'rounded px-1.5 py-0.5 text-[10px] font-medium',
                      ing.tier === 'tier1' ? 'bg-amber-500/10 text-amber-300' :
                      ing.tier === 'tier2' ? 'bg-blue-500/10 text-blue-400' :
                      ing.tier === 'tier3' ? 'bg-purple-500/10 text-purple-400' :
                      ing.tier === 'tier4' ? 'bg-gray-800 text-gray-400' :
                      ing.tier === 'avoid' ? 'bg-red-500/10 text-red-400' :
                      ing.tier === 'caution' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-gray-800 text-gray-500'
                    ]">{{ ing.tier }}</span>
                    <span v-if="ing.ewg_score" :class="[
                      'text-[10px]',
                      ing.ewg_score <= 2 ? 'text-emerald-500' :
                      ing.ewg_score <= 5 ? 'text-amber-500' : 'text-red-500'
                    ]">EWG {{ ing.ewg_score }}</span>
                    <span v-if="ing.trend && ing.trend !== 'stable'" :class="trendColor(ing.trend)" class="text-[10px]">
                      {{ trendIcon(ing.trend) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Conflict Flags -->
            <div v-if="selectedSkincareProduct.conflict_flags?.length || skincareDetailData.pairwise_conflicts?.length">
              <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-red-400">Conflict Flags</h3>
              <div class="space-y-2">
                <div
                  v-for="flag in selectedSkincareProduct.conflict_flags"
                  :key="flag.family"
                  class="rounded-lg bg-red-500/5 border border-red-500/10 p-3"
                >
                  <p class="text-xs font-medium text-red-400">{{ flag.family.replace(/_/g, ' ') }}</p>
                  <p class="text-xs text-gray-400 mt-1">Contains: {{ flag.ingredients.join(', ') }}</p>
                </div>
                <div
                  v-for="conflict in skincareDetailData.pairwise_conflicts"
                  :key="conflict.ingredient_a + conflict.ingredient_b"
                  class="rounded-lg bg-amber-500/5 border border-amber-500/10 p-3"
                >
                  <p class="text-xs font-medium text-amber-400">
                    {{ conflict.ingredient_a }} + {{ conflict.ingredient_b }}
                  </p>
                  <p class="text-xs text-gray-400 mt-1">{{ conflict.conflict_type }} — {{ conflict.resolution }}</p>
                </div>
              </div>
            </div>

            <!-- Product Meta -->
            <div class="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span class="text-gray-500">Source:</span>
                <span class="ml-2 text-gray-300 capitalize">{{ selectedSkincareProduct.source }}</span>
              </div>
              <div>
                <span class="text-gray-500">Category:</span>
                <span class="ml-2 text-gray-300">{{ selectedSkincareProduct.subcategory }}</span>
              </div>
              <div>
                <span class="text-gray-500">Price:</span>
                <span class="ml-2 text-gray-300">{{ selectedSkincareProduct.price ? `S$${Number(selectedSkincareProduct.price).toFixed(2)}` : 'N/A' }}</span>
              </div>
              <div>
                <span class="text-gray-500">Volume:</span>
                <span class="ml-2 text-gray-300">{{ selectedSkincareProduct.volume || 'N/A' }}</span>
              </div>
              <div>
                <span class="text-gray-500">Crawled:</span>
                <span class="ml-2 text-gray-300">{{ new Date(selectedSkincareProduct.crawled_at).toLocaleDateString() }}</span>
              </div>
              <div v-if="selectedSkincareProduct.source_url">
                <a :href="selectedSkincareProduct.source_url" target="_blank" class="text-indigo-400 hover:underline">View on source</a>
              </div>
            </div>
          </div>

          <div class="border-t border-gray-800 p-4 flex justify-end">
            <button class="btn-secondary" @click="showSkincareDetailModal = false">Close</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ═══ NODE DETAIL MODAL ═══ -->
    <Teleport to="body">
      <div v-if="showNodeModal && selectedNode" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="showNodeModal = false">
        <div class="w-full max-w-2xl rounded-xl border border-gray-800 bg-gray-900 shadow-2xl">
          <div class="flex items-start justify-between border-b border-gray-800 p-6">
            <div class="flex items-start gap-4">
              <div :class="['flex h-12 w-12 items-center justify-center rounded-lg ring-1 ring-inset text-2xl', selectedNode.color || 'bg-gray-800']">
                {{ nodeGlyph(selectedNode.icon) }}
              </div>
              <div>
                <h2 class="text-xl font-bold text-white">{{ selectedNode.name }}</h2>
                <p class="mt-1 text-sm text-gray-400">{{ selectedNode.description }}</p>
              </div>
            </div>
            <button class="btn-ghost !p-1.5" @click="showNodeModal = false">
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="max-h-[60vh] overflow-y-auto p-6 space-y-6">
            <!-- Actions -->
            <div v-if="selectedNode.actions?.length">
              <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Actions</h3>
              <div class="space-y-2">
                <div v-for="action in selectedNode.actions" :key="action.key" class="flex items-start gap-3 rounded-lg bg-gray-800/50 p-3">
                  <div class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-cyan-500/10 text-cyan-400">
                    <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                    </svg>
                  </div>
                  <div>
                    <p class="text-sm font-medium text-white">{{ action.label }}</p>
                    <p class="text-xs text-gray-400">{{ action.description }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Triggers -->
            <div v-if="selectedNode.triggers?.length">
              <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Triggers</h3>
              <div class="space-y-2">
                <div v-for="trigger in selectedNode.triggers" :key="trigger.key" class="flex items-start gap-3 rounded-lg bg-gray-800/50 p-3">
                  <div class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-amber-500/10 text-amber-400">
                    <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
                    </svg>
                  </div>
                  <div>
                    <p class="text-sm font-medium text-white">{{ trigger.label }}</p>
                    <p class="text-xs text-gray-400">{{ trigger.description }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Credential Requirements -->
            <div v-if="Object.keys(selectedNode.credential_schema?.properties || {}).length">
              <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Required Credentials</h3>
              <div class="space-y-1">
                <div
                  v-for="[key, prop] in Object.entries(selectedNode.credential_schema.properties)"
                  :key="key"
                  class="flex items-center gap-2 text-sm"
                >
                  <svg v-if="prop.secret" class="h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                  <svg v-else class="h-4 w-4 shrink-0 text-gray-600" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12a7.5 7.5 0 0 0 15 0m-15 0a7.5 7.5 0 1 1 15 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077 1.41-.513m14.095-5.13 1.41-.513M5.106 17.785l1.15-.964m11.49-9.642 1.149-.964M7.501 19.795l.75-1.3m7.5-12.99.75-1.3m-6.063 16.658.26-1.477m2.605-14.772.26-1.477m0 17.726-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205 12 12m6.894 5.785-1.149-.964M6.256 7.178l-1.15-.964m15.352 8.864-1.41-.513M4.954 9.435l-1.41-.514M12.002 12l-3.75 6.495" />
                  </svg>
                  <span class="text-gray-300">{{ prop.label }}</span>
                  <span v-if="prop.required" class="text-red-400 text-xs">*</span>
                  <span v-if="prop.secret" class="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">secret</span>
                </div>
              </div>
            </div>
          </div>
          <div class="border-t border-gray-800 p-6 flex justify-end gap-3">
            <button class="btn-secondary" @click="showNodeModal = false">Close</button>
            <button
              v-if="selectedNode.is_available && !selectedNode.is_coming_soon"
              class="btn-primary"
              @click="showNodeModal = false; openCreateCredential(selectedNode.id)"
            >
              Create Credential
            </button>
            <button
              v-if="selectedNode.is_available && !selectedNode.is_coming_soon"
              class="btn-primary"
              @click="showNodeModal = false; openCreateConnection(selectedNode.id)"
            >
              Create Connection
            </button>
            <span v-if="selectedNode.is_coming_soon" class="btn-secondary pointer-events-none opacity-60">
              Coming Soon
            </span>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ═══ CREDENTIAL MODAL ═══ -->
    <Teleport to="body">
      <div v-if="showCredModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="showCredModal = false">
        <div class="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-900 shadow-2xl">
          <div class="border-b border-gray-800 p-6">
            <h2 class="text-lg font-bold text-white">
              {{ credModalMode === 'create' ? 'New Credential' : 'Edit Credential' }}
            </h2>
          </div>
          <div class="max-h-[60vh] overflow-y-auto p-6 space-y-4">
            <div v-if="credError" class="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{{ credError }}</div>

            <div v-if="credModalMode === 'create'">
              <label class="label-field">Integration Type</label>
              <select v-model="credForm.nodeDefId" class="input-field">
                <option value="">— Select —</option>
                <option
                  v-for="node in nodeDefinitions.filter(n => n.is_available && !n.is_coming_soon && Object.keys(n.credential_schema?.properties || {}).length > 0)"
                  :key="node.id"
                  :value="node.id"
                >
                  {{ node.name }}
                </option>
              </select>
            </div>

            <div>
              <label class="label-field">Credential Name</label>
              <input v-model="credForm.name" type="text" class="input-field" placeholder="e.g. My Shopify Store" />
            </div>

            <template v-if="credSchemaFields.length > 0">
              <div v-for="[key, prop] in credSchemaFields" :key="key">
                <label class="label-field">
                  {{ prop.label }}
                  <span v-if="prop.required" class="text-red-400">*</span>
                  <span v-if="prop.secret" class="ml-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">encrypted</span>
                </label>
                <textarea
                  v-if="prop.multiline"
                  v-model="credForm.data[key]"
                  rows="4"
                  class="input-field font-mono text-sm"
                  :placeholder="prop.description || ''"
                />
                <select
                  v-else-if="prop.enum"
                  v-model="credForm.data[key]"
                  class="input-field"
                >
                  <option v-for="opt in prop.enum" :key="opt" :value="opt">{{ opt }}</option>
                </select>
                <input
                  v-else
                  v-model="credForm.data[key]"
                  :type="prop.secret ? 'password' : 'text'"
                  class="input-field"
                  :placeholder="prop.description || ''"
                />
                <p v-if="prop.description && !prop.multiline" class="mt-0.5 text-xs text-gray-600">{{ prop.description }}</p>
              </div>
            </template>
          </div>
          <div class="border-t border-gray-800 p-6 flex justify-end gap-3">
            <button class="btn-secondary" @click="showCredModal = false">Cancel</button>
            <button class="btn-primary" :disabled="credSaving || !credForm.name || !credForm.nodeDefId" @click="handleSaveCredential">
              {{ credSaving ? 'Saving...' : (credModalMode === 'create' ? 'Create' : 'Update') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ═══ CONNECTION MODAL ═══ -->
    <Teleport to="body">
      <div v-if="showConnModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="showConnModal = false">
        <div class="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-900 shadow-2xl">
          <div class="border-b border-gray-800 p-6">
            <h2 class="text-lg font-bold text-white">New Connection</h2>
          </div>
          <div class="max-h-[60vh] overflow-y-auto p-6 space-y-4">
            <div v-if="connError" class="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{{ connError }}</div>

            <div>
              <label class="label-field">Integration</label>
              <select v-model="connForm.nodeDefId" class="input-field">
                <option value="">— Select —</option>
                <option
                  v-for="node in nodeDefinitions.filter(n => n.is_available && !n.is_coming_soon)"
                  :key="node.id"
                  :value="node.id"
                >
                  {{ node.name }}
                </option>
              </select>
            </div>

            <div>
              <label class="label-field">Connection Name</label>
              <input v-model="connForm.name" type="text" class="input-field" placeholder="e.g. Main Shopify Store" />
            </div>

            <div v-if="connForm.nodeDefId">
              <label class="label-field">Credential</label>
              <select v-model="connForm.credentialId" class="input-field">
                <option :value="null">— None —</option>
                <option v-for="cred in connAvailableCreds" :key="cred.id" :value="cred.id">
                  {{ cred.name }}
                </option>
              </select>
              <p v-if="connAvailableCreds.length === 0" class="mt-1 text-xs text-amber-400">
                No credentials for this integration.
                <button class="underline" @click="showConnModal = false; openCreateCredential(connForm.nodeDefId)">Create one first.</button>
              </p>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="label-field">Sync Direction</label>
                <select v-model="connForm.syncDirection" class="input-field">
                  <option value="push">Push (SKUMS &rarr; External)</option>
                  <option value="pull">Pull (External &rarr; SKUMS)</option>
                  <option value="bidirectional">Bidirectional</option>
                </select>
              </div>
              <div>
                <label class="label-field">Sync Frequency</label>
                <select v-model="connForm.syncFrequency" class="input-field">
                  <option value="manual">Manual</option>
                  <option value="realtime">Realtime (webhook)</option>
                  <option value="5min">Every 5 minutes</option>
                  <option value="15min">Every 15 minutes</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            </div>
          </div>
          <div class="border-t border-gray-800 p-6 flex justify-end gap-3">
            <button class="btn-secondary" @click="showConnModal = false">Cancel</button>
            <button class="btn-primary" :disabled="connSaving || !connForm.name || !connForm.nodeDefId" @click="handleSaveConnection">
              {{ connSaving ? 'Creating...' : 'Create Connection' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ═══ URL ANALYSER SAVE MODAL ═══ -->
    <Teleport to="body">
      <Transition enter-active-class="transition-opacity duration-200" enter-from-class="opacity-0" enter-to-class="opacity-100" leave-active-class="transition-opacity duration-150" leave-from-class="opacity-100" leave-to-class="opacity-0">
        <div v-if="showUaSaveModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="showUaSaveModal = false">
          <div class="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
            <div class="flex items-center justify-between border-b border-gray-800 px-5 py-4">
              <h2 class="text-base font-semibold text-white">Save to Database</h2>
              <button class="text-gray-500 hover:text-white" @click="showUaSaveModal = false">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="p-5 space-y-4">
              <div class="flex rounded-lg border border-gray-700 p-1 gap-1">
                <button class="flex-1 rounded-md py-1.5 text-sm font-medium transition-colors" :class="uaSaveMode === 'new' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'" @click="uaSaveMode = 'new'">Create new product</button>
                <button class="flex-1 rounded-md py-1.5 text-sm font-medium transition-colors" :class="uaSaveMode === 'link' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'" @click="uaSaveMode = 'link'">Link to existing</button>
              </div>
              <div v-if="uaSaveMode === 'new'" class="space-y-3">
                <div>
                  <label class="label-field">Product Title</label>
                  <input v-model="uaNewForm.title" type="text" class="input-field w-full" />
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="label-field">Brand</label>
                    <select v-model="uaNewForm.brand_id" class="input-field w-full">
                      <option :value="null">— None —</option>
                      <option v-for="b in uaBrands" :key="b.id" :value="b.id">{{ b.name }}</option>
                    </select>
                  </div>
                  <div>
                    <label class="label-field">Category</label>
                    <select v-model="uaNewForm.category_id" class="input-field w-full">
                      <option :value="null">— None —</option>
                      <option v-for="c in uaCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
                    </select>
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="label-field">SGD Price</label>
                    <input v-model.number="uaNewForm.retail_price" type="number" step="0.01" class="input-field w-full" placeholder="0.00" />
                  </div>
                  <div>
                    <label class="label-field">EAN / Barcode</label>
                    <input v-model="uaNewForm.ean" type="text" class="input-field w-full" />
                  </div>
                </div>
                <p class="text-xs text-gray-500">Product created as Draft. Quality analysis attached automatically.</p>
              </div>
              <div v-else class="space-y-3">
                <div class="relative">
                  <label class="label-field">Search your catalog</label>
                  <input v-model="uaLinkSearch" type="text" placeholder="Type product name or SKU..." class="input-field w-full" />
                  <div v-if="uaLinkSearchLoading" class="absolute right-3 top-8">
                    <svg class="h-4 w-4 animate-spin text-gray-500" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
                    </svg>
                  </div>
                  <div v-if="uaLinkResults.length" class="absolute z-10 mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
                    <button v-for="p in uaLinkResults" :key="p.id"
                      class="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-gray-800 first:rounded-t-lg last:rounded-b-lg"
                      @click="uaSelectedLink = p; uaLinkSearch = p.title; uaLinkResults = []">
                      <div>
                        <p class="text-sm text-white">{{ p.title }}</p>
                        <p class="text-xs text-gray-500">{{ p.sku ?? 'No SKU' }}</p>
                      </div>
                      <span v-if="p.retail_price" class="text-xs text-gray-400">{{ p.currency }} {{ Number(p.retail_price).toFixed(2) }}</span>
                    </button>
                  </div>
                </div>
                <div v-if="uaSelectedLink" class="rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-3 py-2.5">
                  <p class="text-sm font-medium text-white">{{ uaSelectedLink.title }}</p>
                  <p class="text-xs text-gray-500 mt-0.5">Quality analysis will be attached to this product</p>
                </div>
              </div>
              <p v-if="uaSaveError" class="text-xs text-red-400">{{ uaSaveError }}</p>
            </div>
            <div class="flex justify-end gap-3 border-t border-gray-800 px-5 py-4">
              <button class="btn-secondary" @click="showUaSaveModal = false">Cancel</button>
              <button class="btn-primary" :disabled="uaSaving || (uaSaveMode === 'link' && !uaSelectedLink)" @click="uaSaveToDatabase">
                {{ uaSaving ? 'Saving...' : 'Save' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
