/**
 * Upsert marketplace shops, listings, and insert snapshots from collect cards.
 * Accepts a Supabase-like client: { from(table).upsert|insert|select... }
 *
 * Pure orchestration — no browser.
 */

/**
 * @param {any} db Supabase service client
 * @param {{
 *   workspace_id: string
 *   marketplace?: string
 *   country?: string
 *   crawl_job_id?: string | null
 *   cards: Array<Record<string, any>>
 * }} input
 */
export async function upsertObservationCards(db, input) {
  const workspace_id = input.workspace_id
  const marketplace = input.marketplace || 'shopee'
  const country = input.country || 'sg'
  const crawl_job_id = input.crawl_job_id || null
  const cards = Array.isArray(input.cards) ? input.cards : []

  const result = {
    shops_upserted: 0,
    listings_upserted: 0,
    snapshots_inserted: 0,
    skipped: 0,
    errors: /** @type {string[]} */ ([]),
  }

  const now = new Date().toISOString()

  for (const card of cards) {
    try {
      const shop_id = String(card.shop_id || '')
      const item_id = String(card.item_id || '')
      if (!shop_id || !item_id) {
        result.skipped++
        continue
      }

      const seller_type = card.seller_type || 'unknown'

      // Shop
      const shopRow = {
        workspace_id,
        marketplace,
        country,
        shop_id,
        shop_name: card.shop_name || null,
        seller_type,
        last_seen_at: now,
        raw_identity: { source: 'collect', shop_id },
      }

      const { data: shop, error: shopErr } = await db
        .from('marketplace_shops')
        .upsert(shopRow, {
          onConflict: 'workspace_id,marketplace,country,shop_id',
        })
        .select('id')
        .single()

      if (shopErr) {
        result.errors.push(`shop ${shop_id}: ${shopErr.message}`)
      } else {
        result.shops_upserted++
      }

      // Listing
      const listingRow = {
        workspace_id,
        marketplace,
        country,
        shop_id,
        item_id,
        listing_url: card.listing_url || null,
        title: card.title || null,
        shop_name: card.shop_name || null,
        seller_type,
        image_url: card.image_url || null,
        status: 'active',
        marketplace_shop_row_id: shop?.id || null,
        raw_identity: {
          shop_id,
          item_id,
        },
        last_seen_at: now,
      }

      const { data: listing, error: listErr } = await db
        .from('marketplace_listings')
        .upsert(listingRow, {
          onConflict: 'workspace_id,marketplace,country,shop_id,item_id',
        })
        .select('id')
        .single()

      if (listErr || !listing) {
        result.errors.push(`listing ${shop_id}/${item_id}: ${listErr?.message || 'no row'}`)
        result.skipped++
        continue
      }
      result.listings_upserted++

      const snapshotRow = {
        workspace_id,
        listing_id: listing.id,
        crawl_job_id,
        crawled_at: now,
        price: card.price ?? null,
        original_price: card.original_price ?? null,
        currency: card.currency || 'SGD',
        price_sgd: country === 'sg' ? card.price ?? null : null,
        rating: card.rating ?? null,
        review_count: card.review_count ?? null,
        sold_label: card.sold_label ?? null,
        sold_count_lower_bound: card.sold_count_lower_bound ?? null,
        availability: card.price != null ? 'in_stock' : 'unknown',
        rank_position: card.rank_position ?? null,
        search_query: card.search_query ?? null,
        seller_type,
        signals: card.signals || {},
        raw_observation: card.raw || card,
      }

      const { error: snapErr } = await db
        .from('marketplace_listing_snapshots')
        .insert(snapshotRow)

      if (snapErr) {
        result.errors.push(`snapshot ${listing.id}: ${snapErr.message}`)
      } else {
        result.snapshots_inserted++
      }
    } catch (err) {
      result.errors.push(err?.message || String(err))
      result.skipped++
    }
  }

  return result
}
