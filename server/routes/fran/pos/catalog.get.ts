import posCatalogHandler from '../../../api/v1/pos/catalog.get'
import { attachFranContext } from '../../../fran/productContext'

export default defineEventHandler(async (event) => {
  const response = await posCatalogHandler(event) as any
  return {
    ...response,
    data: (response.data || []).map((item: any) => attachFranContext(item, {
      id: item.product_id,
      sku: item.sku,
      title: item.title,
      brand_name: item.brand_name,
      category_name: item.category_name,
      product_data: item.metadata?.product_data || {},
    })),
  }
})
