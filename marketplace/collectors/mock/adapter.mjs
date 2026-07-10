/**
 * Mock collect adapter — deterministic fixtures for tests and dry-runs.
 * Never hits the network.
 */

import { parseSoldLabel } from '../../soldLabel.mjs'
import { normalizeSellerType } from '../../sellerTaxonomy.mjs'

/** @type {import('../types.mjs').CollectAdapter} */
export const mockCollectAdapter = {
  id: 'mock',

  async scrapeSeed(seed, jobId) {
    const query = seed.target || 'demo'
    const host = seed.country === 'sg' ? 'shopee.sg' : `shopee.${seed.country}`

    const fixtures = [
      {
        shop_id: '100001',
        item_id: '200001',
        title: `${query} Official Mall Serum 30ml`,
        shop_name: 'Demo Official Mall',
        seller_type: 'mall',
        price: 24.9,
        original_price: 29.9,
        currency: 'SGD',
        rating: 4.9,
        review_count: 3200,
        sold_label: '5.2k sold',
        rank_position: 1,
      },
      {
        shop_id: '100002',
        item_id: '200002',
        title: `${query} Preferred Seller Bundle`,
        shop_name: 'Preferred Beauty SG',
        seller_type: 'preferred',
        price: 21.5,
        currency: 'SGD',
        rating: 4.7,
        review_count: 890,
        sold_label: '1.1k+ sold',
        rank_position: 2,
      },
      {
        shop_id: '100003',
        item_id: '200003',
        title: `${query} Reseller / Dropship-style listing`,
        shop_name: 'Global Deals Store',
        seller_type: 'normal',
        price: 18.9,
        currency: 'SGD',
        rating: 4.5,
        review_count: 120,
        sold_label: '456 sold',
        rank_position: 3,
        signals: { ships_from_overseas: true, title_clone_of_official: true },
      },
    ]

    const limit = Math.min(seed.max_listings || 60, fixtures.length)
    const cards = fixtures.slice(0, limit).map((f) => {
      const sold = parseSoldLabel(f.sold_label)
      return {
        shop_id: f.shop_id,
        item_id: f.item_id,
        title: f.title,
        listing_url: `https://${host}/product/${f.shop_id}/${f.item_id}`,
        shop_name: f.shop_name,
        seller_type: normalizeSellerType(f.seller_type),
        price: f.price,
        original_price: f.original_price,
        currency: f.currency || 'SGD',
        rating: f.rating,
        review_count: f.review_count,
        sold_label: f.sold_label,
        sold_count_lower_bound: sold.lower_bound ?? undefined,
        rank_position: f.rank_position,
        search_query: seed.mode === 'keyword' ? query : undefined,
        signals: f.signals || {},
        raw: {
          fixture: true,
          job_id: jobId,
          seed_id: seed.id,
          source: 'mock',
        },
      }
    })

    return {
      cards,
      session_health: 'ok',
      details: [],
    }
  },
}

export default mockCollectAdapter
