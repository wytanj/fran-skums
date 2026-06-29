type AttentionItemRecord = Record<string, any>

const ENTITY_FIELDS = [
  'product_identity_id',
  'trade_unit_id',
  'listing_id',
  'channel_id',
  'sku_assignment_id',
  'identifier_id',
  'product_id',
  'variant_id',
]

function entityTypeFromField(field: string) {
  return field.replace(/_id$/, '')
}

export function boundedApiLimit(value: unknown, fallback = 50, max = 200) {
  const parsed = Math.floor(Number(value) || fallback)
  return Math.min(Math.max(parsed, 1), max)
}

export function attentionAffectedObjects(item: AttentionItemRecord) {
  return ENTITY_FIELDS
    .filter((field) => item[field])
    .map((field) => ({
      type: entityTypeFromField(field),
      id: item[field],
    }))
}

export function attentionAgentType(item: AttentionItemRecord) {
  const type = String(item.attention_type || '')
  if (type.startsWith('inventory.')) return 'inventory_resolution_agent'
  if (type.startsWith('listing.') || type.startsWith('channel.')) return 'channel_listing_agent'
  if (type.startsWith('identity.') || type.startsWith('identifier.')) return 'product_identity_agent'
  if (type.startsWith('pricing.') || type.startsWith('fee.')) return 'commercial_offer_agent'
  return 'commerce_operations_agent'
}

export function attentionProposalSteps(item: AttentionItemRecord, overrideSteps?: unknown) {
  if (Array.isArray(overrideSteps) && overrideSteps.length > 0) return overrideSteps

  const recommendedAction = item.recommended_action || 'review_and_resolve_attention_item'
  return [
    {
      step_key: 'review_evidence',
      tool: 'attention_items.inspect',
      description: 'Review the attention item evidence and affected commerce objects.',
      input: {
        attention_item_id: item.id,
        attention_type: item.attention_type,
      },
    },
    {
      step_key: 'prepare_change',
      tool: 'agent.prepare_change',
      description: recommendedAction,
      input: {
        attention_item_id: item.id,
        recommended_action: recommendedAction,
      },
    },
    {
      step_key: 'write_resolution_event',
      tool: 'domain_events.emit',
      description: 'Emit a traceable resolution event after the approved change executes.',
      input: {
        event_type: 'attention_item.resolved',
        aggregate_type: 'product_attention_item',
        aggregate_id: item.id,
      },
    },
  ]
}

export function buildAgentProposalFromAttentionItem(item: AttentionItemRecord, input: AttentionItemRecord = {}) {
  const riskLevel = input.risk_level || item.risk_level || 'medium'
  const approvalRequired = input.approval_required ?? riskLevel !== 'low'
  const affectedObjects = Array.isArray(input.affected_objects) && input.affected_objects.length > 0
    ? input.affected_objects
    : attentionAffectedObjects(item)

  return {
    workspace_id: item.workspace_id,
    source_event_id: input.source_event_id || item.source_event_id || null,
    app_key: input.app_key || item.source_app_key || 'skums_core',
    agent_type: input.agent_type || attentionAgentType(item),
    intent_summary: input.intent_summary || `Resolve attention item: ${item.title}`,
    affected_objects: affectedObjects,
    proposed_steps: attentionProposalSteps(item, input.proposed_steps),
    data_diff: input.data_diff || {},
    risk_level: riskLevel,
    policy_result: input.policy_result || {
      mode: 'proposal_only',
      approval_required: approvalRequired,
      source: 'product_attention_item',
    },
    approval_required: approvalRequired,
    status: input.status || (approvalRequired ? 'pending_approval' : 'draft'),
    created_by_agent: input.created_by_agent || 'skums_attention_router',
    rollback_metadata: input.rollback_metadata || {
      source_attention_item_id: item.id,
      reversible: true,
    },
    metadata: {
      ...(input.metadata || {}),
      source_attention_item_id: item.id,
      source_attention_type: item.attention_type,
      source_risk_level: item.risk_level,
    },
  }
}
