import type { Product, ProductManual, ProductStatus } from '~/types'

export function useProducts() {
  const client = useSupabaseClient()
  const { currentWorkspace } = useWorkspace()

  const products = ref<Product[]>([])
  const loading = ref(false)
  const totalCount = ref(0)

  async function fetchProducts(opts: {
    page?: number
    perPage?: number
    search?: string
    status?: ProductStatus | ''
    categoryId?: string
    brandId?: string
    sortBy?: string
    sortDir?: 'asc' | 'desc'
  } = {}) {
    if (!currentWorkspace.value) return

    loading.value = true
    const {
      page = 1,
      perPage = 25,
      search = '',
      status = '',
      categoryId = '',
      brandId = '',
      sortBy = 'created_at',
      sortDir = 'desc',
    } = opts

    const from = (page - 1) * perPage
    const to = from + perPage - 1

    let query = client
      .from('products')
      .select('*, brand:brand_id(id, name), category:category_id(id, name)', { count: 'exact' })
      .eq('workspace_id', currentWorkspace.value.id)

    if (search) {
      query = query.or(`title.ilike.%${search}%,sku.ilike.%${search}%,ean.ilike.%${search}%,upc.ilike.%${search}%`)
    }
    if (status) {
      query = query.eq('status', status)
    }
    if (categoryId) {
      query = query.eq('category_id', categoryId)
    }
    if (brandId) {
      query = query.eq('brand_id', brandId)
    }

    query = query.order(sortBy, { ascending: sortDir === 'asc' })
    query = query.range(from, to)

    const { data, count, error } = await query

    if (error) throw error

    products.value = (data || []) as Product[]
    totalCount.value = count || 0
    loading.value = false
  }

  async function getProduct(id: string) {
    const { data, error } = await client
      .from('products')
      .select('*, brand:brand_id(*), category:category_id(*), images:product_images(*), variants:product_variants(*), manuals:product_manuals(*), canonical_product:canonical_product_id(id, title, sku, is_canonical, workspace_id)')
      .eq('id', id)
      .single()

    if (error) throw error

    // Fetch forks if this is a canonical product
    if (data?.is_canonical) {
      const { data: forks } = await client
        .from('products')
        .select('id, title, rendition_name, export_target, status, workspace_id, updated_at')
        .eq('canonical_product_id', id)
        .order('created_at', { ascending: false })
      ;(data as any).forks = forks || []
    }

    return data as Product
  }

  async function createProduct(product: Partial<Product>) {
    if (!currentWorkspace.value) throw new Error('No workspace selected')

    const { data, error } = await client
      .from('products')
      .insert({ ...product, workspace_id: currentWorkspace.value.id })
      .select()
      .single()

    if (error) throw error

    // M1: UI provenance (best-effort; never block create)
    try {
      const user = (await client.auth.getUser()).data.user
      await client.from('audit_events').insert({
        workspace_id: currentWorkspace.value.id,
        entity_type: 'products',
        entity_id: data.id,
        event_type: 'product.created',
        operation: 'INSERT',
        actor_user_id: user?.id || null,
        source_type: 'ui',
        after_data: data as any,
        metadata: {
          channel: 'ui',
          actor_kind: 'user',
          client_name: 'fran-web',
          status: data.status,
        },
      } as any)
    } catch {
      /* ignore until migration 052 applied */
    }

    return data as Product
  }

  async function updateProduct(id: string, updates: Partial<Product>) {
    const { data, error } = await client
      .from('products')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    if (currentWorkspace.value) {
      try {
        const user = (await client.auth.getUser()).data.user
        await client.from('audit_events').insert({
          workspace_id: currentWorkspace.value.id,
          entity_type: 'products',
          entity_id: id,
          event_type: 'product.updated',
          operation: 'UPDATE',
          actor_user_id: user?.id || null,
          source_type: 'ui',
          after_data: data as any,
          metadata: {
            channel: 'ui',
            actor_kind: 'user',
            client_name: 'fran-web',
          },
        } as any)
      } catch {
        /* ignore */
      }
    }

    return data as Product
  }

  /**
   * M5: promote a draft/import/pipeline product into the POS catalog.
   * Sets status=active and product_data.pos_enabled / sellable_in_pos.
   */
  async function activateForPos(id: string) {
    const existing = await getProduct(id)
    const product_data = {
      ...(existing.product_data || {}),
      pos_enabled: true,
      sellable_in_pos: true,
    }
    return updateProduct(id, {
      status: 'active',
      product_data,
    } as any)
  }

  /** Remove from POS catalog without archiving the product. */
  async function deactivateForPos(id: string) {
    const existing = await getProduct(id)
    const product_data = {
      ...(existing.product_data || {}),
      pos_enabled: false,
      sellable_in_pos: false,
    }
    return updateProduct(id, { product_data } as any)
  }

  async function deleteProduct(id: string) {
    const { error } = await client
      .from('products')
      .delete()
      .eq('id', id)

    if (error) throw error
  }

  async function deleteProducts(ids: string[]) {
    const { error } = await client
      .from('products')
      .delete()
      .in('id', ids)

    if (error) throw error
  }

  async function forkProduct(sourceId: string, renditionName: string, exportTarget: string) {
    if (!currentWorkspace.value) throw new Error('No workspace selected')

    const { data, error } = await client.rpc('fork_product', {
      source_product_id: sourceId,
      target_workspace_id: currentWorkspace.value.id,
      p_rendition_name: renditionName,
      p_export_target: exportTarget || null,
    })

    if (error) throw error
    return data as unknown as Product
  }

  // --- Manuals ---

  async function getManuals(productId: string) {
    const { data, error } = await client
      .from('product_manuals')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data || []) as ProductManual[]
  }

  async function createManual(productId: string, title: string, content: string) {
    const user = useSupabaseUser()
    const { data, error } = await client
      .from('product_manuals')
      .insert({ product_id: productId, title, content, created_by: user.value?.id || (user.value as any)?.sub })
      .select()
      .single()

    if (error) throw error
    return data as ProductManual
  }

  async function updateManual(id: string, updates: Partial<ProductManual>) {
    const { data, error } = await client
      .from('product_manuals')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data as ProductManual
  }

  async function deleteManual(id: string) {
    const { error } = await client
      .from('product_manuals')
      .delete()
      .eq('id', id)

    if (error) throw error
  }

  return {
    products,
    loading,
    totalCount,
    fetchProducts,
    getProduct,
    createProduct,
    updateProduct,
    activateForPos,
    deactivateForPos,
    deleteProduct,
    deleteProducts,
    forkProduct,
    getManuals,
    createManual,
    updateManual,
    deleteManual,
  }
}
