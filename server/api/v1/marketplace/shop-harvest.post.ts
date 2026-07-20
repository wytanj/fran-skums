/**
 * Ingest Mall shop product harvest from Chrome extension.
 * Fields of interest: name, sold, category (+ ids for upsert).
 *
 * POST /api/v1/marketplace/shop-harvest
 * Scope: intel:write
 *
 * Body:
 *   shop_username, brand_key?, page_url?, page?, sort_by?, active_category?,
 *   products: [{ name, sold_label, sold_count_lower_bound?, category?, shop_id, item_id, listing_url, rank_position? }]
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { harvestToObservationCards } from '../../../../marketplace/shopProductExtract.mjs'
import { upsertObservationCards } from '../../../../marketplace/writers/upsertObservations.mjs'
import { stampBrandSignalsOnCards } from '../../../../marketplace/stampBrandSignals.mjs'
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
    products,
    harvested_at: new Date().toISOString(),
  }

  let brand_key = body.brand_key || null
  const db = getServiceClient()

  // Resolve brand_key from universe shop_username when not provided
  if (!brand_key && harvest.shop_username) {
    const { data: u } = await db
      .from('marketplace_brand_universe')
      .select('brand_key, id')
      .eq('workspace_id', auth.workspaceId)
      .eq('shop_username', String(harvest.shop_username).toLowerCase())
      .maybeSingle()
    if (u?.brand_key) brand_key = u.brand_key

    // Keep shop resolve confirmed
    if (u?.id) {
      await db
        .from('marketplace_brand_universe')
        .update({
          shop_id: harvest.shop_id || null,
          shop_url: harvest.shop_username
            ? `https://shopee.sg/${harvest.shop_username}`
            : null,
          shop_resolve_status: 'confirmed',
          shop_resolve_source: 'import',
        })
        .eq('id', u.id)
    }
  }

  let cards = harvestToObservationCards(harvest, { brand_key })
  cards = stampBrandSignalsOnCards(cards, {
    target: harvest.shop_username || brand_key || 'shop',
    mode: 'shop',
    metadata: {
      brand_key,
      shop_username: harvest.shop_username,
      universe_id: null,
    },
  })

  const write = await upsertObservationCards(db, {
    workspace_id: auth.workspaceId,
    marketplace: 'shopee',
    country: 'sg',
    crawl_job_id: null,
    cards,
  })

  return {
    ok: true,
    brand_key,
    shop_username: harvest.shop_username,
    product_count: products.length,
    write,
    sample: products.slice(0, 3).map((p: any) => ({
      name: p.name,
      sold_label: p.sold_label,
      category: p.category || harvest.active_category,
    })),
  }
})
