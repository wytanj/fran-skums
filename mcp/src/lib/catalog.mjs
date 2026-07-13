/**
 * MCP catalog Q&A (shared core/catalog).
 */
import {
  catalogGet,
  catalogSearch,
  catalogStats,
  fetchCatalogMatchPool,
} from '../../../core/catalog/index.mjs'
import { getDb } from '../context.mjs'

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} [args]
 */
export async function searchCatalog(workspaceId, args = {}) {
  return catalogSearch(getDb(), {
    workspace_id: workspaceId,
    q: args.q || args.query || null,
    status: args.status || null,
    brand: args.brand || null,
    sku: args.sku || null,
    ean: args.ean || null,
    upc: args.upc || null,
    gtin: args.gtin || null,
    limit: args.limit,
    offset: args.offset,
  })
}

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} [args]
 */
export async function statsCatalog(workspaceId, args = {}) {
  return catalogStats(getDb(), {
    workspace_id: workspaceId,
    brand: args.brand || null,
    top_brands: args.top_brands,
  })
}

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} [args]
 */
export async function getCatalogProduct(workspaceId, args = {}) {
  return catalogGet(getDb(), {
    workspace_id: workspaceId,
    id: args.id || args.product_id || null,
    sku: args.sku || null,
    ean: args.ean || null,
    upc: args.upc || null,
    gtin: args.gtin || null,
  })
}

/**
 * @param {string} workspaceId
 * @param {{ query?: string, listing_titles?: string[], limit?: number }} [args]
 */
export async function matchPool(workspaceId, args = {}) {
  return fetchCatalogMatchPool(getDb(), {
    workspace_id: workspaceId,
    query: args.query,
    listing_titles: args.listing_titles,
    limit: args.limit,
  })
}
