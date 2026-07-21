/**
 * Ingest Mall shop product harvest from Chrome extension.
 * Fields of interest: name, sold, category (+ ids for upsert).
 *
 * POST /api/v1/marketplace/shop-harvest
 * Scope: intel:write
 *
 * Body:
 *   shop_username, brand_key?, page_url?, page?, sort_by?, active_category?,
 *   multi_brand?: boolean
 *   products: [{ name, sold_label, sold_count_lower_bound?, category?, shop_id, item_id, listing_url, rank_position? }]
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { harvestToObservationCards } from '../../../../marketplace/shopProductExtract.mjs'
import { upsertObservationCards } from '../../../../marketplace/writers/upsertObservations.mjs'
import { stampBrandSignalsOnCards } from '../../../../marketplace/stampBrandSignals.mjs'
import {
  isMultiBrandDistributor,
  loadBrandsForShopUsername,
} from '../../../../marketplace/distributorShop.mjs'
import { getServiceClient } from '../../../utils/supabase'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:write')
  const body = await readBody(event)

  const products = Array.isArray(body?.products) ? body.products : []
  if (!products.length) {
    throw createError({ statusCode: 400, statusMessage: 'products[] required' })
  }

  const harvest = {
    shop_username: body.shop_username || null,
    shop_id: body.shop_id || products[0]?.shop_id || null,
    page_url: body.page_url || null,
    page: body.page ?? 0,
    sort_by: body.sort_by || 'pop',
    active_category: body.active_category || 'All Products',
    shop_collection_name: body.active_category || body.shop_collection_name || 'All Products',
    shop_collection_id: body.shop_collection_id ?? null,
    harvest_source: body.harvest_source || 'mall_list_harvest',
    products,
    harvested_at: new Date().toISOString(),
  }

  let brand_key = body.brand_key || null
  const db = getServiceClient()

  // Load all universe rows for this shop (multi-brand may return several)
  let shopRows: any[] = []
  if (harvest.shop_username) {
    const { data } = await db
      .from('marketplace_brand_universe')
      .select('id, brand_key, display_name, shop_kind, metadata, shop_username')
      .eq('workspace_id', auth.workspaceId)
      .eq('shop_username', String(harvest.shop_username).toLowerCase())
      .limit(50)
    shopRows = data || []
  }

  const multi =
    body.multi_brand === true ||
    shopRows.some((r) => isMultiBrandDistributor(r)) ||
    shopRows.length > 1

  if (!brand_key && shopRows.length === 1 && !multi) {
    brand_key = shopRows[0].brand_key
  }

  let brand_profiles = null
  if (multi && harvest.shop_username) {
    brand_profiles = await loadBrandsForShopUsername(
      db,
      auth.workspaceId,
      harvest.shop_username,
    )
  }

  // Keep shop resolve confirmed on all linked brands
  if (shopRows.length && harvest.shop_id) {
    for (const u of shopRows) {
      await db
        .from('marketplace_brand_universe')
        .update({
          shop_id: harvest.shop_id || null,
          shop_url: harvest.shop_username
            ? `https://shopee.sg/${harvest.shop_username}`
            : null,
          shop_resolve_status: 'confirmed',
        })
        .eq('id', u.id)
    }
  }

  let cards = harvestToObservationCards(harvest, {
    brand_key,
    multi_brand: multi,
    brand_profiles: brand_profiles || undefined,
  })
  cards = stampBrandSignalsOnCards(cards, {
    target: harvest.shop_username || brand_key || 'shop',
    mode: 'shop',
    shop_kind: multi ? 'multi_brand_distributor' : 'single_brand',
    metadata: {
      brand_key,
      shop_username: harvest.shop_username,
      shop_kind: multi ? 'multi_brand_distributor' : 'single_brand',
    },
  })

  const write = await upsertObservationCards(db, {
    workspace_id: auth.workspaceId,
    marketplace: 'shopee',
    country: 'sg',
    crawl_job_id: null,
    cards,
  })

  const attributed = cards.filter((c) => c.signals?.brand_key).length

  return {
    ok: true,
    brand_key,
    multi_brand: multi,
    shop_username: harvest.shop_username,
    product_count: products.length,
    attributed_count: attributed,
    unattributed_count: products.length - attributed,
    brand_allowlist: brand_profiles?.map((b: any) => b.brand_key) || null,
    write,
    sample: products.slice(0, 3).map((p: any) => ({
      name: p.name,
      sold_label: p.sold_label,
      category: p.category || harvest.active_category,
    })),
  }
})
