import type { ProjectedSku } from '../_types'

export interface SquareCatalogObject {
  type: 'ITEM' | 'ITEM_VARIATION' | 'CATEGORY' | 'IMAGE'
  id?: string
  present_at_all_locations?: boolean
  item_data?: Record<string, unknown>
  item_variation_data?: Record<string, unknown>
  category_data?: Record<string, unknown>
  image_data?: Record<string, unknown>
}

export function skumsToSquareCatalogObjects(sku: ProjectedSku): SquareCatalogObject[] {
  const itemId = `#skums-item-${sku.sku_id}`
  const variationId = `#skums-variation-${sku.sku_id}`
  const name = sku.name || sku.sku
  const amount = Math.round(Number(sku.sale_price ?? sku.retail_price ?? 0) * 100)

  return [
    {
      type: 'ITEM',
      id: itemId,
      present_at_all_locations: true,
      item_data: {
        name,
        description: sku.description || sku.short_description || undefined,
        abbreviation: String(name).slice(0, 24),
        variations: [
          {
            type: 'ITEM_VARIATION',
            id: variationId,
            present_at_all_locations: true,
            item_variation_data: {
              item_id: itemId,
              name: sku.attributes?.variation_name || 'Regular',
              sku: sku.sku,
              upc: sku.gtin || sku.upc || sku.ean || undefined,
              pricing_type: 'FIXED_PRICING',
              price_money: {
                amount,
                currency: sku.currency,
              },
            },
          },
        ],
      },
    },
  ]
}

export function squareCatalogObjectToSkums(raw: Record<string, any>): Partial<ProjectedSku> {
  const itemData = raw.item_data || {}
  const variation = Array.isArray(itemData.variations) ? itemData.variations[0] : null
  const variationData = variation?.item_variation_data || raw.item_variation_data || {}
  const priceMoney = variationData.price_money || {}

  return {
    sku_id: String(raw.id || variation?.id || variationData.sku || ''),
    sku: String(variationData.sku || raw.id || ''),
    name: String(itemData.name || variationData.name || ''),
    description: itemData.description || undefined,
    gtin: variationData.upc || undefined,
    retail_price: Number(priceMoney.amount || 0) / 100,
    currency: priceMoney.currency || 'USD',
    attributes: {
      square_object_id: raw.id || null,
      square_variation_id: variation?.id || null,
    },
  }
}
