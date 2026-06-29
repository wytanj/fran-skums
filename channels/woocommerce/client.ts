import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { AuthCredentials, ProjectedSku } from '../_types'

export interface WooCommerceCredentials extends AuthCredentials {
  site_url?: string
  consumer_key?: string
  consumer_secret?: string
  currency?: string
}

export interface WooCommerceTerm {
  id?: number
  name?: string
  slug?: string
}

export interface WooCommerceImage {
  id?: number
  src?: string
  name?: string
  alt?: string
  position?: number
}

export interface WooCommerceAttribute {
  id?: number
  name?: string
  slug?: string
  option?: string
  options?: string[]
  visible?: boolean
  variation?: boolean
}

export interface WooCommerceMeta {
  id?: number
  key?: string
  value?: unknown
}

export interface WooCommerceVariation {
  id: number
  sku?: string
  price?: string
  regular_price?: string
  sale_price?: string
  stock_quantity?: number | null
  manage_stock?: boolean
  stock_status?: string
  weight?: string
  dimensions?: {
    length?: string
    width?: string
    height?: string
  }
  image?: WooCommerceImage
  attributes?: WooCommerceAttribute[]
  meta_data?: WooCommerceMeta[]
  date_modified?: string
}

export interface WooCommerceProduct {
  id: number
  name?: string
  slug?: string
  permalink?: string
  date_created?: string
  date_modified?: string
  type?: string
  status?: string
  catalog_visibility?: string
  sku?: string
  price?: string
  regular_price?: string
  sale_price?: string
  description?: string
  short_description?: string
  manage_stock?: boolean
  stock_quantity?: number | null
  stock_status?: string
  weight?: string
  dimensions?: {
    length?: string
    width?: string
    height?: string
  }
  categories?: WooCommerceTerm[]
  tags?: WooCommerceTerm[]
  images?: WooCommerceImage[]
  attributes?: WooCommerceAttribute[]
  default_attributes?: WooCommerceAttribute[]
  variations?: number[]
  grouped_products?: number[]
  upsell_ids?: number[]
  cross_sell_ids?: number[]
  meta_data?: WooCommerceMeta[]
  average_rating?: string
  rating_count?: number
  parent_id?: number
  virtual?: boolean
  downloadable?: boolean
  external_url?: string
  button_text?: string
}

export interface WooCommercePage<T> {
  data: T[]
  page: number
  per_page: number
  total: number | null
  total_pages: number | null
  has_more: boolean
  next_page: number | null
}

export interface SkumsProductFromWooCommerce {
  title: string
  sku: string | null
  ean: string | null
  upc: string | null
  gtin: string | null
  mpn: string | null
  description: string | null
  short_description: string | null
  retail_price: number | null
  sale_price: number | null
  currency: string
  weight: number | null
  weight_unit: 'kg' | 'lb' | 'g' | 'oz'
  length: number | null
  width: number | null
  height: number | null
  dimension_unit: 'cm' | 'in' | 'm' | 'ft'
  stock_quantity: number
  track_inventory: boolean
  status: 'draft' | 'active' | 'archived'
  canonical_url: string | null
  tags: string[]
  brand_name: string | null
  category_name: string | null
  product_data: Record<string, unknown>
}

export interface SkumsVariantFromWooCommerce {
  sku: string | null
  ean: string | null
  upc: string | null
  gtin: string | null
  title: string
  options: Record<string, string>
  retail_price: number | null
  sale_price: number | null
  stock_quantity: number
  weight: number | null
  image_url: string | null
  is_active: boolean
}

const DEFAULT_CURRENCY = 'USD'

function cleanPath(path: string): string {
  return path.replace(/^\/+/, '')
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function normalizeWooCommerceCredentials(credentials: WooCommerceCredentials) {
  const rawSiteUrl = String(credentials.site_url || '').trim()
  const consumerKey = String(credentials.consumer_key || '').trim()
  const consumerSecret = String(credentials.consumer_secret || '').trim()

  if (!rawSiteUrl) throw new Error('WooCommerce site_url is required')
  if (!consumerKey) throw new Error('WooCommerce consumer_key is required')
  if (!consumerSecret) throw new Error('WooCommerce consumer_secret is required')

  const url = new URL(/^https?:\/\//i.test(rawSiteUrl) ? rawSiteUrl : `https://${rawSiteUrl}`)
  url.pathname = url.pathname.replace(/\/+$/, '')

  if (url.protocol !== 'https:' && !isLocalHost(url.hostname)) {
    throw new Error('WooCommerce site_url must use HTTPS for Basic Auth credentials')
  }

  return {
    siteUrl: url,
    consumerKey,
    consumerSecret,
    currency: String(credentials.currency || DEFAULT_CURRENCY).toUpperCase(),
  }
}

export async function fetchWooCommerceApi<T>(
  credentials: WooCommerceCredentials,
  path: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
): Promise<{ data: T; headers: Headers }> {
  const normalized = normalizeWooCommerceCredentials(credentials)
  const url = new URL(`/wp-json/wc/v3/${cleanPath(path)}`, normalized.siteUrl)

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${normalized.consumerKey}:${normalized.consumerSecret}`).toString('base64')}`,
      'User-Agent': 'SKUMS WooCommerce Connector/1.0',
    },
  })

  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }

  if (!response.ok) {
    const detail = typeof parsed === 'object' && parsed && 'message' in parsed
      ? String((parsed as { message?: unknown }).message)
      : text.slice(0, 240)
    throw new Error(`WooCommerce API ${response.status}: ${detail || response.statusText}`)
  }

  return { data: parsed as T, headers: response.headers }
}

function headerInt(headers: Headers, key: string): number | null {
  const raw = headers.get(key)
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export async function fetchWooCommerceProductsPage(
  credentials: WooCommerceCredentials,
  opts: { page?: number; perPage?: number; status?: string } = {},
): Promise<WooCommercePage<WooCommerceProduct>> {
  const page = Math.max(Math.floor(opts.page || 1), 1)
  const perPage = Math.min(Math.max(Math.floor(opts.perPage || 100), 1), 100)
  const status = opts.status || 'any'
  const { data, headers } = await fetchWooCommerceApi<WooCommerceProduct[]>(credentials, 'products', {
    page,
    per_page: perPage,
    status,
    orderby: 'id',
    order: 'asc',
  })

  const total = headerInt(headers, 'x-wp-total')
  const totalPages = headerInt(headers, 'x-wp-totalpages')
  const hasMore = totalPages !== null ? page < totalPages : data.length === perPage

  return {
    data,
    page,
    per_page: perPage,
    total,
    total_pages: totalPages,
    has_more: hasMore,
    next_page: hasMore ? page + 1 : null,
  }
}

export async function fetchWooCommerceVariations(
  credentials: WooCommerceCredentials,
  productId: number,
  maxPages = 5,
): Promise<WooCommerceVariation[]> {
  const variations: WooCommerceVariation[] = []
  for (let page = 1; page <= maxPages; page++) {
    const { data, headers } = await fetchWooCommerceApi<WooCommerceVariation[]>(
      credentials,
      `products/${productId}/variations`,
      { page, per_page: 100, orderby: 'id', order: 'asc' },
    )
    variations.push(...data)

    const totalPages = headerInt(headers, 'x-wp-totalpages')
    if (totalPages !== null ? page >= totalPages : data.length < 100) break
  }
  return variations
}

export async function testWooCommerceCredentials(credentials: WooCommerceCredentials) {
  const page = await fetchWooCommerceProductsPage(credentials, { page: 1, perPage: 1, status: 'any' })
  return {
    ok: true,
    details: `Connected to WooCommerce products endpoint. Store returned ${page.total ?? page.data.length} product record(s).`,
  }
}

export async function getWooCommerceCurrency(credentials: WooCommerceCredentials): Promise<string> {
  try {
    const { data } = await fetchWooCommerceApi<{ value?: string }>(
      credentials,
      'settings/general/woocommerce_currency',
    )
    if (data?.value) return String(data.value).toUpperCase()
  } catch {
    // Older stores or restricted keys can still sync product data without this setting.
  }
  return normalizeWooCommerceCredentials(credentials).currency
}

export function stableWooCommerceHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function parseWooCommerceNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  let raw = String(value).trim()
  if (!raw) return null

  raw = raw.replace(/[^\d.,-]/g, '')
  if (raw.includes(',') && raw.includes('.')) {
    raw = raw.replace(/,/g, '')
  } else if (raw.includes(',') && !raw.includes('.')) {
    raw = raw.replace(',', '.')
  }

  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function parseInteger(value: unknown): number | null {
  const parsed = parseWooCommerceNumber(value)
  return parsed === null ? null : Math.round(parsed)
}

export function stripWooCommerceHtml(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const stripped = String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped || null
}

function termName(term: WooCommerceTerm | undefined): string | null {
  const name = String(term?.name || '').trim()
  return name || null
}

function metaValue(product: { meta_data?: WooCommerceMeta[] }, keys: string[]): string | null {
  const wanted = new Set(keys.map(k => k.toLowerCase()))
  const hit = product.meta_data?.find(meta => meta.key && wanted.has(String(meta.key).toLowerCase()))
  if (!hit || hit.value === null || hit.value === undefined) return null
  const value = String(hit.value).trim()
  return value || null
}

function attributeValue(product: { attributes?: WooCommerceAttribute[] }, names: string[]): string | null {
  const wanted = new Set(names.map(n => n.toLowerCase()))
  const attr = product.attributes?.find(attribute => {
    const name = String(attribute.name || attribute.slug || '').toLowerCase()
    return wanted.has(name)
  })
  if (!attr) return null
  if (Array.isArray(attr.options)) {
    return attr.options.map(String).find(Boolean) || null
  }
  return attr.option ? String(attr.option) : null
}

export function extractWooCommerceIdentifiers(product: WooCommerceProduct | WooCommerceVariation) {
  const gtin = metaValue(product, [
    '_global_unique_id',
    'global_unique_id',
    '_wc_gla_gtin',
    '_wpm_gtin_code',
    '_alg_ean',
    'gtin',
  ])
  const ean = metaValue(product, ['ean', '_ean', '_alg_ean'])
  const upc = metaValue(product, ['upc', '_upc'])
  const mpn = metaValue(product, ['mpn', '_mpn'])

  return {
    gtin: gtin || ean || upc,
    ean,
    upc,
    mpn,
  }
}

export function extractWooCommerceBrand(product: WooCommerceProduct): string | null {
  const brandFromMeta = metaValue(product, ['brand', '_brand', 'manufacturer', '_manufacturer'])
  if (brandFromMeta) return brandFromMeta

  const brandFromAttribute = attributeValue(product, ['brand', 'pa_brand', 'manufacturer'])
  if (brandFromAttribute) return brandFromAttribute

  const brandFromTerm = (product as WooCommerceProduct & { brands?: WooCommerceTerm[] }).brands?.[0]
  return termName(brandFromTerm)
}

export function wooCommerceStatusToSkums(status: string | undefined): 'draft' | 'active' | 'archived' {
  if (status === 'publish') return 'active'
  if (status === 'trash') return 'archived'
  return 'draft'
}

export function mapWooCommerceProductToSkumsProduct(
  product: WooCommerceProduct,
  currency = DEFAULT_CURRENCY,
): SkumsProductFromWooCommerce {
  const identifiers = extractWooCommerceIdentifiers(product)
  const stockQuantity = product.manage_stock ? parseInteger(product.stock_quantity) ?? 0 : 0
  const primaryCategory = product.categories?.[0]
  const tags = (product.tags || []).map(term => termName(term)).filter(Boolean) as string[]
  const images = (product.images || []).filter(image => image.src)
  const retailPrice = parseWooCommerceNumber(product.regular_price) ?? parseWooCommerceNumber(product.price)
  const salePrice = parseWooCommerceNumber(product.sale_price)

  return {
    title: String(product.name || product.sku || `WooCommerce product ${product.id}`).trim(),
    sku: product.sku?.trim() || null,
    ean: identifiers.ean,
    upc: identifiers.upc,
    gtin: identifiers.gtin,
    mpn: identifiers.mpn,
    description: stripWooCommerceHtml(product.description),
    short_description: stripWooCommerceHtml(product.short_description),
    retail_price: retailPrice,
    sale_price: salePrice,
    currency,
    weight: parseWooCommerceNumber(product.weight),
    weight_unit: 'kg',
    length: parseWooCommerceNumber(product.dimensions?.length),
    width: parseWooCommerceNumber(product.dimensions?.width),
    height: parseWooCommerceNumber(product.dimensions?.height),
    dimension_unit: 'cm',
    stock_quantity: stockQuantity,
    track_inventory: Boolean(product.manage_stock),
    status: wooCommerceStatusToSkums(product.status),
    canonical_url: product.permalink || null,
    tags,
    brand_name: extractWooCommerceBrand(product),
    category_name: termName(primaryCategory),
    product_data: {
      source: 'woocommerce',
      external_source: 'woocommerce',
      woocommerce: {
        product_id: product.id,
        parent_id: product.parent_id || null,
        slug: product.slug || null,
        type: product.type || null,
        status: product.status || null,
        catalog_visibility: product.catalog_visibility || null,
        stock_status: product.stock_status || null,
        average_rating: parseWooCommerceNumber(product.average_rating),
        rating_count: product.rating_count ?? null,
        categories: product.categories || [],
        tags: product.tags || [],
        images,
        attributes: product.attributes || [],
        default_attributes: product.default_attributes || [],
        variation_ids: product.variations || [],
        grouped_products: product.grouped_products || [],
        upsell_ids: product.upsell_ids || [],
        cross_sell_ids: product.cross_sell_ids || [],
        raw_product: product,
      },
    },
  }
}

export function mapWooCommerceVariationToSkumsVariant(
  variation: WooCommerceVariation,
  product: WooCommerceProduct,
): SkumsVariantFromWooCommerce {
  const identifiers = extractWooCommerceIdentifiers(variation)
  const optionEntries = (variation.attributes || [])
    .map(attr => [String(attr.name || attr.slug || '').trim(), String(attr.option || attr.options?.[0] || '').trim()])
    .filter(([name, value]) => name && value)

  const options = Object.fromEntries(optionEntries)
  const optionTitle = Object.values(options).join(' / ')
  const retailPrice = parseWooCommerceNumber(variation.regular_price) ?? parseWooCommerceNumber(variation.price)

  return {
    sku: variation.sku?.trim() || null,
    ean: identifiers.ean,
    upc: identifiers.upc,
    gtin: identifiers.gtin,
    title: optionTitle || String(product.name || `Variation ${variation.id}`),
    options,
    retail_price: retailPrice,
    sale_price: parseWooCommerceNumber(variation.sale_price),
    stock_quantity: variation.manage_stock ? parseInteger(variation.stock_quantity) ?? 0 : 0,
    weight: parseWooCommerceNumber(variation.weight),
    image_url: variation.image?.src || null,
    is_active: variation.stock_status !== 'outofstock',
  }
}

export function skumsToWooCommerceProduct(sku: ProjectedSku): Record<string, unknown> {
  return {
    name: sku.name || sku.sku,
    sku: sku.sku || undefined,
    type: 'simple',
    regular_price: sku.retail_price !== undefined ? String(sku.retail_price) : undefined,
    sale_price: sku.sale_price !== undefined ? String(sku.sale_price) : undefined,
    description: sku.description || undefined,
    short_description: sku.short_description || undefined,
    manage_stock: true,
    stock_quantity: sku.attributes?.stock_quantity,
    weight: sku.weight !== undefined ? String(sku.weight) : undefined,
    dimensions: sku.dimensions
      ? {
          length: String(sku.dimensions.length),
          width: String(sku.dimensions.width),
          height: String(sku.dimensions.height),
        }
      : undefined,
    images: sku.images?.map(image => ({
      src: image.url,
      alt: image.alt,
    })),
  }
}
