export type FranReturnPolicyGroup = 'standard' | 'final_sale' | 'exchange_only' | 'restricted' | 'custom'

export interface FranProductMetadata {
  fran_category: string | null
  fran_brand: string | null
  fran_collection: string | null
  fran_reward_eligible: boolean
  fran_reward_exclusion_reason: string | null
  fran_sample_eligible: boolean
  fran_skin_concern_tags: string[]
  fran_sensitivity_flags: string[]
  fran_return_policy_group: FranReturnPolicyGroup | string | null
  fran_store_pickup_eligible: boolean
  fran_3pl_fulfillment_profile: string | null
  restricted_product_flags: string[]
}

export const FRAN_PRODUCT_METADATA_KEYS = [
  'fran_category',
  'fran_brand',
  'fran_collection',
  'fran_reward_eligible',
  'fran_reward_exclusion_reason',
  'fran_sample_eligible',
  'fran_skin_concern_tags',
  'fran_sensitivity_flags',
  'fran_return_policy_group',
  'fran_store_pickup_eligible',
  'fran_3pl_fulfillment_profile',
  'restricted_product_flags',
] as const

type ProductLike = {
  product_data?: Record<string, any> | null
  tags?: string[] | null
  brand?: { name?: string | null } | null
  category?: { name?: string | null } | null
  brand_name?: string | null
  category_name?: string | null
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized || null
}

function dataText(data: Record<string, any>, key: string): string | null {
  return textValue(data[key])
}

function dataBool(data: Record<string, any>, key: string, fallback = false): boolean {
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'y', 'on', 'eligible'].includes(normalized)) return true
    if (['false', '0', 'no', 'n', 'off', 'ineligible'].includes(normalized)) return false
  }
  return fallback
}

function dataList(data: Record<string, any>, key: string): string[] {
  const value = data[key]
  if (Array.isArray(value)) {
    return value.map(textValue).filter((item): item is string => !!item)
  }
  const text = textValue(value)
  if (!text) return []
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function normalizeFranProductMetadata(product: ProductLike = {}): FranProductMetadata {
  const data = product.product_data || {}
  const categoryName = product.category?.name || product.category_name || null
  const brandName = product.brand?.name || product.brand_name || null

  return {
    fran_category: dataText(data, 'fran_category') || categoryName,
    fran_brand: dataText(data, 'fran_brand') || brandName,
    fran_collection: dataText(data, 'fran_collection'),
    fran_reward_eligible: dataBool(data, 'fran_reward_eligible', false),
    fran_reward_exclusion_reason: dataText(data, 'fran_reward_exclusion_reason'),
    fran_sample_eligible: dataBool(data, 'fran_sample_eligible', false),
    fran_skin_concern_tags: dataList(data, 'fran_skin_concern_tags'),
    fran_sensitivity_flags: dataList(data, 'fran_sensitivity_flags'),
    fran_return_policy_group: dataText(data, 'fran_return_policy_group') || 'standard',
    fran_store_pickup_eligible: dataBool(data, 'fran_store_pickup_eligible', true),
    fran_3pl_fulfillment_profile: dataText(data, 'fran_3pl_fulfillment_profile'),
    restricted_product_flags: dataList(data, 'restricted_product_flags'),
  }
}
