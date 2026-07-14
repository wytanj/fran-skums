export interface Profile {
  id: string
  full_name: string | null
  avatar_url: string | null
  company: string | null
  created_at: string
  updated_at: string
}

export interface Workspace {
  id: string
  name: string
  slug: string
  owner_id: string
  organization_id: string | null
  created_at: string
  updated_at: string
}

export interface WorkspaceMember {
  workspace_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  created_at: string
  profile?: Profile
}

export interface Brand {
  id: string
  workspace_id: string
  name: string
  logo_url: string | null
  website: string | null
  created_at: string
  updated_at: string
}

export interface Category {
  id: string
  workspace_id: string
  parent_id: string | null
  name: string
  slug: string
  sort_order: number
  created_at: string
  children?: Category[]
}

export type ProductStatus = 'draft' | 'active' | 'archived'

export interface Product {
  id: string
  workspace_id: string

  sku: string | null
  ean: string | null
  upc: string | null
  isbn: string | null
  asin: string | null
  mpn: string | null
  gtin: string | null

  title: string
  description: string | null
  short_description: string | null
  brand_id: string | null
  category_id: string | null

  cost_price: number | null
  retail_price: number | null
  sale_price: number | null
  currency: string

  weight: number | null
  weight_unit: string
  length: number | null
  width: number | null
  height: number | null
  dimension_unit: string

  stock_quantity: number
  low_stock_threshold: number
  track_inventory: boolean

  seo_title: string | null
  seo_description: string | null
  seo_keywords: string[] | null
  canonical_url: string | null

  status: ProductStatus
  published_at: string | null
  tags: string[]

  is_canonical: boolean
  canonical_product_id: string | null
  overrides: Record<string, boolean>
  export_target: string | null
  rendition_name: string | null

  product_data: Record<string, any>
  schema_id: string | null

  created_at: string
  updated_at: string

  brand?: Brand | null
  category?: Category | null
  images?: ProductImage[]
  variants?: ProductVariant[]
  canonical_product?: Product | null
  forks?: Product[]
  manuals?: ProductManual[]
  product_schema?: ProductSchema | null
}

export interface ProductImage {
  id: string
  product_id: string
  url: string
  alt_text: string | null
  sort_order: number
  is_primary: boolean
  created_at: string
}

export interface ProductVariant {
  id: string
  product_id: string
  sku: string | null
  ean: string | null
  upc: string | null
  gtin: string | null
  title: string
  options: Record<string, string>
  cost_price: number | null
  retail_price: number | null
  sale_price: number | null
  stock_quantity: number
  weight: number | null
  image_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ProductIdentityKind = 'product' | 'component' | 'material' | 'service' | 'digital' | 'bundle'
export type TradeUnitKind = 'each' | 'pack' | 'case' | 'pallet' | 'bundle' | 'bulk' | 'sample'
export type SkuScopeType = 'workspace' | 'supplier' | 'manufacturer' | 'warehouse' | 'channel' | 'listing' | 'integration' | 'campaign' | 'import' | 'manual'
export type SkuAssignmentKind = 'internal' | 'seller' | 'warehouse' | 'supplier' | 'channel' | 'display' | 'other'
export type ListingStatus = 'draft' | 'active' | 'paused' | 'error' | 'archived' | 'deleted'
export type ChannelType = 'storefront' | 'marketplace' | 'erp' | 'wms' | 'retailer_portal' | 'supplier_portal' | 'custom'

export interface ProductIdentity {
  id: string
  workspace_id: string
  product_id: string | null
  name: string
  description: string | null
  identity_kind: ProductIdentityKind
  status: ProductStatus
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface TradeUnit {
  id: string
  workspace_id: string
  product_identity_id: string
  product_id: string | null
  variant_id: string | null
  parent_trade_unit_id: string | null
  unit_kind: TradeUnitKind
  label: string
  quantity: number
  base_unit: string
  conversion_factor: number
  is_default: boolean
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface IdentityIdentifier {
  id: string
  workspace_id: string
  product_identity_id: string | null
  trade_unit_id: string | null
  identifier_type: string
  identifier_value: string
  issuer: string | null
  source: string | null
  is_primary: boolean
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface SkuAssignment {
  id: string
  workspace_id: string
  sku: string
  scope_type: SkuScopeType
  scope_id: string | null
  scope_label: string | null
  product_identity_id: string | null
  trade_unit_id: string | null
  product_id: string | null
  variant_id: string | null
  assignment_kind: SkuAssignmentKind
  is_primary: boolean
  is_active: boolean
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface ProductIdentityGraph {
  workspace_id: string
  product_id: string
  product_identity_id: string
  identity_name: string
  identity_description: string | null
  identity_kind: ProductIdentityKind
  identity_status: ProductStatus
  identity_metadata: Record<string, any>
  trade_units: TradeUnit[]
  identifiers: IdentityIdentifier[]
  sku_assignments: SkuAssignment[]
}

export interface Channel {
  id: string
  workspace_id: string | null
  channel_key: string
  name: string
  channel_type: ChannelType
  vendor: string | null
  market: string | null
  adapter_id: string | null
  is_global: boolean
  is_active: boolean
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface Listing {
  id: string
  workspace_id: string
  channel_id: string
  integration_connection_id: string | null
  product_identity_id: string
  trade_unit_id: string | null
  product_id: string | null
  variant_id: string | null
  listing_title: string | null
  external_listing_id: string | null
  external_variant_id: string | null
  external_url: string | null
  seller_sku: string | null
  status: ListingStatus
  currency: string | null
  price: number | null
  compare_at_price: number | null
  last_synced_at: string | null
  metadata: Record<string, any>
  created_at: string
  updated_at: string
  channel?: Channel
  product_identity?: ProductIdentity
  trade_unit?: TradeUnit
}

export type PosSaleType = 'sale' | 'return' | 'exchange' | 'sample_issue' | 'tester_conversion' | 'writeoff'
export type PosSaleStatus = 'draft' | 'completed' | 'voided' | 'refunded' | 'failed'
export type PosLineType = 'sale' | 'return' | 'exchange_in' | 'sample' | 'tester' | 'bundle_component' | 'writeoff'
export type PosInventoryEventType = 'inventory.damage.reported' | 'inventory.found_stock.reported' | 'inventory.transfer_receive.reported'
export type PosInventoryEventStatus = 'received' | 'pending_approval' | 'applied' | 'rejected' | 'failed'
export type ProductAttentionItemStatus = 'open' | 'in_review' | 'proposed' | 'resolved' | 'dismissed' | 'cancelled'
export type ProductAttentionSourceType = 'app' | 'connector' | 'agent' | 'api' | 'import' | 'sync' | 'system' | 'pos'
export type ChannelSupportLevel = 'supported' | 'unsupported' | 'conditional' | 'unknown'
export type ChannelCapabilityDirection = 'inbound' | 'outbound' | 'bidirectional' | 'none'
export type ChannelRequirementSeverity = 'required' | 'recommended' | 'optional' | 'blocked'

export interface PosLocation {
  id: string
  workspace_id: string
  inventory_location_id: string | null
  name: string
  code: string
  timezone: string
  currency: string
  is_active: boolean
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface PosRegister {
  id: string
  workspace_id: string
  location_id: string
  register_code: string
  name: string
  device_ref: string | null
  is_active: boolean
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface PosRegisterSession {
  id: string
  workspace_id: string
  register_id: string
  location_id: string
  opened_by: string | null
  closed_by: string | null
  status: 'open' | 'closed' | 'suspended'
  opened_at: string
  closed_at: string | null
  opening_float: number | null
  closing_cash_count: number | null
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface PosSale {
  id: string
  workspace_id: string
  location_id: string | null
  register_id: string | null
  register_session_id: string | null
  receipt_number: string
  sale_type: PosSaleType
  status: PosSaleStatus
  customer_ref: string | null
  cashier_user_id: string | null
  currency: string
  subtotal: number
  discount_total: number
  tax_total: number
  total: number
  source: 'pos' | 'api' | 'import' | 'sync' | 'system'
  idempotency_key: string | null
  completed_at: string | null
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface PosSaleItem {
  id: string
  workspace_id: string
  sale_id: string
  line_number: number
  product_identity_id: string | null
  trade_unit_id: string | null
  listing_id: string | null
  channel_id: string | null
  sku_assignment_id: string | null
  identifier_id: string | null
  product_id: string | null
  variant_id: string | null
  batch_id: string | null
  display_name: string
  scanned_value: string | null
  quantity: number
  unit_price: number
  list_price: number | null
  discount_amount: number
  tax_amount: number
  line_total: number
  line_type: PosLineType
  reason_code: string | null
  metadata: Record<string, any>
  created_at: string
}

export interface PosSalePayment {
  id: string
  workspace_id: string
  sale_id: string
  payment_method: string
  payment_ref: string | null
  amount: number
  currency: string
  status: 'pending' | 'captured' | 'failed' | 'refunded' | 'voided'
  metadata: Record<string, any>
  created_at: string
}

export interface PosInventoryEvent {
  id: string
  workspace_id: string
  event_type: PosInventoryEventType
  status: PosInventoryEventStatus
  source: string
  idempotency_key: string | null
  pos_location_id: string | null
  inventory_location_id: string | null
  register_id: string | null
  register_session_id: string | null
  transfer_id: string | null
  product_identity_id: string | null
  trade_unit_id: string | null
  listing_id: string | null
  channel_id: string | null
  sku_assignment_id: string | null
  identifier_id: string | null
  product_id: string | null
  variant_id: string | null
  sku: string | null
  quantity: number | null
  storage_location_code: string | null
  reason_code: string | null
  reference: string | null
  adjustment_id: string | null
  payload: Record<string, any>
  result: Record<string, any>
  error_message: string | null
  occurred_at: string
  processed_at: string | null
  created_at: string
  updated_at: string
}

export interface PosScanMatch {
  confidence: number
  candidate_source: 'identity_identifier' | 'sku_assignment' | 'listing_identifier' | 'listing_seller_sku'
  identifier_id: string | null
  sku_assignment_id: string | null
  listing_id: string | null
  channel_id: string | null
  product_identity_id: string | null
  trade_unit_id: string | null
  product_id: string | null
  variant_id: string | null
  display_name: string
  matched_value: string
  sku: string | null
  metadata: Record<string, any>
}

export interface PosScanResolution {
  match_status: 'none' | 'single' | 'ambiguous'
  identifier: string
  workspace_id: string
  channel_id: string | null
  location_id: string | null
  warnings: string[]
  matches: PosScanMatch[]
}

export interface PosCatalogItem {
  id: string
  product_id: string
  revision: string
  updated_at: string | null
  product_identity_id: string | null
  trade_unit_id: string | null
  listing_id: string | null
  channel_id: string | null
  sku_assignment_id: string | null
  identifier_id: string | null
  variant_id: string | null
  batch_id: string | null
  sku: string
  title: string
  display_name: string
  brand_name: string | null
  category_name: string | null
  unit_price: number
  list_price: number
  currency: string
  storage_location_code: string | null
  stock_quantity: number
  track_inventory: boolean
  status: 'draft' | 'active' | 'archived'
  pos_enabled: boolean
  identifiers: Record<string, string | null>
  metadata: Record<string, any>
}

export interface PosCatalogResponse {
  data: PosCatalogItem[]
  total: number
  limit: number
  offset: number
  has_more: boolean
  next_offset: number | null
}

export type PosQuoteMode = 'checkout' | 'reward' | 'sample' | 'preview'
export type PosBasketQuoteStatus = 'quoted' | 'reserved' | 'committed' | 'released' | 'expired' | 'cancelled'
export type PosReservationStatus = 'active' | 'committed' | 'released' | 'expired' | 'cancelled'

export interface PosQuoteAvailability {
  track_inventory: boolean
  on_hand: number | null
  reserved: number | null
  available_to_sell: number | null
  reservable_quantity: number
  by_location: Array<{
    location_id: string
    location_name: string | null
    location_code: string | null
    location_type: string | null
    on_hand: number
    reserved: number
    available_to_sell: number
    on_order: number
    in_transit: number
  }>
}

export interface PosBasketQuoteLine {
  quote_line_id: string
  line_id: string
  product_id: string | null
  variant_id: string | null
  product_identity_id: string | null
  trade_unit_id: string | null
  sku_assignment_id: string | null
  sku: string | null
  display_name: string | null
  quantity: number
  unit_price: number
  list_price: number
  discount_amount: number
  tax_basis: Record<string, any>
  line_total: number
  currency: string
  price_source: Record<string, any>
  product_context: FranProductContext | Record<string, never>
  availability: PosQuoteAvailability
  blocked: boolean
  warnings: string[]
}

export interface PosBasketQuote {
  quote_id: string
  quote_revision: string
  status: 'quoted' | 'blocked'
  ttl_seconds: number
  expires_at: string
  workspace_id: string
  location_id: string | null
  inventory_location_id: string | null
  register_id: string | null
  register_session_id: string | null
  quote_mode: PosQuoteMode
  currency: string
  customer: {
    customer_ref: string | null
    member_ref: string | null
  }
  price_source: Record<string, any>
  totals: {
    subtotal: number
    discount_total: number
    tax_total: number
    total: number
  }
  lines: PosBasketQuoteLine[]
  blocked_lines: Array<{
    quote_line_id: string
    line_id: string
    product_id: string | null
    warnings: string[]
  }>
  warnings: string[]
}

export interface PosReservation {
  id: string
  workspace_id: string
  quote_id: string | null
  status: PosReservationStatus
  source: string
  pos_cart_id: string | null
  pos_sale_id: string | null
  location_id: string | null
  inventory_location_id: string | null
  register_id: string | null
  register_session_id: string | null
  idempotency_key: string | null
  expires_at: string
  committed_at: string | null
  released_at: string | null
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface PosReservationLine {
  id: string
  workspace_id: string
  reservation_id: string
  quote_line_id: string | null
  inventory_reservation_id: string | null
  product_id: string | null
  variant_id: string | null
  inventory_location_id: string | null
  requested_qty: number
  reserved_qty: number
  status: PosReservationStatus | 'failed'
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface FranProductMetadata {
  fran_category: string | null
  fran_brand: string | null
  fran_collection: string | null
  fran_reward_eligible: boolean
  fran_reward_exclusion_reason: string | null
  fran_sample_eligible: boolean
  fran_skin_concern_tags: string[]
  fran_sensitivity_flags: string[]
  fran_return_policy_group: string | null
  fran_store_pickup_eligible: boolean
  fran_3pl_fulfillment_profile: string | null
  restricted_product_flags: string[]
}

export interface FranProductContext {
  product_id: string | null
  sku: string | null
  barcode: string | null
  title: string | null
  brand: string | null
  category: string | null
  collection: string | null
  tags: string[]
  reward_eligible: boolean
  reward_exclusion_reason: string | null
  sample_eligible: boolean
  return_policy_group: string | null
  store_pickup_eligible: boolean
  fulfillment_profile_3pl: string | null
  skin_concern_tags: string[]
  sensitivity_flags: string[]
  restricted_product_flags: string[]
}

export type FranStoreOpsRequestType =
  | 'warehouse_replenishment'
  | '3pl_store_shipment'
  | 'damaged_tester_sample'
  | 'pos_inventory_reconciliation'
  | 'reward_stock_mismatch'

export type AppDefinitionType = 'core' | 'first_party' | 'connector' | 'agent' | 'external' | 'custom'
export type AppDefinitionStatus = 'available' | 'private' | 'deprecated' | 'disabled'
export type WorkspaceAppStatus = 'configuring' | 'enabled' | 'disabled' | 'suspended' | 'error'
export type CapabilityOwnerType = 'skums_core' | 'workspace_app' | 'integration_connection' | 'external_system' | 'manual'
export type CapabilitySourceMode = 'source_of_truth' | 'read_only' | 'write_through' | 'event_sink' | 'disabled'
export type CapabilityConflictPolicy = 'prefer_source' | 'prefer_latest' | 'manual_review' | 'block'
export type DomainEventSourceType = 'app' | 'connector' | 'agent' | 'api' | 'import' | 'sync' | 'system'
export type AgentRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type AgentProposalStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'executing' | 'executed' | 'failed' | 'cancelled'
export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'
export type AgentExecutionStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'blocked'

export interface AppDefinition {
  id: string
  workspace_id: string | null
  app_key: string
  name: string
  app_type: AppDefinitionType
  status: AppDefinitionStatus
  description: string | null
  config_schema: Record<string, any>
  provided_capabilities: string[]
  consumed_capabilities: string[]
  emitted_events: string[]
  subscribed_events: string[]
  required_scopes: string[]
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface WorkspaceApp {
  id: string
  workspace_id: string
  app_definition_id: string | null
  app_key: string
  status: WorkspaceAppStatus
  enabled_by: string | null
  enabled_at: string
  disabled_at: string | null
  config: Record<string, any>
  capabilities: Record<string, any>
  metadata: Record<string, any>
  created_at: string
  updated_at: string
  app_definition?: AppDefinition | null
}

export interface WorkspaceCapabilitySource {
  id: string
  workspace_id: string
  capability_key: string
  owner_type: CapabilityOwnerType
  app_key: string | null
  app_definition_id: string | null
  workspace_app_id: string | null
  integration_connection_id: string | null
  mode: CapabilitySourceMode
  conflict_policy: CapabilityConflictPolicy
  config: Record<string, any>
  metadata: Record<string, any>
  created_at: string
  updated_at: string
  app_definition?: AppDefinition | null
  workspace_app?: WorkspaceApp | null
}

export interface DomainEvent {
  id: string
  workspace_id: string
  event_type: string
  event_version: number
  source_type: DomainEventSourceType
  source_app_key: string | null
  source_id: string | null
  aggregate_type: string | null
  aggregate_id: string | null
  correlation_id: string | null
  causation_id: string | null
  idempotency_key: string | null
  payload: Record<string, any>
  metadata: Record<string, any>
  created_at: string
}

export interface ProductAttentionItem {
  id: string
  workspace_id: string
  attention_type: string
  risk_level: AgentRiskLevel
  status: ProductAttentionItemStatus
  source_type: ProductAttentionSourceType
  source_app_key: string | null
  source_event_id: string | null
  proposal_id: string | null
  product_identity_id: string | null
  trade_unit_id: string | null
  listing_id: string | null
  channel_id: string | null
  sku_assignment_id: string | null
  identifier_id: string | null
  product_id: string | null
  variant_id: string | null
  title: string
  summary: string | null
  recommended_action: string | null
  evidence: Record<string, any>
  metadata: Record<string, any>
  assigned_to: string | null
  resolved_by: string | null
  resolved_at: string | null
  idempotency_key: string | null
  created_at: string
  updated_at: string
}

export interface ChannelCapability {
  id: string
  workspace_id: string | null
  channel_id: string | null
  channel_key: string
  capability_key: string
  support_level: ChannelSupportLevel
  direction: ChannelCapabilityDirection
  config_schema: Record<string, any>
  constraints: Record<string, any>
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface ChannelRequirement {
  id: string
  workspace_id: string | null
  channel_id: string | null
  channel_key: string
  requirement_key: string
  requirement_type: string
  target_object: string
  severity: ChannelRequirementSeverity
  rule_expression: Record<string, any>
  validation_schema: Record<string, any>
  remediation_hint: string | null
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface ChannelOfferRule {
  id: string
  workspace_id: string
  channel_id: string | null
  channel_key: string
  rule_key: string
  rule_type: string
  status: 'draft' | 'active' | 'paused' | 'archived'
  priority: number
  conditions: Record<string, any>
  actions: Record<string, any>
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface ListingContentVariant {
  id: string
  workspace_id: string
  listing_id: string | null
  channel_id: string | null
  product_identity_id: string | null
  trade_unit_id: string | null
  variant_key: string
  locale: string | null
  market: string | null
  status: 'draft' | 'ready' | 'active' | 'rejected' | 'archived'
  title: string | null
  subtitle: string | null
  description: string | null
  bullet_points: string[]
  attributes: Record<string, any>
  media: Record<string, any>[]
  quality_score: number | null
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface PromotionEvent {
  id: string
  workspace_id: string
  channel_id: string | null
  listing_id: string | null
  promotion_key: string
  external_id: string | null
  name: string
  promotion_type: string
  status: 'draft' | 'scheduled' | 'active' | 'ended' | 'cancelled' | 'archived'
  starts_at: string | null
  ends_at: string | null
  budget: number | null
  currency: string | null
  rules: Record<string, any>
  performance: Record<string, any>
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface FulfillmentPolicy {
  id: string
  workspace_id: string
  channel_id: string | null
  policy_key: string
  name: string
  status: 'draft' | 'active' | 'paused' | 'archived'
  market: string | null
  service_level: string | null
  lead_time_days: number | null
  ship_from_location_id: string | null
  return_window_days: number | null
  rules: Record<string, any>
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface ChannelFeeSnapshot {
  id: string
  workspace_id: string
  channel_id: string | null
  listing_id: string | null
  fee_key: string
  fee_type: string
  market: string | null
  currency: string | null
  basis: 'percentage' | 'fixed' | 'tiered' | 'formula'
  amount: number | null
  formula: Record<string, any>
  effective_from: string | null
  effective_to: string | null
  source: 'manual' | 'connector' | 'import' | 'api' | 'system'
  metadata: Record<string, any>
  created_at: string
}

export interface ListingQualityFinding {
  id: string
  workspace_id: string
  listing_id: string | null
  channel_id: string | null
  product_identity_id: string | null
  trade_unit_id: string | null
  attention_item_id: string | null
  proposal_id: string | null
  finding_key: string
  finding_type: string
  severity: 'info' | 'warning' | 'error' | 'critical'
  status: 'open' | 'in_review' | 'proposed' | 'resolved' | 'dismissed'
  title: string
  description: string | null
  evidence: Record<string, any>
  recommended_action: string | null
  metadata: Record<string, any>
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface AgentProposal {
  id: string
  workspace_id: string
  source_event_id: string | null
  app_key: string | null
  agent_type: string
  intent_summary: string
  affected_objects: Record<string, any>[]
  proposed_steps: Record<string, any>[]
  data_diff: Record<string, any>
  risk_level: AgentRiskLevel
  policy_result: Record<string, any>
  approval_required: boolean
  status: AgentProposalStatus
  created_by_agent: string | null
  requested_by: string | null
  approved_by: string | null
  approved_at: string | null
  executed_at: string | null
  rollback_metadata: Record<string, any>
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface AgentProposalDryRunResult {
  mode: 'dry_run'
  proposal_id: string
  status: AgentProposalStatus
  approval_required: boolean
  would_execute: boolean
  proposed_steps: Record<string, any>[]
  affected_objects: Record<string, any>[]
  data_diff: Record<string, any>
}

export interface ApprovalRequest {
  id: string
  workspace_id: string
  proposal_id: string | null
  approval_type: string
  status: ApprovalRequestStatus
  requested_by: string | null
  assigned_to: string | null
  decided_by: string | null
  decision_notes: string | null
  due_at: string | null
  decided_at: string | null
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface AgentExecutionLog {
  id: string
  workspace_id: string
  proposal_id: string | null
  source_event_id: string | null
  app_key: string | null
  agent_type: string | null
  status: AgentExecutionStatus
  input_data: Record<string, any>
  output_data: Record<string, any>
  error_message: string | null
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  metadata: Record<string, any>
  created_at: string
}

export type ImportSourceType = 'csv' | 'tsv' | 'xlsx' | 'json' | 'api' | 'supplier_feed' | 'marketplace_export'
export type ImportJobStatus = 'draft' | 'uploaded' | 'mapped' | 'validated' | 'committing' | 'completed' | 'failed' | 'cancelled'
export type ImportRowStatus = 'pending' | 'valid' | 'warning' | 'error' | 'committed' | 'skipped'

export interface ImportJob {
  id: string
  workspace_id: string
  source_type: ImportSourceType
  source_name: string | null
  file_name: string | null
  file_size_bytes: number | null
  target_schema_id: string | null
  status: ImportJobStatus
  column_mapping: Record<string, any>
  import_options: Record<string, any>
  total_rows: number
  valid_rows: number
  error_rows: number
  committed_rows: number
  created_by: string | null
  committed_by: string | null
  committed_at: string | null
  error: string | null
  created_at: string
  updated_at: string
}

export interface ImportJobRow {
  id: string
  workspace_id: string
  import_job_id: string
  row_number: number
  raw_data: Record<string, any>
  normalized_product: Record<string, any>
  normalized_identity: Record<string, any>
  normalized_trade_units: Record<string, any>[]
  normalized_identifiers: Record<string, any>[]
  normalized_sku_assignments: Record<string, any>[]
  normalized_listings: Record<string, any>[]
  status: ImportRowStatus
  errors: Record<string, any>[]
  warnings: Record<string, any>[]
  product_id: string | null
  product_identity_id: string | null
  created_at: string
  updated_at: string
}

export interface CustomFieldDefinition {
  id: string
  workspace_id: string
  field_name: string
  field_key: string
  field_type: 'text' | 'number' | 'boolean' | 'date' | 'url' | 'email' | 'select' | 'multi_select' | 'json'
  description: string | null
  options: string[] | null
  is_required: boolean
  sort_order: number
  created_at: string
}

export interface CustomFieldValue {
  id: string
  product_id: string
  field_id: string
  value_text: string | null
  value_number: number | null
  value_boolean: boolean | null
  value_date: string | null
  value_json: any
  created_at: string
  updated_at: string
  definition?: CustomFieldDefinition
}

export interface ProductManual {
  id: string
  product_id: string
  title: string
  content: string
  version: string
  is_published: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

// --- Product Schemas (Dynamic) ---

export interface SchemaProperty {
  type: string
  description?: string
  enum?: string[]
  default?: any
  format?: string
  maxLength?: number
  items?: SchemaProperty | { type: string; properties?: Record<string, SchemaProperty>; required?: string[] }
  properties?: Record<string, SchemaProperty>
  required?: string[]
  additionalProperties?: boolean
}

export interface ProductSchemaDefinition {
  $schema?: string
  type: string
  properties: Record<string, SchemaProperty>
  required?: string[]
}

export interface ProductSchema {
  id: string
  workspace_id: string | null
  name: string
  slug: string
  description: string | null
  version: number
  schema: ProductSchemaDefinition
  extends_schema_id: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

// --- Legacy Integration Types (kept for backward compatibility) ---

export type IntegrationType = 'shopify' | 'woocommerce' | 'amazon' | 'ebay' | 'custom_ims' | 'csv_import' | 'api' | 'google_sheets' | 'zapier' | 'n8n' | 'notion' | 'slack' | 'airtable'
export type IntegrationStatus = 'active' | 'paused' | 'error' | 'disconnected'

export interface Integration {
  id: string
  workspace_id: string
  type: IntegrationType
  name: string
  status: IntegrationStatus
  config: Record<string, any>
  last_synced_at: string | null
  sync_frequency: string
  created_at: string
  updated_at: string
}

// --- n8n-Inspired Integration Framework ---

export type NodeCategory = 'ecommerce' | 'marketplace' | 'automation' | 'productivity' | 'communication' | 'database' | 'analytics' | 'shipping' | 'payment' | 'other'
export type NodeType = 'trigger' | 'action' | 'both'

export interface NodeAction {
  key: string
  label: string
  description: string
  fields?: NodeActionField[]
}

export interface NodeActionField {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'select' | 'json'
  required?: boolean
  default?: any
  options?: { label: string; value: string }[]
  description?: string
}

export interface NodeTrigger {
  key: string
  label: string
  description: string
}

export interface CredentialSchemaProperty {
  type: string
  label: string
  description?: string
  secret?: boolean
  required?: boolean
  multiline?: boolean
  default?: any
  enum?: string[]
}

export interface CredentialSchema {
  properties: Record<string, CredentialSchemaProperty>
}

export interface IntegrationNodeDefinition {
  id: string
  workspace_id: string | null
  name: string
  slug: string
  description: string | null
  icon: string | null
  color: string | null
  category: NodeCategory
  node_type: NodeType
  version: number
  is_available: boolean
  is_coming_soon: boolean
  actions: NodeAction[]
  triggers: NodeTrigger[]
  credential_schema: CredentialSchema
  default_field_mapping: Record<string, string>
  supports_webhooks: boolean
  webhook_path: string | null
  rate_limit_rpm: number | null
  created_at: string
  updated_at: string
}

export interface IntegrationCredential {
  id: string
  workspace_id: string
  node_def_id: string
  name: string
  credential_data: Record<string, any>
  is_valid: boolean | null
  last_tested_at: string | null
  test_error: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  node_definition?: IntegrationNodeDefinition
}

export type ConnectionStatus = 'active' | 'inactive' | 'error' | 'paused'
export type SyncDirection = 'push' | 'pull' | 'bidirectional'
export type SyncFrequency = 'manual' | 'realtime' | '5min' | '15min' | 'hourly' | 'daily' | 'weekly'

export interface IntegrationConnection {
  id: string
  workspace_id: string
  node_def_id: string
  credential_id: string | null
  name: string
  status: ConnectionStatus
  config: Record<string, any>
  field_mapping: Record<string, string>
  sync_direction: SyncDirection
  sync_frequency: SyncFrequency
  last_synced_at: string | null
  last_error: string | null
  total_synced: number
  total_errors: number
  created_by: string | null
  created_at: string
  updated_at: string
  node_definition?: IntegrationNodeDefinition
  credential?: IntegrationCredential
}

export interface IntegrationWebhook {
  id: string
  connection_id: string
  workspace_id: string
  path: string
  secret: string | null
  trigger_key: string
  is_active: boolean
  last_received_at: string | null
  total_received: number
  created_at: string
}

export type ExecutionType = 'action' | 'trigger' | 'test' | 'webhook'
export type ExecutionStatus = 'running' | 'success' | 'error' | 'cancelled' | 'timeout'

export interface IntegrationExecution {
  id: string
  connection_id: string
  workspace_id: string
  execution_type: ExecutionType
  action_key: string | null
  trigger_key: string | null
  status: ExecutionStatus
  input_data: Record<string, any>
  output_data: Record<string, any>
  error_message: string | null
  error_stack: string | null
  items_processed: number
  items_created: number
  items_updated: number
  items_failed: number
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  triggered_by: string | null
  created_at: string
}

export type SyncMappingStatus = 'synced' | 'pending_push' | 'pending_pull' | 'conflict' | 'error'

export interface IntegrationSyncMapping {
  id: string
  connection_id: string
  product_id: string
  external_id: string
  external_url: string | null
  external_data: Record<string, any>
  sync_status: SyncMappingStatus
  last_pushed_at: string | null
  last_pulled_at: string | null
  last_error: string | null
  local_hash: string | null
  remote_hash: string | null
  created_at: string
  updated_at: string
}

export type IntegrationEntityType =
  | 'product'
  | 'order'
  | 'order_line'
  | 'inbound_shipment'
  | 'inventory_snapshot'
  | 'delivery_method'
  | 'address'
  | 'country'
  | 'zone'

export interface IntegrationEntityMapping {
  id: string
  workspace_id: string
  connection_id: string
  entity_type: IntegrationEntityType
  local_entity_type: string | null
  local_entity_id: string | null
  external_id: string
  external_secondary_id: string | null
  external_data: Record<string, any>
  remote_hash: string | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export type StoreReplenishmentRequestType = 'manual' | 'low_stock' | 'cycle_count' | 'campaign' | 'system_suggested' | 'pos_requested'
export type StoreReplenishmentRequestStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'deferred_to_wave'
  | 'converted'
  | 'cancelled'

export type StoreReplenishmentDecision = 'approve_now' | 'reject' | 'defer_to_wave'
export type StoreDeliveryMode = 'delivery' | 'self_collect'
export type StoreOpsPriority = 'low' | 'normal' | 'urgent' | 'critical'
export type StoreOpsSourceType = 'pos' | 'skums' | 'system' | 'integration'
export type StoreReplenishmentLineStatus = 'requested' | 'approved' | 'rejected' | 'converted' | 'unresolved'
export type StoreReplenishmentOrderStatus =
  | 'draft'
  | 'approved'
  | 'queued'
  | 'sent_to_3pl'
  | 'acknowledged'
  | 'partially_shipped'
  | 'shipped'
  | 'partially_received'
  | 'received'
  | 'exception'
  | 'cancelled'
  | 'failed'
export type StoreReplenishmentOrderLineStatus = 'ordered' | 'allocated' | 'shipped' | 'partially_received' | 'received' | 'exception' | 'cancelled'
export type ReceivingSessionType = 'store_replenishment' | 'transfer' | 'purchase_order' | 'manual'
export type ReceivingSessionStatus = 'draft' | 'submitted' | 'reconciled' | 'exception' | 'cancelled'
export type ReceivingLineExceptionType = 'short' | 'damaged' | 'over' | 'wrong_sku' | 'unexpected_item' | 'unmapped_sku'
export type ReceivingLineStatus = 'pending' | 'matched' | 'exception' | 'resolved'
export type InventoryExceptionType = 'short_receipt' | 'damaged_receipt' | 'over_receipt' | 'wrong_sku' | 'unmapped_sku' | 'stock_variance' | '3pl_error' | 'other'
export type InventoryExceptionSeverity = 'low' | 'medium' | 'high' | 'critical'
export type InventoryExceptionStatus = 'open' | 'in_review' | 'resolved' | 'dismissed' | 'escalated'
export type InventoryExceptionSourceType = 'pos_inventory_event' | 'receiving_session' | 'replenishment_order' | 'integration' | 'manual'

export interface StoreReplenishmentRequest {
  id: string
  workspace_id: string
  request_number: string
  request_type: StoreReplenishmentRequestType
  status: StoreReplenishmentRequestStatus
  priority: StoreOpsPriority
  source_type: StoreOpsSourceType
  source_ref: string | null
  idempotency_key: string | null
  pos_location_id: string | null
  store_location_id: string | null
  requested_by: string | null
  approved_by: string | null
  needed_by: string | null
  approved_at: string | null
  reason: string | null
  decision?: StoreReplenishmentDecision | null
  decision_reason?: string | null
  decided_by?: string | null
  decided_at?: string | null
  wave_id?: string | null
  wave_date?: string | null
  mcp_context?: Record<string, any>
  metadata: Record<string, any>
  created_at: string
  updated_at: string
  pos_location_name?: string | null
  pos_location_code?: string | null
  store_location_name?: string | null
  store_location_code?: string | null
  line_count?: number
  total_requested_qty?: number
  total_approved_qty?: number
}

export interface StoreReplenishmentRequestLine {
  id: string
  request_id: string
  workspace_id: string
  product_identity_id: string | null
  trade_unit_id: string | null
  listing_id: string | null
  channel_id: string | null
  sku_assignment_id: string | null
  identifier_id: string | null
  product_id: string | null
  variant_id: string | null
  sku: string | null
  requested_qty: number
  approved_qty: number | null
  status: StoreReplenishmentLineStatus
  reason: string | null
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface StoreReplenishmentOrder {
  id: string
  workspace_id: string
  order_number: string
  request_id: string | null
  connection_id: string | null
  status: StoreReplenishmentOrderStatus
  priority: StoreOpsPriority
  source_location_id: string | null
  destination_location_id: string | null
  pos_location_id: string | null
  external_order_id: string | null
  external_status: string | null
  sent_at: string | null
  expected_delivery_at: string | null
  delivered_at: string | null
  approved_by: string | null
  approved_at: string | null
  metadata: Record<string, any>
  created_at: string
  updated_at: string
  source_location_name?: string | null
  source_location_code?: string | null
  destination_location_name?: string | null
  destination_location_code?: string | null
  pos_location_name?: string | null
  pos_location_code?: string | null
  connection_name?: string | null
  integration_slug?: string | null
  line_count?: number
  total_ordered_qty?: number
  total_shipped_qty?: number
  total_received_qty?: number
  total_damaged_qty?: number
  total_short_qty?: number
}

export interface StoreReplenishmentOrderLine {
  id: string
  order_id: string
  workspace_id: string
  request_line_id: string | null
  product_identity_id: string | null
  trade_unit_id: string | null
  listing_id: string | null
  channel_id: string | null
  sku_assignment_id: string | null
  identifier_id: string | null
  product_id: string | null
  variant_id: string | null
  sku: string | null
  ordered_qty: number
  allocated_qty: number
  shipped_qty: number
  received_qty: number
  damaged_qty: number
  short_qty: number
  external_line_id: string | null
  status: StoreReplenishmentOrderLineStatus
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface ReceivingSession {
  id: string
  workspace_id: string
  session_number: string
  receipt_type: ReceivingSessionType
  status: ReceivingSessionStatus
  idempotency_key: string | null
  replenishment_order_id: string | null
  transfer_id: string | null
  purchase_order_id: string | null
  pos_location_id: string | null
  inventory_location_id: string | null
  source_ref: string | null
  received_by: string | null
  started_at: string
  received_at: string | null
  submitted_at: string | null
  reconciled_at: string | null
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface ReceivingSessionLine {
  id: string
  session_id: string
  workspace_id: string
  replenishment_order_line_id: string | null
  product_identity_id: string | null
  trade_unit_id: string | null
  listing_id: string | null
  channel_id: string | null
  sku_assignment_id: string | null
  identifier_id: string | null
  product_id: string | null
  variant_id: string | null
  sku: string | null
  expected_qty: number
  received_qty: number
  damaged_qty: number
  overage_qty: number
  short_qty: number
  exception_type: ReceivingLineExceptionType | null
  status: ReceivingLineStatus
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface InventoryException {
  id: string
  workspace_id: string
  exception_type: InventoryExceptionType
  severity: InventoryExceptionSeverity
  status: InventoryExceptionStatus
  source_type: InventoryExceptionSourceType
  source_id: string | null
  pos_location_id: string | null
  inventory_location_id: string | null
  connection_id: string | null
  product_identity_id: string | null
  trade_unit_id: string | null
  listing_id: string | null
  channel_id: string | null
  sku_assignment_id: string | null
  identifier_id: string | null
  product_id: string | null
  variant_id: string | null
  sku: string | null
  expected_qty: number | null
  actual_qty: number | null
  title: string
  summary: string | null
  evidence: Record<string, any>
  resolution: Record<string, any>
  assigned_to: string | null
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked'

// --- Organizations ---

export interface Organization {
  id: string
  name: string
  slug: string
  logo_url: string | null
  billing_email: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface OrganizationMember {
  organization_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member' | 'billing'
  created_at: string
  profile?: Profile
}

export interface OrganizationInvite {
  id: string
  organization_id: string
  email: string
  role: 'admin' | 'member' | 'billing'
  status: InviteStatus
  token: string
  invited_by: string | null
  accepted_by: string | null
  expires_at: string
  accepted_at: string | null
  created_at: string
  inviter?: Profile
}

// --- Permissions & Invites ---

export interface PermissionSet {
  read?: boolean
  write?: boolean
  delete?: boolean
  import?: boolean
  export?: boolean
  execute?: boolean
  invite?: boolean
  remove?: boolean
  change_role?: boolean
  /** Inventory / store-ops extensions (TODO-LOFT Phase P) */
  po?: boolean
  override_expiry?: boolean
  approve?: boolean
  verify?: boolean
  execute_3pl?: boolean
  inbound?: boolean
  config?: boolean
  submit?: boolean
  install?: boolean
}

export type PermissionArea =
  | 'products' | 'brands' | 'categories'
  | 'integrations' | 'credentials' | 'schemas'
  | 'custom_fields' | 'team' | 'workspace'
  | 'activity' | 'api'
  | 'inventory' | 'expiry' | 'images'
  | 'assistant' | 'organization'
  | 'locations' | 'store_ops' | 'pos'
  | 'forecasting' | 'actions' | 'intel' | 'apps'

export type PermissionsMap = Partial<Record<PermissionArea, PermissionSet>>

export interface PermissionSchema {
  id: string
  workspace_id: string | null
  name: string
  slug: string
  description: string | null
  permissions: PermissionsMap
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface WorkspaceInvite {
  id: string
  workspace_id: string
  email: string
  role: 'admin' | 'member' | 'viewer'
  permission_schema_id: string | null
  status: InviteStatus
  token: string
  invited_by: string | null
  accepted_by: string | null
  expires_at: string
  accepted_at: string | null
  created_at: string
  inviter?: Profile
}

export interface WorkspaceMemberWithProfile extends WorkspaceMember {
  profile?: Profile
  permission_schema?: PermissionSchema | null
}

// --- SKU Aliases ---

export interface SkuAlias {
  id: string
  workspace_id: string
  product_id: string
  alias_type: string
  alias_value: string
  label: string | null
  source: string | null
  created_at: string
  product?: Product
}

// --- Expiry ---

export type ExpiryItemStatus = 'in_stock' | 'sold' | 'promoted' | 'disposed' | 'returned'

export interface ExpiryBatch {
  id: string
  workspace_id: string
  batch_code: string
  received_at: string
  notes: string | null
  source: string
  source_ref: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  items?: ExpiryItem[]
  _item_count?: number
}

export interface ExpiryItem {
  id: string
  batch_id: string
  workspace_id: string
  raw_sku: string
  product_id: string | null
  quantity: number
  remaining_qty: number
  expiry_year: number
  expiry_month: number
  expiry_day: number | null
  status: ExpiryItemStatus
  unit_cost: number | null
  notes: string | null
  created_at: string
  updated_at: string
  batch?: ExpiryBatch
  product?: Product | null
}

export interface ExpiryLifoRow extends ExpiryItem {
  batch_code: string
  received_at: string
  product_title: string | null
  product_sku: string | null
  expiry_date: string
  days_until_expiry: number
}

export interface ExpirySummary {
  total_items: number
  total_quantity: number
  expired: number
  expiring_30d: number
  expiring_90d: number
  unresolved: number
  unique_products: number
}

export interface ExpiryMicrosite {
  id: string
  workspace_id: string
  slug: string
  title: string
  description: string | null
  show_product_name: boolean
  show_batch_code: boolean
  show_sku: boolean
  show_quantity: boolean
  show_days_remaining: boolean
  product_filter: string[] | null
  logo_url: string | null
  accent_color: string
  footer_text: string | null
  is_active: boolean
  password_hash: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// --- Help Center ---

export interface HelpArticleListItem {
  id: string
  slug: string
  title: string
  summary: string | null
  category: string
  primary_path: string | null
  related_paths: string[]
  intent_tags: string[]
  sort_order: number
  updated_at?: string
  help_path: string
}

export interface HelpArticle extends HelpArticleListItem {
  body_md: string
  published?: boolean
  created_at?: string
}

// --- AI Assistant ---

export interface AssistantContextProfile {
  id: string
  workspace_id: string
  user_role: 'manufacturer' | 'retailer' | 'marketer' | 'distributor' | 'custom'
  system_prompt_additions: string | null
  slack_webhook_url: string | null
  preferred_model: 'grok-3' | 'grok-3-mini'
  created_at: string
  updated_at: string
}

export interface AssistantConversation {
  id: string
  workspace_id: string
  user_id: string
  title: string
  context_type: string | null
  context_id: string | null
  created_at: string
  updated_at: string
}

export interface AssistantMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | null
  tool_calls: any | null
  tool_call_id: string | null
  tool_name: string | null
  reasoning: string | null
  model_used: string | null
  tokens_used: number | null
  finish_reason: string | null
  created_at: string
}

// --- Forecasting ---

export type AlertLevel = 'stockout' | 'critical' | 'reorder_now' | 'watch' | 'healthy' | 'overstock' | 'no_data'
export type RiskStatus = 'at_risk' | 'borderline' | 'safe' | 'unknown'

export interface ForecastEvent {
  id: string
  workspace_id: string | null
  event_name: string
  date_from: string
  date_to: string
  multiplier: number
  applies_to: string
  notes: string | null
  created_at: string
}

export interface SaleEvent {
  id: string
  workspace_id: string
  product_id: string | null
  variant_id: string | null
  quantity_sold: number
  sale_date: string
  channel: string | null
  unit_price: number | null
  currency: string
  order_ref: string | null
  source: string
  created_at: string
}

export interface DemandVelocity {
  workspace_id: string
  product_id: string
  product_title: string
  product_sku: string | null
  product_status: string
  days_with_sales: number
  first_sale_date: string | null
  last_sale_date: string | null
  units_7d: number
  units_14d: number
  units_30d: number
  units_90d: number
  velocity_7d: number
  velocity_14d: number
  velocity_30d: number
  velocity_90d: number
  best_velocity: number
}

export interface ReorderAlert {
  workspace_id: string
  product_id: string
  product_title: string
  product_sku: string | null
  daily_velocity: number
  velocity_30d: number
  velocity_7d: number
  units_30d: number
  units_90d: number
  days_with_sales: number
  last_sale_date: string | null
  available_to_sell: number
  total_on_hand: number
  total_on_order: number
  lead_time_days: number
  days_of_stock_remaining: number | null
  reorder_point: number | null
  alert_level: AlertLevel
  suggested_order_qty: number | null
}

export interface ExpiryRisk {
  item_id: string
  batch_id: string
  product_id: string
  workspace_id: string
  product_title: string
  product_sku: string | null
  remaining_qty: number
  expiry_year: number
  expiry_month: number
  expiry_day: number | null
  expiry_date: string
  days_until_expiry: number
  daily_velocity: number | null
  days_to_sell_through: number | null
  risk_status: RiskStatus
}

export interface ForecastResult {
  product_id: string
  product_title: string
  current_velocity: number
  forecast_30d: number
  forecast_60d: number
  forecast_90d: number
  confidence: 'high' | 'medium' | 'low'
  data_maturity: '<14d' | '14-59d' | '60d+'
  method_used: string
  upcoming_events: Array<{ event_name: string; date_from: string; date_to?: string; multiplier: number }>
  recommendation: string
  event_impact: string | null
  generated_at: string
}

// --- Product Quality ---

export type Marketplace = 'shopee' | 'lazada' | 'amazon' | 'iherb'
export type CompetitivePosition = 'market_leader' | 'competitive' | 'at_risk' | 'lagging' | 'niche'
export type PricePosition = 'cheapest' | 'competitive' | 'premium' | 'overpriced' | 'unknown'

export type DataSource = 'scraped' | 'ai_estimated'

export interface ProductQualitySnapshot {
  id: string
  workspace_id: string
  product_id: string | null
  marketplace: Marketplace
  found: boolean
  listing_title: string | null
  external_url: string | null
  external_product_id: string | null
  price: number | null
  currency: string
  rating: number | null
  review_count: number | null
  units_sold_label: string | null
  seller_name: string | null
  availability: string | null
  data_source: DataSource
  scrape_error: string | null
  crawled_at: string
  created_at: string
}

export interface ProductQualityAnalysis {
  id: string
  workspace_id: string
  product_id: string
  product_title?: string   // joined from products table on client
  overall_score: number | null
  price_score: number | null
  review_score: number | null
  availability_score: number | null
  competitive_position: CompetitivePosition | null
  price_position: PricePosition | null
  ai_summary: string | null
  recommendations: string[] | null
  snapshot_ids: string[] | null
  sources_checked: string[] | null
  analysed_at: string
  created_at: string
}

export interface QualityAnalysisResult {
  product_id: string
  snapshots: Omit<ProductQualitySnapshot, 'id' | 'workspace_id' | 'created_at'>[]
  analysis: {
    overall_score: number | null
    price_score: number | null
    review_score: number | null
    availability_score: number | null
    competitive_position: CompetitivePosition | null
    price_position: PricePosition | null
    ai_summary: string | null
    recommendations: string[] | null
    snapshot_ids: string[]
    sources_checked: string[]
    analysed_at: string
  }
  data_source: DataSource
  queued_for_scrape?: boolean
  payment?: {
    amount_usdc: number
    tx_hash: string | null
    network: string
  }
  generated_at: string
}

// --- Price History ---

export interface PriceHistoryEntry {
  marketplace: Marketplace
  price: number
  currency: string
  rating: number | null
  review_count: number | null
  availability: string | null
  data_source: DataSource
  crawled_at: string
}

// --- Scrape Queue ---

export type ScrapeQueueStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface ScrapeQueueItem {
  id: string
  workspace_id: string
  product_id: string
  status: ScrapeQueueStatus
  priority: number
  queued_at: string
  started_at: string | null
  completed_at: string | null
  error: string | null
  product_title?: string
  product_sku?: string | null
}

// --- x402 Payment ---

export interface QualityPaymentReceipt {
  id: string
  workspace_id: string
  payment_type: 'instant' | 'bulk'
  product_ids: string[]
  amount_usdc: number
  tx_hash: string | null
  network: string
  payer_address: string | null
  status: 'pending' | 'verified' | 'failed' | 'refunded'
  created_at: string
}

// --- Localization ---

export interface WorkspaceLocale {
  id: string
  workspace_id: string
  locale_code: string
  locale_name: string
  is_default: boolean
  is_active: boolean
  sort_order: number
  created_at: string
}

export type TranslationStatus = 'pending' | 'draft' | 'ai_translated' | 'human_reviewed' | 'approved'

export interface ProductLocalization {
  id: string
  product_id: string
  locale_code: string
  title: string | null
  description: string | null
  short_description: string | null
  seo_title: string | null
  seo_description: string | null
  seo_keywords: string[] | null
  tags: string[] | null
  localized_data: Record<string, any>
  translation_status: TranslationStatus
  translated_by: string | null
  reviewed_by: string | null
  review_notes: string | null
  source_locale: string | null
  ai_confidence: number | null
  created_at: string
  updated_at: string
}

export interface ProductIngredient {
  id: string
  product_id: string
  inci_name: string
  common_name: string | null
  cas_number: string | null
  category: string | null
  concentration: number | null
  sort_order: number
  properties: Record<string, boolean>
  skin_types: string[]
  concerns: string[]
  contraindications: string[]
  is_active_ingredient: boolean
  is_potential_allergen: boolean
  notes: string | null
  created_at: string
  updated_at: string
  localizations?: IngredientLocalization[]
}

export interface IngredientLocalization {
  id: string
  ingredient_id: string
  locale_code: string
  local_name: string | null
  description: string | null
  efficacy: string | null
  warnings: string | null
  created_at: string
  updated_at: string
}

export type ProductLocaleStatus = 'source' | 'missing' | 'complete' | 'review' | 'incomplete'

export interface ProductLocaleStatusRow {
  product_id: string
  workspace_id: string
  title: string
  status: string
  locale_code: string
  locale_name: string
  is_default: boolean
  localization_id: string | null
  translation_status: TranslationStatus | null
  ai_confidence: number | null
  translated_by: string | null
  translation_updated_at: string | null
  locale_status: ProductLocaleStatus
}

// --- Activity Log ---

export interface ActivityLog {
  id: string
  workspace_id: string
  user_id: string | null
  entity_type: string
  entity_id: string
  action: string
  changes: any
  created_at: string
  profile?: Profile
}
