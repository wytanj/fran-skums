import type {
  ExpiryBatch, ExpiryItem, ExpiryItemStatus,
  ExpiryLifoRow, ExpirySummary, ExpiryMicrosite,
  SkuAlias,
} from '~/types'

export function useExpiry() {
  const client = useSupabaseClient()
  const { currentWorkspace } = useWorkspace()

  const batches = ref<ExpiryBatch[]>([])
  const lifoItems = ref<ExpiryLifoRow[]>([])
  const summary = ref<ExpirySummary | null>(null)
  const microsites = ref<ExpiryMicrosite[]>([])
  const loading = ref(false)

  function wsId() {
    return currentWorkspace.value?.id
  }

  // ----- Summary -----

  async function loadSummary() {
    if (!wsId()) return
    const { data, error } = await client.rpc('expiry_summary', { p_workspace_id: wsId()! })
    if (!error && data) summary.value = data as unknown as ExpirySummary
  }

  // ----- Batches -----

  async function loadBatches() {
    if (!wsId()) return
    loading.value = true
    const { data, error } = await client
      .from('expiry_batches')
      .select('*, items:expiry_items(count)')
      .eq('workspace_id', wsId()!)
      .order('received_at', { ascending: false })
    loading.value = false
    if (!error) {
      batches.value = (data || []).map((b: any) => ({
        ...b,
        _item_count: b.items?.[0]?.count || 0,
      }))
    }
    return { data, error }
  }

  async function getBatch(id: string) {
    const { data, error } = await client
      .from('expiry_batches')
      .select('*')
      .eq('id', id)
      .single()
    return { data, error }
  }

  async function createBatch(batch: Partial<ExpiryBatch>) {
    const { data, error } = await client
      .from('expiry_batches')
      .insert({ ...batch, workspace_id: wsId()! })
      .select()
      .single()
    if (!error) await loadBatches()
    return { data, error }
  }

  async function deleteBatch(id: string) {
    const { error } = await client.from('expiry_batches').delete().eq('id', id)
    if (!error) await loadBatches()
    return { error }
  }

  // ----- Items -----

  async function loadBatchItems(batchId: string) {
    const { data, error } = await client
      .from('expiry_items')
      .select('*, product:product_id(id, title, sku, ean)')
      .eq('batch_id', batchId)
      .order('expiry_year', { ascending: true })
      .order('expiry_month', { ascending: true })
    return { data: (data || []) as ExpiryItem[], error }
  }

  async function createItem(item: Partial<ExpiryItem>) {
    const { data, error } = await client
      .from('expiry_items')
      .insert({ ...item, workspace_id: wsId()! })
      .select('*, product:product_id(id, title, sku, ean)')
      .single()
    return { data, error }
  }

  async function createItems(items: Partial<ExpiryItem>[]) {
    const rows = items.map(i => ({ ...i, workspace_id: wsId()! }))
    const { data, error } = await client
      .from('expiry_items')
      .insert(rows)
      .select('*, product:product_id(id, title, sku, ean)')
    return { data, error }
  }

  async function updateItemStatus(id: string, status: ExpiryItemStatus, qty?: number) {
    const updates: Record<string, any> = { status }
    if (qty !== undefined) updates.remaining_qty = qty
    const { data, error } = await client
      .from('expiry_items')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    return { data, error }
  }

  async function deleteItem(id: string) {
    return await client.from('expiry_items').delete().eq('id', id)
  }

  // ----- LIFO view -----

  async function loadLifo(opts?: { productId?: string; limit?: number }) {
    if (!wsId()) return
    loading.value = true
    let q = client
      .from('expiry_lifo')
      .select('*')
      .eq('workspace_id', wsId()!)

    if (opts?.productId) q = q.eq('product_id', opts.productId)
    if (opts?.limit) q = q.limit(opts.limit)

    const { data, error } = await q
    loading.value = false
    if (!error) lifoItems.value = (data || []) as ExpiryLifoRow[]
    return { data, error }
  }

  // ----- SKU Aliases -----

  async function loadAliases(productId?: string) {
    if (!wsId()) return { data: [] as SkuAlias[], error: null }
    let q = client.from('sku_aliases').select('*').eq('workspace_id', wsId()!)
    if (productId) q = q.eq('product_id', productId)
    q = q.order('created_at', { ascending: false })
    const { data, error } = await q
    return { data: (data || []) as SkuAlias[], error }
  }

  async function createAlias(alias: { product_id: string; alias_value: string; alias_type?: string; label?: string }) {
    const { data, error } = await client
      .from('sku_aliases')
      .insert({
        workspace_id: wsId()!,
        product_id: alias.product_id,
        alias_type: alias.alias_type || 'sku',
        alias_value: alias.alias_value,
        label: alias.label || null,
        source: 'manual',
      })
      .select()
      .single()
    return { data, error }
  }

  async function deleteAlias(id: string) {
    return await client.from('sku_aliases').delete().eq('id', id)
  }

  // ----- Microsites -----

  async function loadMicrosites() {
    if (!wsId()) return
    const { data, error } = await client
      .from('expiry_microsites')
      .select('*')
      .eq('workspace_id', wsId()!)
      .order('created_at', { ascending: false })
    if (!error) microsites.value = (data || []) as ExpiryMicrosite[]
    return { data, error }
  }

  async function createMicrosite(site: Partial<ExpiryMicrosite>) {
    const { data, error } = await client
      .from('expiry_microsites')
      .insert({ ...site, workspace_id: wsId()! })
      .select()
      .single()
    if (!error) await loadMicrosites()
    return { data, error }
  }

  async function updateMicrosite(id: string, updates: Partial<ExpiryMicrosite>) {
    const { data, error } = await client
      .from('expiry_microsites')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (!error) await loadMicrosites()
    return { data, error }
  }

  async function deleteMicrosite(id: string) {
    const { error } = await client.from('expiry_microsites').delete().eq('id', id)
    if (!error) await loadMicrosites()
    return { error }
  }

  // ----- Helpers -----

  function expiryLabel(year: number, month: number, day?: number | null) {
    const m = String(month).padStart(2, '0')
    if (day) return `${String(day).padStart(2, '0')}/${m}/${year}`
    return `${m}/${year}`
  }

  function daysUntilExpiry(year: number, month: number, day?: number | null) {
    const d = new Date(year, month - 1, day || 1)
    return Math.ceil((d.getTime() - Date.now()) / 86_400_000)
  }

  function expiryUrgency(days: number): 'expired' | 'critical' | 'warning' | 'ok' {
    if (days < 0) return 'expired'
    if (days <= 30) return 'critical'
    if (days <= 90) return 'warning'
    return 'ok'
  }

  return {
    batches, lifoItems, summary, microsites, loading,
    loadSummary, loadBatches, getBatch, createBatch, deleteBatch,
    loadBatchItems, createItem, createItems, updateItemStatus, deleteItem,
    loadLifo,
    loadAliases, createAlias, deleteAlias,
    loadMicrosites, createMicrosite, updateMicrosite, deleteMicrosite,
    expiryLabel, daysUntilExpiry, expiryUrgency,
  }
}
