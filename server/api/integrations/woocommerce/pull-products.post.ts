import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchWooCommerceProductsPage,
  fetchWooCommerceVariations,
  getWooCommerceCurrency,
  mapWooCommerceProductToSkumsProduct,
  mapWooCommerceVariationToSkumsVariant,
  stableWooCommerceHash,
  type SkumsProductFromWooCommerce,
  type WooCommerceCredentials,
  type WooCommerceProduct,
  type WooCommerceVariation,
} from '../../../../channels/woocommerce/client'

interface PullStats {
  fetched: number
  created: number
  updated: number
  failed: number
  images: number
  variants: number
  errors: Array<{ external_id: string; message: string }>
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function nodeSlug(connection: any): string | null {
  const node = connection.node_definition
  if (Array.isArray(node)) return node[0]?.slug || null
  return node?.slug || null
}

function connectionCredential(connection: any): any | null {
  const credential = connection.credential
  if (Array.isArray(credential)) return credential[0] || null
  return credential || null
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    || 'uncategorized'
}

async function resolveBrand(client: SupabaseClient, workspaceId: string, name: string | null): Promise<string | null> {
  const trimmed = name?.trim()
  if (!trimmed) return null

  const { data: existing, error: existingError } = await client
    .from('brands')
    .select('id')
    .eq('workspace_id', workspaceId)
    .ilike('name', trimmed)
    .limit(1)

  if (existingError) throw existingError
  if (existing?.length) return existing[0].id

  const { data: created, error: createError } = await client
    .from('brands')
    .insert({ workspace_id: workspaceId, name: trimmed })
    .select('id')
    .single()

  if (createError) throw createError
  return created?.id || null
}

async function resolveCategory(client: SupabaseClient, workspaceId: string, name: string | null): Promise<string | null> {
  const trimmed = name?.trim()
  if (!trimmed) return null

  const { data: existing, error: existingError } = await client
    .from('categories')
    .select('id')
    .eq('workspace_id', workspaceId)
    .ilike('name', trimmed)
    .limit(1)

  if (existingError) throw existingError
  if (existing?.length) return existing[0].id

  const { data: created, error: createError } = await client
    .from('categories')
    .insert({ workspace_id: workspaceId, name: trimmed, slug: slugify(trimmed) })
    .select('id')
    .single()

  if (createError) throw createError
  return created?.id || null
}

function buildProductRow(
  workspaceId: string,
  mapped: SkumsProductFromWooCommerce,
  existingProductData: Record<string, any> = {},
) {
  const wooData = mapped.product_data.woocommerce as Record<string, unknown>
  const mergedProductData = {
    ...existingProductData,
    ...mapped.product_data,
    woocommerce: {
      ...(existingProductData.woocommerce || {}),
      ...wooData,
      last_pulled_at: new Date().toISOString(),
    },
  }

  const row: Record<string, any> = {
    workspace_id: workspaceId,
    title: mapped.title,
    status: mapped.status,
    currency: mapped.currency,
    stock_quantity: mapped.stock_quantity,
    track_inventory: mapped.track_inventory,
    product_data: mergedProductData,
    updated_at: new Date().toISOString(),
  }

  const optionalFields: Array<keyof SkumsProductFromWooCommerce> = [
    'sku',
    'ean',
    'upc',
    'gtin',
    'mpn',
    'description',
    'short_description',
    'retail_price',
    'sale_price',
    'weight',
    'weight_unit',
    'length',
    'width',
    'height',
    'dimension_unit',
    'canonical_url',
    'tags',
  ]

  for (const field of optionalFields) {
    const value = mapped[field]
    if (value !== null && value !== undefined) row[field] = value
  }

  return row
}

async function findExistingProduct(
  client: SupabaseClient,
  workspaceId: string,
  connectionId: string,
  externalId: string,
  sku: string | null,
) {
  const { data: mapping, error: mappingError } = await client
    .from('integration_sync_mappings')
    .select('product_id')
    .eq('connection_id', connectionId)
    .eq('external_id', externalId)
    .maybeSingle()

  if (mappingError) throw mappingError

  if (mapping?.product_id) {
    const { data: product, error: productError } = await client
      .from('products')
      .select('id, product_data')
      .eq('workspace_id', workspaceId)
      .eq('id', mapping.product_id)
      .maybeSingle()
    if (productError) throw productError
    if (product) return product
  }

  if (!sku) return null

  const { data: product, error: productError } = await client
    .from('products')
    .select('id, product_data')
    .eq('workspace_id', workspaceId)
    .eq('sku', sku)
    .maybeSingle()

  if (productError) throw productError
  return product || null
}

async function upsertProduct(
  client: SupabaseClient,
  workspaceId: string,
  connectionId: string,
  product: WooCommerceProduct,
  variations: WooCommerceVariation[],
  currency: string,
) {
  const externalId = String(product.id)
  const mapped = mapWooCommerceProductToSkumsProduct(product, currency)
  const wooData = mapped.product_data.woocommerce as Record<string, unknown>
  wooData.variations = variations

  const existing = await findExistingProduct(client, workspaceId, connectionId, externalId, mapped.sku)
  const row = buildProductRow(workspaceId, mapped, (existing?.product_data || {}) as Record<string, any>)

  let productId: string
  let operation: 'created' | 'updated'

  if (existing?.id) {
    const { data, error } = await client
      .from('products')
      .update(row)
      .eq('id', existing.id)
      .select('id')
      .single()

    if (error) throw error
    productId = data.id
    operation = 'updated'
  } else {
    const { data, error } = await client
      .from('products')
      .insert(row)
      .select('id')
      .single()

    if (error) throw error
    productId = data.id
    operation = 'created'
  }

  const [brandId, categoryId] = await Promise.all([
    resolveBrand(client, workspaceId, mapped.brand_name),
    resolveCategory(client, workspaceId, mapped.category_name),
  ])

  const linkUpdates: Record<string, string> = {}
  if (brandId) linkUpdates.brand_id = brandId
  if (categoryId) linkUpdates.category_id = categoryId
  if (Object.keys(linkUpdates).length) {
    await client.from('products').update(linkUpdates).eq('id', productId)
  }

  return {
    productId,
    operation,
    mapped,
  }
}

async function syncImages(client: SupabaseClient, productId: string, product: WooCommerceProduct): Promise<number> {
  const images = (product.images || []).filter(image => image.src)
  if (!images.length) return 0

  const { data: existing, error: existingError } = await client
    .from('product_images')
    .select('url')
    .eq('product_id', productId)

  if (existingError) throw existingError
  const existingUrls = new Set((existing || []).map((image: any) => image.url))

  const rows = images
    .filter(image => image.src && !existingUrls.has(image.src))
    .map((image, index) => ({
      product_id: productId,
      url: image.src,
      alt_text: image.alt || image.name || product.name || null,
      sort_order: image.position ?? index,
      is_primary: index === 0,
    }))

  if (!rows.length) return 0

  const { error } = await client.from('product_images').insert(rows)
  if (error) throw error
  return rows.length
}

async function syncVariants(
  client: SupabaseClient,
  productId: string,
  product: WooCommerceProduct,
  variations: WooCommerceVariation[],
): Promise<number> {
  let synced = 0

  for (const variation of variations) {
    const mapped = mapWooCommerceVariationToSkumsVariant(variation, product)
    if (!mapped.sku) continue

    const row = {
      product_id: productId,
      sku: mapped.sku,
      ean: mapped.ean,
      upc: mapped.upc,
      gtin: mapped.gtin,
      title: mapped.title,
      options: mapped.options,
      retail_price: mapped.retail_price,
      sale_price: mapped.sale_price,
      stock_quantity: mapped.stock_quantity,
      weight: mapped.weight,
      image_url: mapped.image_url,
      is_active: mapped.is_active,
      updated_at: new Date().toISOString(),
    }

    const { data: existing, error: existingError } = await client
      .from('product_variants')
      .select('id')
      .eq('product_id', productId)
      .eq('sku', mapped.sku)
      .maybeSingle()

    if (existingError) throw existingError

    if (existing?.id) {
      const { error } = await client.from('product_variants').update(row).eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await client.from('product_variants').insert(row)
      if (error) throw error
    }

    synced += 1
  }

  return synced
}

async function syncMapping(
  client: SupabaseClient,
  connectionId: string,
  productId: string,
  product: WooCommerceProduct,
) {
  const externalId = String(product.id)
  const remoteHash = stableWooCommerceHash(product)
  const payload = {
    connection_id: connectionId,
    product_id: productId,
    external_id: externalId,
    external_url: product.permalink || null,
    external_data: {
      source: 'woocommerce',
      product,
    },
    sync_status: 'synced',
    last_pulled_at: new Date().toISOString(),
    remote_hash: remoteHash,
  }

  const { data: existingByExternal, error: externalError } = await client
    .from('integration_sync_mappings')
    .select('id')
    .eq('connection_id', connectionId)
    .eq('external_id', externalId)
    .maybeSingle()

  if (externalError) throw externalError

  if (existingByExternal?.id) {
    const { error } = await client
      .from('integration_sync_mappings')
      .update(payload)
      .eq('id', existingByExternal.id)
    if (error) throw error
    return
  }

  const { data: existingByProduct, error: productMappingError } = await client
    .from('integration_sync_mappings')
    .select('id, external_id')
    .eq('connection_id', connectionId)
    .eq('product_id', productId)
    .maybeSingle()

  if (productMappingError) throw productMappingError
  if (existingByProduct?.id) {
    throw new Error(`SKUMS product already mapped to WooCommerce product ${existingByProduct.external_id}`)
  }

  const { error } = await client
    .from('integration_sync_mappings')
    .insert(payload)

  if (error) throw error
}

async function completeExecution(
  client: SupabaseClient,
  executionId: string | null,
  startedAt: number,
  result: {
    status: 'success' | 'error'
    outputData?: Record<string, any>
    errorMessage?: string
    itemsProcessed?: number
    itemsCreated?: number
    itemsUpdated?: number
    itemsFailed?: number
  },
) {
  if (!executionId) return

  await client
    .from('integration_executions')
    .update({
      status: result.status,
      output_data: result.outputData || {},
      error_message: result.errorMessage || null,
      items_processed: result.itemsProcessed || 0,
      items_created: result.itemsCreated || 0,
      items_updated: result.itemsUpdated || 0,
      items_failed: result.itemsFailed || 0,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    })
    .eq('id', executionId)
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const connectionId = String(body.connection_id || '').trim()
  if (!connectionId) {
    throw createError({ statusCode: 400, statusMessage: 'connection_id is required' })
  }

  const client = getServiceClient()
  const { data: connection, error: connectionError } = await client
    .from('integration_connections')
    .select(`
      id,
      workspace_id,
      node_def_id,
      credential_id,
      name,
      status,
      config,
      total_synced,
      total_errors,
      node_definition:integration_node_definitions(slug, name),
      credential:integration_credentials(id, credential_data, is_valid)
    `)
    .eq('id', connectionId)
    .maybeSingle()

  if (connectionError) {
    throw createError({ statusCode: 500, statusMessage: connectionError.message })
  }
  if (!connection) {
    throw createError({ statusCode: 404, statusMessage: 'Connection not found' })
  }

  await requireWorkspaceAccess(event, client, connection.workspace_id, 'write')

  if (nodeSlug(connection) !== 'woocommerce') {
    throw createError({ statusCode: 400, statusMessage: 'Connection is not a WooCommerce connection' })
  }

  const credential = connectionCredential(connection)
  if (!credential?.credential_data) {
    throw createError({ statusCode: 400, statusMessage: 'WooCommerce connection has no credential' })
  }

  const config = (connection.config || {}) as Record<string, any>
  const wooConfig = (config.woocommerce || {}) as Record<string, any>
  const reset = body.reset === true
  const startPage = reset
    ? 1
    : clampInteger(body.page ?? wooConfig.next_page, 1, 1, 100000)
  const perPage = clampInteger(body.per_page, 100, 1, 100)
  const maxPages = clampInteger(body.max_pages, 5, 1, 25)
  const status = String(body.status || wooConfig.status || 'any')
  const includeVariations = body.include_variations !== false
  const startedAt = Date.now()
  let executionId: string | null = null

  const { data: execution } = await client
    .from('integration_executions')
    .insert({
      connection_id: connection.id,
      workspace_id: connection.workspace_id,
      execution_type: 'action',
      action_key: 'pull_products',
      input_data: {
        source: 'woocommerce',
        start_page: startPage,
        per_page: perPage,
        max_pages: maxPages,
        status,
        include_variations: includeVariations,
      },
    })
    .select('id')
    .single()

  executionId = execution?.id || null

  const stats: PullStats = {
    fetched: 0,
    created: 0,
    updated: 0,
    failed: 0,
    images: 0,
    variants: 0,
    errors: [],
  }

  let nextPage: number | null = startPage
  let hasMore = false
  let totalRemote: number | null = null
  let totalPages: number | null = null

  try {
    const credentials = credential.credential_data as WooCommerceCredentials
    const currency = await getWooCommerceCurrency(credentials)

    for (let i = 0; i < maxPages && nextPage; i++) {
      const page = await fetchWooCommerceProductsPage(credentials, {
        page: nextPage,
        perPage,
        status,
      })

      totalRemote = page.total
      totalPages = page.total_pages
      hasMore = page.has_more
      nextPage = page.next_page
      stats.fetched += page.data.length

      for (const product of page.data) {
        try {
          const variations = includeVariations && product.variations?.length
            ? await fetchWooCommerceVariations(credentials, product.id)
            : []
          const result = await upsertProduct(client, connection.workspace_id, connection.id, product, variations, currency)
          if (result.operation === 'created') stats.created += 1
          else stats.updated += 1

          stats.images += await syncImages(client, result.productId, product)
          stats.variants += await syncVariants(client, result.productId, product, variations)
          await syncMapping(client, connection.id, result.productId, product)
        } catch (error: any) {
          stats.failed += 1
          stats.errors.push({
            external_id: String(product.id),
            message: error?.message || 'Product import failed',
          })
        }
      }

      if (!page.has_more) break
    }

    const now = new Date().toISOString()
    const nextWooConfig = {
      ...wooConfig,
      status,
      per_page: perPage,
      next_page: hasMore ? nextPage : 1,
      has_more: hasMore,
      last_pull_started_page: startPage,
      last_pull_finished_at: now,
      last_remote_total: totalRemote,
      last_remote_total_pages: totalPages,
    }
    const lastError = stats.failed > 0 ? `${stats.failed} WooCommerce product(s) failed to import` : null

    await client
      .from('integration_connections')
      .update({
        status: stats.failed > 0 ? 'error' : 'active',
        config: {
          ...config,
          woocommerce: nextWooConfig,
        },
        last_synced_at: now,
        last_error: lastError,
        total_synced: (connection.total_synced || 0) + stats.created + stats.updated,
        total_errors: (connection.total_errors || 0) + stats.failed,
      })
      .eq('id', connection.id)

    await completeExecution(client, executionId, startedAt, {
      status: stats.failed > 0 ? 'error' : 'success',
      outputData: {
        source: 'woocommerce',
        has_more: hasMore,
        next_page: hasMore ? nextPage : null,
        ...stats,
        errors: stats.errors.slice(0, 20),
      },
      itemsProcessed: stats.fetched,
      itemsCreated: stats.created,
      itemsUpdated: stats.updated,
      itemsFailed: stats.failed,
    })

    return {
      ok: stats.failed === 0,
      connection_id: connection.id,
      start_page: startPage,
      has_more: hasMore,
      next_page: hasMore ? nextPage : null,
      total_remote: totalRemote,
      total_pages: totalPages,
      ...stats,
      errors: stats.errors.slice(0, 20),
    }
  } catch (error: any) {
    const message = error?.message || 'WooCommerce product pull failed'

    await client
      .from('integration_connections')
      .update({
        status: 'error',
        last_error: message,
        total_errors: (connection.total_errors || 0) + 1,
      })
      .eq('id', connection.id)

    await completeExecution(client, executionId, startedAt, {
      status: 'error',
      outputData: { source: 'woocommerce', ...stats, errors: stats.errors.slice(0, 20) },
      errorMessage: message,
      itemsProcessed: stats.fetched,
      itemsCreated: stats.created,
      itemsUpdated: stats.updated,
      itemsFailed: stats.failed + 1,
    })

    throw createError({ statusCode: 502, statusMessage: message })
  }
})
