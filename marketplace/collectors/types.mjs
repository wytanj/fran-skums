/**
 * @typedef {import('../sellerTaxonomy.mjs').SellerType} SellerType
 */

/**
 * @typedef {object} ObservedListingCard
 * @property {string} shop_id
 * @property {string} item_id
 * @property {string} title
 * @property {string} listing_url
 * @property {string} [shop_name]
 * @property {string} seller_type
 * @property {number} [price]
 * @property {number} [original_price]
 * @property {string} currency
 * @property {number} [rating]
 * @property {number} [review_count]
 * @property {string} [sold_label]
 * @property {number} [sold_count_lower_bound]
 * @property {number} rank_position
 * @property {string} [search_query]
 * @property {string} [image_url]
 * @property {Record<string, boolean|number|string>} [signals]
 * @property {Record<string, unknown>} raw
 */

/**
 * @typedef {object} CollectSeedInput
 * @property {string} id
 * @property {string} workspace_id
 * @property {string} marketplace
 * @property {string} country
 * @property {string} mode
 * @property {string} target
 * @property {number} max_pages
 * @property {number} max_listings
 * @property {number} detail_top_n
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {object} CollectResult
 * @property {ObservedListingCard[]} cards
 * @property {Record<string, unknown>[]} [details]
 * @property {'ok'|'login_required'|'blocked'|'unknown'} session_health
 */

/**
 * @typedef {object} CollectAdapter
 * @property {string} id
 * @property {(seed: CollectSeedInput, jobId: string) => Promise<CollectResult>} scrapeSeed
 */

export {}
