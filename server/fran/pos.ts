export type FranStoreOpsRequestType =
  | 'warehouse_replenishment'
  | '3pl_store_shipment'
  | 'damaged_tester_sample'
  | 'pos_inventory_reconciliation'
  | 'reward_stock_mismatch'

const FRAN_STORE_OPS_TYPES: FranStoreOpsRequestType[] = [
  'warehouse_replenishment',
  '3pl_store_shipment',
  'damaged_tester_sample',
  'pos_inventory_reconciliation',
  'reward_stock_mismatch',
]

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized || null
}

export function normalizeFranPosSaleBody(body: Record<string, any>, forcedSaleType?: string) {
  const metadata = asRecord(body.metadata)
  const crmContext = asRecord(body.crm)
  const rewardContext = asRecord(body.reward)
  const returnContext = asRecord(body.return)

  const customerRef =
    textValue(body.customer_ref) ||
    textValue(body.fran_customer_ref) ||
    textValue(body.crm_customer_ref) ||
    textValue(body.crm_customer_id) ||
    textValue(crmContext.customer_ref) ||
    textValue(crmContext.customer_id)

  return {
    ...body,
    sale_type: forcedSaleType || body.sale_type || 'sale',
    customer_ref: customerRef,
    source: body.source || 'pos',
    metadata: {
      ...metadata,
      fran_context: {
        ...(asRecord(metadata.fran_context)),
        crm_customer_id: textValue(body.crm_customer_id) || textValue(crmContext.customer_id),
        crm_customer_ref: textValue(body.crm_customer_ref) || textValue(crmContext.customer_ref),
        loyalty_member_ref: textValue(body.loyalty_member_ref) || textValue(crmContext.loyalty_member_ref),
        reward_ref: textValue(body.reward_ref) || textValue(rewardContext.reward_ref),
        reward_commitment_ref: textValue(body.reward_commitment_ref) || textValue(rewardContext.commitment_ref),
        return_ref: textValue(body.return_ref) || textValue(returnContext.return_ref),
        source_app: 'fran_pos',
      },
    },
  }
}

export function normalizeFranStoreOpsType(value: unknown): FranStoreOpsRequestType {
  const normalized = textValue(value) as FranStoreOpsRequestType | null
  return normalized && FRAN_STORE_OPS_TYPES.includes(normalized)
    ? normalized
    : 'warehouse_replenishment'
}

export function genericStoreOpsRequestType(franType: FranStoreOpsRequestType) {
  if (franType === 'pos_inventory_reconciliation') return 'pos_requested'
  if (franType === 'damaged_tester_sample') return 'cycle_count'
  return 'manual'
}
