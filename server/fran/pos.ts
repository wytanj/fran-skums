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

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => textValue(item)).filter((item): item is string => Boolean(item))
  }
  const single = textValue(value)
  return single ? [single] : []
}

export function normalizeFranPosSaleBody(body: Record<string, any>, forcedSaleType?: string) {
  const metadata = asRecord(body.metadata)
  const crmContext = asRecord(body.crm)
  const rewardContext = asRecord(body.reward)
  const returnContext = asRecord(body.return)
  const loyaltyContext = asRecord(body.loyalty)

  const customerRef =
    textValue(body.customer_ref) ||
    textValue(body.fran_customer_ref) ||
    textValue(body.crm_customer_ref) ||
    textValue(body.crm_customer_id) ||
    textValue(crmContext.customer_ref) ||
    textValue(crmContext.customer_id)

  const memberRef =
    textValue(body.member_ref) ||
    textValue(body.loyalty_member_ref) ||
    textValue(loyaltyContext.member_ref) ||
    textValue(loyaltyContext.member_id) ||
    textValue(crmContext.loyalty_member_ref) ||
    textValue(crmContext.member_id)

  const voucherIds = [
    ...stringList(body.voucher_ids),
    ...stringList(body.voucher_codes),
    ...stringList(loyaltyContext.voucher_ids),
    ...stringList(loyaltyContext.voucher_codes),
  ]

  return {
    ...body,
    sale_type: forcedSaleType || body.sale_type || 'sale',
    customer_ref: customerRef,
    member_ref: memberRef,
    source: body.source || 'pos',
    metadata: {
      ...metadata,
      fran_context: {
        ...(asRecord(metadata.fran_context)),
        crm_customer_id: textValue(body.crm_customer_id) || textValue(crmContext.customer_id),
        crm_customer_ref: textValue(body.crm_customer_ref) || textValue(crmContext.customer_ref),
        loyalty_member_ref: memberRef,
        // L-skums sale contract: loyalty refs preserved for CRM replay / audit — SKUMS does not settle points
        loyalty_policy_version_id:
          textValue(body.policy_version_id) ||
          textValue(loyaltyContext.policy_version_id) ||
          textValue(asRecord(metadata.fran_context).loyalty_policy_version_id),
        loyalty_assignment_id:
          textValue(body.assignment_id) ||
          textValue(loyaltyContext.assignment_id),
        loyalty_skums_quote_id:
          textValue(body.skums_quote_id) ||
          textValue(body.quote_id) ||
          textValue(loyaltyContext.skums_quote_id),
        loyalty_points_earned:
          body.points_earned ?? loyaltyContext.points_earned ?? null,
        loyalty_points_redeemed:
          body.points_redeemed ?? loyaltyContext.points_redeemed ?? null,
        loyalty_voucher_ids: voucherIds,
        loyalty_commit_sale_id:
          textValue(body.loyalty_commit_id) ||
          textValue(loyaltyContext.commit_id),
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
