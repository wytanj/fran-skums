import type {
  DemandVelocity,
  ReorderAlert,
  ExpiryRisk,
  ForecastEvent,
  SaleEvent,
  ForecastResult,
  AlertLevel,
} from '~/types'

export function useForecasting() {
  const client = useSupabaseClient()
  const { currentWorkspace } = useWorkspace()

  const demandVelocity = ref<DemandVelocity[]>([])
  const reorderAlerts = ref<ReorderAlert[]>([])
  const expiryRisks = ref<ExpiryRisk[]>([])
  const forecastEvents = ref<ForecastEvent[]>([])
  const forecastResult = ref<ForecastResult | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ── Demand Velocity ──────────────────────────────────────────
  async function loadDemandVelocity() {
    if (!currentWorkspace.value?.id) return
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await client
        .from('v_demand_velocity')
        .select('*')
        .eq('workspace_id', currentWorkspace.value.id)
        .order('best_velocity', { ascending: false })
      if (err) throw err
      demandVelocity.value = (data ?? []) as DemandVelocity[]
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  // ── Reorder Alerts ───────────────────────────────────────────
  async function loadReorderAlerts(alertLevels?: AlertLevel[]) {
    if (!currentWorkspace.value?.id) return
    loading.value = true
    error.value = null
    try {
      let query = client
        .from('v_reorder_alerts')
        .select('*')
        .eq('workspace_id', currentWorkspace.value.id)

      if (alertLevels?.length) {
        query = query.in('alert_level', alertLevels)
      }

      const { data, error: err } = await query.order('days_of_stock_remaining', {
        ascending: true,
        nullsFirst: false,
      })
      if (err) throw err
      reorderAlerts.value = (data ?? []) as ReorderAlert[]
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  // ── Expiry Risks ─────────────────────────────────────────────
  async function loadExpiryRisks(riskFilter?: ('at_risk' | 'borderline' | 'safe' | 'unknown')[]) {
    if (!currentWorkspace.value?.id) return
    loading.value = true
    error.value = null
    try {
      let query = client
        .from('v_expiry_risk')
        .select('*')
        .eq('workspace_id', currentWorkspace.value.id)

      if (riskFilter?.length) {
        query = query.in('risk_status', riskFilter)
      }

      const { data, error: err } = await query.order('days_until_expiry', { ascending: true })
      if (err) throw err
      expiryRisks.value = (data ?? []) as ExpiryRisk[]
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  // ── Forecast Events (SG Calendar) ────────────────────────────
  async function loadForecastEvents(upcomingOnly = true) {
    if (!currentWorkspace.value?.id) return
    loading.value = true
    error.value = null
    try {
      let query = client
        .from('forecast_events')
        .select('*')
        .or(`workspace_id.is.null,workspace_id.eq.${currentWorkspace.value.id}`)
        .order('date_from', { ascending: true })

      if (upcomingOnly) {
        query = query.gte('date_to', new Date().toISOString().split('T')[0])
      }

      const { data, error: err } = await query
      if (err) throw err
      forecastEvents.value = (data ?? []) as ForecastEvent[]
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  // ── Sales Events ─────────────────────────────────────────────
  async function loadSalesEvents(productId?: string, days = 90) {
    if (!currentWorkspace.value?.id) return []
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceStr = since.toISOString().split('T')[0]

    let query = client
      .from('sales_events')
      .select('*')
      .eq('workspace_id', currentWorkspace.value.id)
      .gte('sale_date', sinceStr)
      .order('sale_date', { ascending: false })

    if (productId) {
      query = query.eq('product_id', productId)
    }

    const { data, error: err } = await query
    if (err) throw new Error(err.message)
    return (data ?? []) as SaleEvent[]
  }

  async function createSaleEvent(payload: Omit<SaleEvent, 'id' | 'created_at'>) {
    const { data, error: err } = await client
      .from('sales_events')
      .insert(payload)
      .select()
      .single()
    if (err) throw new Error(err.message)
    return data as SaleEvent
  }

  // ── Category peer velocity (for cold start) ──────────────────
  async function getCategoryPeerVelocity(productId: string): Promise<{ avg_velocity: number; peer_count: number; category_name: string } | null> {
    if (!currentWorkspace.value?.id) return null
    // Get the product's category, then average velocity of sibling products
    const { data: productRow } = await client
      .from('products')
      .select('category_id, categories(name)')
      .eq('id', productId)
      .eq('workspace_id', currentWorkspace.value.id)
      .single()

    if (!productRow?.category_id) return null

    const { data: peers } = await client
      .from('v_demand_velocity')
      .select('best_velocity, product_id')
      .eq('workspace_id', currentWorkspace.value.id)
      .neq('product_id', productId)

    // Join via products to filter by category — fetch category siblings
    const { data: siblings } = await client
      .from('products')
      .select('id')
      .eq('workspace_id', currentWorkspace.value.id)
      .eq('category_id', productRow.category_id)
      .neq('id', productId)

    const siblingIds = new Set((siblings ?? []).map((s: any) => s.id))
    const siblingVelocities = (peers ?? [])
      .filter((p: any) => siblingIds.has(p.product_id) && p.best_velocity > 0)
      .map((p: any) => p.best_velocity)

    if (siblingVelocities.length === 0) return null

    const avg = siblingVelocities.reduce((a: number, b: number) => a + b, 0) / siblingVelocities.length
    const categoryName = (productRow as any).categories?.name ?? 'Unknown'

    return {
      avg_velocity: Math.round(avg * 1000) / 1000,
      peer_count: siblingVelocities.length,
      category_name: categoryName,
    }
  }

  // ── AI Forecast ──────────────────────────────────────────────
  async function getAIForecast(productId: string): Promise<ForecastResult> {
    const product = demandVelocity.value.find(d => d.product_id === productId)
    const alerts = reorderAlerts.value.find(a => a.product_id === productId)
    const expiry = expiryRisks.value.filter(e => e.product_id === productId)
    const today = new Date().toISOString().split('T')[0]
    const in90d = new Date()
    in90d.setDate(in90d.getDate() + 90)
    const upcomingEvents = forecastEvents.value.filter(
      e => e.date_from >= today && e.date_to >= today
    )

    // Cold start: fetch category peers if < 14 days history
    let categoryPeer: { avg_velocity: number; peer_count: number; category_name: string } | null = null
    const daysWithSales = product?.days_with_sales ?? 0
    if (daysWithSales < 14) {
      categoryPeer = await getCategoryPeerVelocity(productId)
    }

    // Sparse detection: total observed days since first sale
    const firstSaleDate = product?.first_sale_date
    const totalDaysObserved = firstSaleDate
      ? Math.floor((Date.now() - new Date(firstSaleDate).getTime()) / 86400000)
      : daysWithSales

    const { data, error: err } = await useFetch('/api/forecast', {
      method: 'POST',
      body: {
        product_id: productId,
        product_title: product?.product_title ?? '',
        product_sku: product?.product_sku ?? '',
        category_name: categoryPeer?.category_name ?? null,
        velocity_7d: product?.velocity_7d ?? 0,
        velocity_30d: product?.velocity_30d ?? 0,
        velocity_90d: product?.velocity_90d ?? 0,
        days_with_sales: daysWithSales,
        total_days_observed: totalDaysObserved,
        category_avg_velocity: categoryPeer?.avg_velocity ?? null,
        category_peer_count: categoryPeer?.peer_count ?? null,
        available_to_sell: alerts?.available_to_sell ?? 0,
        days_of_stock_remaining: alerts?.days_of_stock_remaining ?? null,
        lead_time_days: alerts?.lead_time_days ?? 14,
        expiry_batches: expiry.map(e => ({
          remaining_qty: e.remaining_qty,
          days_until_expiry: e.days_until_expiry,
          risk_status: e.risk_status,
        })),
        upcoming_events: upcomingEvents.map(e => ({
          event_name: e.event_name,
          date_from: e.date_from,
          date_to: e.date_to,
          multiplier: e.multiplier,
        })),
      },
    })

    if (err.value) throw new Error(err.value.message)
    forecastResult.value = data.value as ForecastResult
    return forecastResult.value
  }

  // ── Helpers ───────────────────────────────────────────────────
  function alertLevelColor(level: AlertLevel): string {
    const map: Record<AlertLevel, string> = {
      stockout:    'text-red-400 bg-red-500/10 border-red-500/30',
      critical:    'text-orange-400 bg-orange-500/10 border-orange-500/30',
      reorder_now: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
      watch:       'text-blue-400 bg-blue-500/10 border-blue-500/30',
      healthy:     'text-green-400 bg-green-500/10 border-green-500/30',
      overstock:   'text-purple-400 bg-purple-500/10 border-purple-500/30',
      no_data:     'text-zinc-400 bg-zinc-500/10 border-zinc-500/30',
    }
    return map[level] ?? map.no_data
  }

  function alertLevelLabel(level: AlertLevel): string {
    const map: Record<AlertLevel, string> = {
      stockout:    'Stockout',
      critical:    'Critical',
      reorder_now: 'Reorder Now',
      watch:       'Watch',
      healthy:     'Healthy',
      overstock:   'Overstock',
      no_data:     'No Data',
    }
    return map[level] ?? 'Unknown'
  }

  function dsrColor(days: number | null): string {
    if (days === null) return 'text-zinc-400'
    if (days === 0)    return 'text-red-400'
    if (days <= 7)     return 'text-orange-400'
    if (days <= 14)    return 'text-yellow-400'
    if (days <= 30)    return 'text-blue-400'
    if (days > 90)     return 'text-purple-400'
    return 'text-green-400'
  }

  // Counts for overview cards
  const stockoutCount = computed(
    () => reorderAlerts.value.filter(a => a.alert_level === 'stockout').length
  )
  const criticalCount = computed(
    () => reorderAlerts.value.filter(a => ['stockout', 'critical', 'reorder_now'].includes(a.alert_level)).length
  )
  const overstockCount = computed(
    () => reorderAlerts.value.filter(a => a.alert_level === 'overstock').length
  )
  const expiryRiskCount = computed(
    () => expiryRisks.value.filter(e => e.risk_status === 'at_risk').length
  )
  const nextEvent = computed(() => forecastEvents.value[0] ?? null)

  return {
    demandVelocity,
    reorderAlerts,
    expiryRisks,
    forecastEvents,
    forecastResult,
    loading,
    error,

    loadDemandVelocity,
    loadReorderAlerts,
    loadExpiryRisks,
    loadForecastEvents,
    loadSalesEvents,
    createSaleEvent,
    getAIForecast,
    getCategoryPeerVelocity,

    alertLevelColor,
    alertLevelLabel,
    dsrColor,
    stockoutCount,
    criticalCount,
    overstockCount,
    expiryRiskCount,
    nextEvent,
  }
}
