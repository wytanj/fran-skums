/**
 * MCP inventory ATS + product logistics status (shared core/inventory).
 */
import { inventoryAts, productInventoryStatus } from '../../../core/inventory/index.mjs'
import { getDb } from '../context.mjs'

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} [args]
 */
export async function atsInventory(workspaceId, args = {}) {
  const skus = []
  if (args.sku) skus.push(String(args.sku))
  if (Array.isArray(args.skus)) skus.push(...args.skus.map(String))

  const product_ids = []
  if (args.product_id) product_ids.push(String(args.product_id))
  if (Array.isArray(args.product_ids)) product_ids.push(...args.product_ids.map(String))

  return inventoryAts(getDb(), {
    workspace_id: workspaceId,
    skus: skus.length ? skus : undefined,
    product_ids: product_ids.length ? product_ids : undefined,
    q: args.q || args.query || null,
    location_codes: args.location_codes || null,
  })
}

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} [args]
 */
export async function productStatus(workspaceId, args = {}) {
  return productInventoryStatus(getDb(), {
    workspace_id: workspaceId,
    sku: args.sku || null,
    product_id: args.product_id || args.id || null,
    q: args.q || args.query || null,
  })
}
