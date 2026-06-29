import { normalizeFranProductMetadata } from '../../core/fran/productMetadata'

type ProductRow = Record<string, any>

export function toFranProductContext(product: ProductRow) {
  const metadata = normalizeFranProductMetadata(product)

  return {
    product_id: product.id || product.product_id || null,
    sku: product.sku || null,
    barcode: product.gtin || product.ean || product.upc || null,
    title: product.title || product.display_name || null,
    brand: metadata.fran_brand,
    category: metadata.fran_category,
    collection: metadata.fran_collection,
    tags: Array.isArray(product.tags) ? product.tags : [],
    reward_eligible: metadata.fran_reward_eligible,
    reward_exclusion_reason: metadata.fran_reward_exclusion_reason,
    sample_eligible: metadata.fran_sample_eligible,
    return_policy_group: metadata.fran_return_policy_group,
    store_pickup_eligible: metadata.fran_store_pickup_eligible,
    fulfillment_profile_3pl: metadata.fran_3pl_fulfillment_profile,
    skin_concern_tags: metadata.fran_skin_concern_tags,
    sensitivity_flags: metadata.fran_sensitivity_flags,
    restricted_product_flags: metadata.restricted_product_flags,
  }
}

export function attachFranContext<T extends Record<string, any>>(item: T, product: ProductRow = item): T & { fran: ReturnType<typeof toFranProductContext> } {
  const fran = toFranProductContext({
    ...product,
    id: product.id || item.product_id || item.id,
    title: product.title || item.title || item.display_name,
    sku: product.sku || item.sku,
    brand_name: product.brand_name || item.brand_name,
    category_name: product.category_name || item.category_name,
  })

  return {
    ...item,
    fran,
    metadata: {
      ...(item.metadata || {}),
      fran,
    },
  }
}

export function productSelectWithFranContext() {
  return 'id, workspace_id, sku, ean, upc, gtin, title, status, tags, stock_quantity, track_inventory, product_data, brand:brand_id(id, name), category:category_id(id, name), updated_at, created_at'
}
