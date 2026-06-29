# Headless Loyalty Project Brief

This document is a launch brief for a new project, tentatively:

```text
C:\Users\Jeremy Tan\CodeProjects\headless-loyalty
```

It should be designed to connect to:

```text
C:\Users\Jeremy Tan\CodeProjects\skums
C:\Users\Jeremy Tan\CodeProjects\pos
C:\Users\Jeremy Tan\CodeProjects\crm
```

The API benchmark is LoyaltyLion's Headless API, especially the 2025-06 version. Use it as a useful shape for a channel-aware loyalty API, not as a constraint that the product must copy.

## Product Thesis

Headless Loyalty should be a loyalty operating layer for modern commerce stacks, not a storefront widget.

The core idea:

```text
CRM owns customer memory.
SKUMS owns commerce/product truth.
POS and channels emit transactions.
Headless Loyalty turns customer events into durable benefits, rewards, tiers, and next-best actions.
```

That makes loyalty a programmable customer graph and reward ledger. It should work across POS, web, mobile, marketplace, social, and CRM campaigns without making any single channel the system of record.

## What This Should Become

Build a headless loyalty engine with:

- A channel-aware API for storefronts, mobile apps, POS, CRM, and agents.
- A durable member, points, tier, rule, reward, and redemption ledger.
- First-class return/refund/reversal handling.
- CRM graph sync so loyalty becomes part of the customer profile.
- SKUMS/POS integration so product, trade-unit, listing, receipt, and return events can drive loyalty.
- Agent-friendly proposals for risky campaign, reward, and data-repair actions.
- Webhooks and idempotent event ingestion as product primitives, not follow-up plumbing.

Avoid building:

- A Shopify-only app.
- A points widget with no ledger.
- A CRM clone.
- A POS clone.
- A campaign tool that hardcodes email/SMS providers.

## Source-System Boundaries

### CRM

Open Spine CRM should remain the customer graph system of record.

CRM owns:

- People, companies, households, and relationships.
- Consent and contactability.
- Campaign membership and communication context.
- Customer support, tickets, messages, and lifecycle stages.
- Custom fields and graph relationships.

Headless Loyalty should write loyalty summary data and events back to CRM, but should not replace CRM.

Suggested CRM entity and field projections:

```text
person
  loyalty_member_id
  loyalty_state
  loyalty_points_balance
  loyalty_pending_points
  loyalty_lifetime_points
  loyalty_tier
  loyalty_tier_progress
  loyalty_joined_at
  loyalty_last_activity_at
  loyalty_reward_count
  loyalty_referral_code
```

Suggested CRM relationships:

```text
person -has_loyalty_membership-> loyalty_membership
person -earned_reward-> reward
person -redeemed_reward-> claimed_reward
person -belongs_to_segment-> loyalty_segment
person -referred-> person
campaign -triggered_by-> loyalty_event
```

### SKUMS

SKUMS should remain the product, channel, and commerce operating core.

SKUMS owns:

- Product identities.
- Trade units.
- Contextual SKUs.
- Listings and channel projections.
- Channel requirements and promotion surfaces.
- POS catalog contracts.
- Domain events, attention items, proposals, approvals, and audit history.

Headless Loyalty should ask SKUMS what was sold, where, in which trade unit, through which listing/channel, and whether a product reward can be fulfilled.

Suggested SKUMS dependencies:

```text
GET  /api/v1/pos/catalog
POST /api/v1/pos/sales
POST /api/v1/pos/inventory-events
GET  /api/v1/events
POST /api/v1/events
POST /api/v1/attention-items
POST /api/v1/agent-proposals
```

### POS

POS should remain a sales execution surface.

POS owns:

- Cashier workflow.
- Cart and sale state.
- Register sessions.
- Tender details.
- Returns and exchanges.
- Receipt/customer capture at checkout.
- Offline retry behavior.

Headless Loyalty should give POS small, reliable checkout APIs:

```text
lookup member
preview earn
preview redeemable rewards
authorize redemption
commit sale
reverse sale or return
```

Do not force POS to know the internal rule engine. POS should send facts and receive wallet/reward decisions.

## LoyaltyLion Reference Shape

LoyaltyLion's Headless API is a useful external reference because it is explicitly built for headless storefronts, mobile apps, and custom POS.

Important patterns to reuse:

- API versioning in the path.
- A site or program ID in the path.
- A required channel parameter.
- Bearer-token authentication.
- Configuration as an API resource.
- Customer/session initialization as a first-class call.
- Separate reward redemption endpoints by reward kind.
- Rule completion endpoints.
- Shopper-facing errors limited mostly to unprocessable business states.

Reference Headless API endpoint vocabulary:

```text
GET  /headless/2025-06/{site_id}/configuration
GET  /headless/2025-06/{site_id}/customers/{merchant_id}
POST /headless/2025-06/{site_id}/customers/{merchant_id}/sessions
POST /headless/2025-06/{site_id}/customers/{merchant_id}/birthday
POST /headless/2025-06/{site_id}/customers/{merchant_id}/email_marketing/subscribe

POST /headless/2025-06/{site_id}/rewards/cart_discount_voucher/redeem
POST /headless/2025-06/{site_id}/rewards/free_shipping_voucher/redeem
POST /headless/2025-06/{site_id}/rewards/collection_discount_voucher/redeem
POST /headless/2025-06/{site_id}/rewards/product_discount_voucher/redeem
POST /headless/2025-06/{site_id}/rewards/gift_card/redeem
POST /headless/2025-06/{site_id}/rewards/custom/redeem
POST /headless/2025-06/{site_id}/rewards/product_cart/redeem
POST /headless/2025-06/{site_id}/rewards/product_cart/refund

POST /headless/2025-06/{site_id}/rules/clickthrough/complete
POST /headless/2025-06/{site_id}/rules/facebook_like/complete
POST /headless/2025-06/{site_id}/rules/twitter_follow/complete
POST /headless/2025-06/{site_id}/rules/instagram_follow/complete
POST /headless/2025-06/{site_id}/rules/tiktok_follow/complete
POST /headless/2025-06/{site_id}/rules/custom/complete
```

Important reference details:

- `channel` should be channel-aware. LoyaltyLion supports `web`, `pos`, and `mobile`. Headless Loyalty should start with these and be ready for `marketplace`, `social`, and `agent`.
- `language` and `country` should be optional request context, because reward availability and copy can differ by market.
- `422` should mean a valid request could not be processed for a business reason. It is the main class of error that can be turned into customer-facing copy.
- `400`, `401`, `403`, `404`, and `429` should generally be integration, auth, missing-resource, or retry concerns.

Source links:

- [LoyaltyLion Headless API introduction](https://developers.loyaltylion.com/headless-api/introduction)
- [LoyaltyLion Headless API errors](https://developers.loyaltylion.com/headless-api/errors)
- [LoyaltyLion Headless OpenAPI spec](https://developers.loyaltylion.com/headless-api/2025-06/openapi.json)
- [LoyaltyLion API keys](https://developers.loyaltylion.com/api-reference/authentication/api-keys)

## Recommended New Project Stack

Keep it close to SKUMS and CRM so contracts stay easy to share.

```text
Nuxt 3
Nitro server routes
Supabase Postgres
TypeScript
Zod for request contracts
Vitest or node:test contract tests
OpenAPI generated from route schemas once stable
```

Suggested top-level layout:

```text
headless-loyalty/
  app/
  server/
    api/
      v1/
    utils/
      rules/
      rewards/
      connectors/
        crm/
        skums/
        pos/
  core/
    db/
  packages/
    @loyalty-types/
  docs/
    API_CONTRACT.md
    DATA_MODEL.md
    CRM_CONNECTOR.md
    SKUMS_CONNECTOR.md
    POS_CONNECTOR.md
  tests/
```

## Domain Model

Use an append-only ledger for all economic state. Balances are projections, not the source of truth.

Core tables:

```text
loyalty_workspaces
loyalty_programs
loyalty_sites
loyalty_channels
loyalty_api_keys

loyalty_members
loyalty_member_identities
loyalty_member_segments
loyalty_member_consents

loyalty_point_accounts
loyalty_point_ledger_entries
loyalty_balance_snapshots

loyalty_tiers
loyalty_tier_snapshots
loyalty_tier_rules

loyalty_rules
loyalty_rule_completions
loyalty_earning_policies

loyalty_rewards
loyalty_reward_variants
loyalty_claimed_rewards
loyalty_redemption_codes
loyalty_reward_fulfillments

loyalty_events
loyalty_idempotency_keys
loyalty_webhook_subscriptions
loyalty_webhook_deliveries

loyalty_connector_accounts
loyalty_external_links
loyalty_sync_jobs
loyalty_sync_job_steps

loyalty_agent_proposals
loyalty_approval_requests
loyalty_execution_logs
```

Important design choices:

- `loyalty_member_identities` maps CRM person IDs, POS customer IDs, ecommerce customer IDs, email hashes, phone hashes, and external merchant IDs to one member.
- `loyalty_external_links` records cross-system references for CRM, SKUMS, POS, Shopify, and future channels.
- `loyalty_point_ledger_entries` is append-only. Never update a historical ledger row to "fix" points.
- `loyalty_claimed_rewards` should represent a customer claim. Fulfillment may still be pending.
- `loyalty_redemption_codes` should be treated as sensitive. Full codes may need one-time visibility.
- `loyalty_idempotency_keys` should cover every write endpoint, webhook, and imported event.

## API Surface

Design the API for clients that do not share one UI.

### Public Headless API

```text
GET  /api/v1/{program_id}/configuration
GET  /api/v1/{program_id}/members/{member_key}
POST /api/v1/{program_id}/members/{member_key}/sessions
POST /api/v1/{program_id}/members/{member_key}/birthday
POST /api/v1/{program_id}/members/{member_key}/consents/email-marketing

POST /api/v1/{program_id}/earn/preview
POST /api/v1/{program_id}/earn/commit
POST /api/v1/{program_id}/earn/reverse

GET  /api/v1/{program_id}/members/{member_key}/rewards
POST /api/v1/{program_id}/rewards/{reward_kind}/redeem
POST /api/v1/{program_id}/rewards/{reward_kind}/refund

POST /api/v1/{program_id}/rules/{rule_kind}/complete
POST /api/v1/{program_id}/events
```

Required request context:

```text
channel=web|pos|mobile|marketplace|social|agent
```

Optional request context:

```text
country=SG
language=en
currency=SGD
location_id=<store/location id>
register_id=<POS register id>
listing_id=<SKUMS listing id>
```

### Admin API

```text
GET  /api/v1/admin/programs
POST /api/v1/admin/programs
GET  /api/v1/admin/programs/{program_id}
PUT  /api/v1/admin/programs/{program_id}

GET  /api/v1/admin/rules
POST /api/v1/admin/rules
PUT  /api/v1/admin/rules/{rule_id}

GET  /api/v1/admin/rewards
POST /api/v1/admin/rewards
PUT  /api/v1/admin/rewards/{reward_id}

GET  /api/v1/admin/tiers
POST /api/v1/admin/tiers
PUT  /api/v1/admin/tiers/{tier_id}

GET  /api/v1/admin/members
GET  /api/v1/admin/members/{member_id}
POST /api/v1/admin/members/{member_id}/adjust-points

GET  /api/v1/admin/connectors
POST /api/v1/admin/connectors/crm
POST /api/v1/admin/connectors/skums
POST /api/v1/admin/connectors/pos
```

### Webhook API

```text
POST /api/v1/webhooks/crm
POST /api/v1/webhooks/skums
POST /api/v1/webhooks/pos
POST /api/v1/webhooks/shopify
POST /api/v1/webhooks/custom

GET  /api/v1/admin/webhooks
POST /api/v1/admin/webhooks
DELETE /api/v1/admin/webhooks/{webhook_id}
```

Webhook requirements:

- HMAC signatures.
- Timestamp tolerance.
- Idempotency by provider event ID.
- Durable delivery records.
- Retry with backoff.
- Dead-letter status and replay.

## Event Vocabulary

### Incoming From POS

```text
pos.customer.attached
pos.sale.preview_requested
pos.sale.completed
pos.return.completed
pos.reward.redeem_requested
pos.reward.refund_requested
receipt.email.requested
```

### Incoming From SKUMS

```text
skums.product_identity.updated
skums.trade_unit.updated
skums.listing.updated
skums.channel_requirement.changed
skums.promotion_event.created
skums.pos_sale.completed
skums.pos_return.completed
skums.inventory_event.created
```

### Incoming From CRM

```text
crm.person.created
crm.person.updated
crm.person.merged
crm.consent.updated
crm.segment.entered
crm.segment.exited
crm.campaign.sent
crm.campaign.clicked
crm.ticket.opened
```

### Outgoing To CRM

```text
loyalty.member.enrolled
loyalty.member.updated
loyalty.points.earned
loyalty.points.reversed
loyalty.tier.upgraded
loyalty.tier.downgraded
loyalty.reward.available
loyalty.reward.claimed
loyalty.reward.redeemed
loyalty.reward.expired
loyalty.referral.completed
loyalty.segment.entered
loyalty.segment.exited
```

### Outgoing To SKUMS/POS

```text
loyalty.reward.fulfillment_requested
loyalty.product_reward.reservation_requested
loyalty.cart_adjustment.authorized
loyalty.pos_discount.authorized
loyalty.inventory_hold.requested
loyalty.reward.fulfillment_cancelled
```

## Checkout Flow

Use this as the first POS and web integration flow.

```text
1. Customer is identified by CRM person ID, email, phone, POS customer ID, or ecommerce customer ID.
2. Client calls POST /members/{member_key}/sessions with channel and cart context.
3. Loyalty returns wallet, tier, rules, available rewards, and earn preview.
4. Customer selects a reward.
5. Client calls POST /rewards/{reward_kind}/redeem with idempotency key.
6. Loyalty validates eligibility and reserves or issues the reward.
7. POS/storefront applies the authorized discount/product/gift.
8. Client commits sale through POST /earn/commit or POS/SKUMS sale webhook.
9. Loyalty writes ledger entries, updates projections, emits CRM and SKUMS events.
10. CRM displays updated loyalty state on the customer graph.
```

## Return And Refund Flow

Returns must be first-class. This is where many loyalty integrations get messy.

```text
1. POS emits pos.return.completed with original transaction reference.
2. Loyalty loads related earn ledger entries and claimed rewards.
3. Loyalty writes reversal ledger entries, never mutating the original earn rows.
4. If a claimed reward should be restored, create a reward refund event.
5. If a reward should be voided, mark claimed reward invalid and emit fulfillment cancellation if needed.
6. Recompute tier and balance projections.
7. Emit loyalty.points.reversed and loyalty.reward.refund events to CRM.
```

## Reward Types

Start narrow, but model broadly.

MVP reward kinds:

```text
cart_discount
free_shipping
product_discount
gift_card
custom_store_fulfillment
points_adjustment
```

Next reward kinds:

```text
free_product
bundle_reward
sample_reward
subscription_discount
partner_reward
early_access
store_credit
experiential_reward
```

SKUMS-specific reward opportunity:

```text
product_reward
  references product_identity_id, trade_unit_id, listing_id, or sku_assignment_id
  can validate channel availability through SKUMS
  can request inventory hold or fulfillment through SKUMS/POS
```

## Rule Types

MVP rules:

```text
purchase_completed
first_purchase
birthday_set
email_marketing_subscribed
profile_completed
custom_event
```

Next rules:

```text
product_category_purchase
trade_unit_purchase
channel_purchase
store_visit
review_submitted
referral_completed
social_follow
campaign_clickthrough
repeat_purchase_window
winback_purchase
high_margin_product_purchase
inventory_clearance_purchase
```

Bold SKUMS-aware rules:

```text
buy from a channel-specific listing
buy a product with expiring inventory risk
buy a preferred trade unit
buy a launch product in a target market
buy across web and POS in the same month
buy a bundle assembled from SKUMS component trade units
```

## CRM Connector

The CRM connector should be API-first and graph-aware.

Minimum writeback:

```text
upsert loyalty member summary as CRM custom fields
create/update loyalty_membership entity
create relationships from person to loyalty membership
append loyalty activity events
create segment membership edges
surface reward/tier changes in customer timeline
```

Minimum read:

```text
person lookup by crm_entity_id
person lookup by email/phone
consent state
campaign membership
segment membership
household/company relationships when available
```

Do not make Loyalty responsible for sending emails. Loyalty should emit campaign-ready events and let CRM or a merchant-owned provider decide delivery.

## POS Connector

Minimum POS integration:

```text
member lookup by phone/email/customer ID
session initialize at cart start
earn preview during checkout
reward redeem authorization
sale commit
return/reversal
offline retry by idempotency key
```

The POS should be able to run with:

```text
VITE_LOYALTY_API_URL=https://...
VITE_LOYALTY_API_KEY=...
VITE_LOYALTY_PROGRAM_ID=...
```

Keep POS payloads simple:

```json
{
  "idempotency_key": "pos_sale_123",
  "member_key": "crm:person_123",
  "channel": "pos",
  "currency": "SGD",
  "location_id": "store_001",
  "cart": {
    "subtotal": 12800,
    "discount_total": 1000,
    "tax_total": 900,
    "grand_total": 12700,
    "items": [
      {
        "line_id": "1",
        "skums_product_identity_id": "optional",
        "skums_trade_unit_id": "optional",
        "sku": "SERUM-30ML",
        "quantity": 1,
        "unit_price": 12800
      }
    ]
  }
}
```

## SKUMS Connector

Minimum SKUMS integration:

```text
map sale line items to product identities/trade units/listings
validate product rewards against sellable catalog state
receive POS sale and return events
emit loyalty-triggered product reward fulfillment requests
create attention items when loyalty fulfillment fails
create agent proposals for high-risk reward or campaign operations
```

SKUMS should not need to understand loyalty internals. It should receive typed requests such as:

```text
reserve this trade unit for this claimed reward
confirm this listing is sellable in this channel/country
record this reward fulfillment event
raise attention item because reward stock is unavailable
```

## Security And Auth

API keys:

```text
loyalty:configuration:read
loyalty:members:read
loyalty:members:write
loyalty:events:write
loyalty:rewards:redeem
loyalty:admin
loyalty:webhooks:write
```

Key rules:

- Use Bearer tokens.
- Store only hashed API keys.
- Scope keys by workspace/program.
- Separate POS keys from admin keys.
- Separate CRM connector keys from public client keys.
- Add OAuth later for installable third-party integrations.
- Sign webhooks.
- Never expose service-role keys to POS, CRM, storefront, or mobile clients.

PII rules:

- Prefer CRM entity IDs over copying profile data.
- Store email/phone only when needed for identity resolution, and consider normalized hash columns.
- Respect CRM consent state before marketing-trigger rules.
- Store reward code secrets carefully. Full gift card or voucher codes may need one-time display semantics.

## Idempotency Rules

Every write path must support idempotency.

Recommended idempotency keys:

```text
pos sale:        pos:{location_id}:{transaction_id}
pos return:      pos_return:{location_id}:{return_id}
crm event:       crm:{event_id}
skums event:     skums:{event_id}
web redemption:  web:{session_id}:{reward_id}:{client_nonce}
manual adjust:   admin:{user_id}:{request_id}
```

On duplicate idempotency keys:

- Return the original response if the payload hash matches.
- Return `409 idempotency_conflict` if the payload hash differs.
- Never double-award points.
- Never double-issue a reward code.

## Error Model

Use predictable API errors.

```text
400 invalid_request
401 authentication_required
403 permission_denied
404 not_found
409 idempotency_conflict
422 business_rule_failed
429 rate_limited
500 internal_error
```

Useful `422` codes:

```text
member_not_enrolled
member_blocked
insufficient_points
reward_out_of_stock
reward_not_available_for_channel
reward_not_available_for_country
reward_already_claimed
rule_already_completed
cart_does_not_qualify
sale_already_reversed
consent_required
```

## Agent Layer

Do not let agents mutate loyalty economics directly. Agents should propose changes.

Good agent proposal types:

```text
create winback segment
create reward for slow-moving SKUMS inventory
increase birthday reward for VIP tier
merge duplicate loyalty members
repair failed CRM sync
repair failed reward fulfillment
detect suspicious point adjustments
generate promotion for channel-specific listings
```

Proposal payload:

```json
{
  "proposal_type": "create_campaign_reward",
  "risk": "medium",
  "affected_objects": [
    { "type": "segment", "id": "at_risk_customers" },
    { "type": "reward", "id": "new" }
  ],
  "proposed_steps": [
    "Create reward definition",
    "Limit to POS channel",
    "Sync campaign-ready segment to CRM"
  ],
  "approval_required": true,
  "rollback": {
    "kind": "disable_reward",
    "notes": "Existing claims remain valid unless explicitly voided"
  }
}
```

## Bold Product Bets

### 1. Benefit Compiler

Rules should compile into channel-specific execution plans.

```text
same reward definition
  -> POS discount authorization
  -> Shopify cart function payload
  -> CRM campaign copy
  -> marketplace voucher eligibility
  -> mobile wallet card
```

### 2. Loyalty As Customer Graph

Treat rewards, tiers, referrals, and campaigns as graph edges around a person, not flat fields on a customer row.

### 3. Commerce-Aware Segments

Segments should use SKUMS graph facts:

```text
bought trade unit X
bought across POS and web
bought a listing in Shopee SG
bought product with expiry risk
bought high-margin bundle
```

### 4. Return-Safe Loyalty

Make reversals and reward refunds excellent from day one. This will matter for POS trust.

### 5. Provider-Neutral Campaign Delivery

Do not build a hardcoded mailer. Emit campaign and loyalty events to CRM, then let merchants connect the communication provider they own.

### 6. Agent-Operated But Approval-Gated

Agents can suggest loyalty mechanics, but approvals guard economics, customer trust, and fulfillment risk.

## MVP Build Plan

### Phase 0: Repo And Contracts

Deliver:

- New Nuxt/Supabase repo.
- `docs/API_CONTRACT.md`.
- `docs/DATA_MODEL.md`.
- Initial migration runner or Supabase migration folder.
- API key model.
- Basic OpenAPI or route schema scaffolding.

Done when:

- Tests assert route schemas and migration table shape.
- Local dev can run without live CRM/SKUMS/POS credentials.

### Phase 1: Program, Member, CRM Sync

Deliver:

- Program configuration API.
- Member lookup and session initialization.
- CRM connector account config.
- CRM writeback of loyalty summary fields/events.
- Append-only points ledger.

Done when:

- A CRM person can become a loyalty member.
- Loyalty state appears back in CRM.
- Repeated session calls are idempotent.

### Phase 2: POS Earn And Redeem

Deliver:

- POS API key scope.
- Earn preview.
- Sale commit.
- Reward redemption.
- Return reversal.
- POS connector docs.

Done when:

- POS can preview points before payment.
- POS can redeem a reward.
- POS can complete a sale and update loyalty balance.
- POS can return a sale and reverse points safely.

### Phase 3: SKUMS Product Rewards

Deliver:

- SKUMS connector.
- Product/trade-unit reward definitions.
- Fulfillment request events.
- Attention item creation for failed fulfillment.
- Reward eligibility by channel/country/listing.

Done when:

- A reward can target a SKUMS trade unit.
- The reward is hidden when not sellable in the current channel.
- A failed fulfillment raises a SKUMS attention item.

### Phase 4: Campaigns, Segments, Agents

Deliver:

- Loyalty segments.
- CRM segment sync.
- Agent proposals for rewards/campaigns/member merges.
- Approval workflow.
- Webhook delivery replay UI or admin endpoint.

Done when:

- A user can create a segment from loyalty and commerce facts.
- CRM receives that segment.
- Agent proposals require approval before changing rewards or balances.

### Phase 5: Marketplace And Social Channels

Deliver:

- `marketplace` and `social` channel contexts.
- Channel-specific reward availability.
- Referral and campaign clickthrough rules.
- Marketplace listing-aware rewards.

Done when:

- Loyalty mechanics can vary by channel without duplicating programs.
- SKUMS listing/channel context affects eligibility.

## First Demo Scenario

Use this demo because it shows why the project matters.

```text
1. CRM has a customer named Maya.
2. POS identifies Maya by phone at checkout.
3. POS initializes Maya's loyalty session.
4. Headless Loyalty shows her tier, points, and available rewards.
5. Maya redeems a product reward tied to a SKUMS trade unit.
6. POS completes the sale.
7. Loyalty writes points ledger entries and emits loyalty.points.earned.
8. CRM shows Maya's updated loyalty profile and timeline.
9. SKUMS receives reward fulfillment context.
10. Maya returns one item.
11. Loyalty reverses the correct points and updates CRM.
```

This demo proves the cross-system contract:

```text
CRM identity
POS checkout
SKUMS product/trade-unit truth
Headless loyalty ledger
event-driven sync
return-safe economics
```

## Non-Negotiable Engineering Rules

- Ledger first. Balances are projections.
- Idempotency on every write.
- Program/channel/country/language context on customer-facing reads.
- CRM IDs preferred over duplicated profile data.
- POS keys are low-privilege.
- Admin keys never ship to POS or browser clients.
- Reward code secrets are sensitive.
- Returns and refunds are part of MVP, not cleanup.
- CRM/SKUMS/POS connectors are replaceable adapters.
- Any agent action that changes points, tiers, rewards, or campaigns needs an approval path.

## Suggested Environment Variables

```text
NUXT_PUBLIC_SUPABASE_URL=
NUXT_PUBLIC_SUPABASE_KEY=
SUPABASE_SERVICE_ROLE_KEY=

LOYALTY_PUBLIC_BASE_URL=
LOYALTY_SIGNING_SECRET=
LOYALTY_API_KEY_PEPPER=

CRM_API_URL=http://localhost:3000
CRM_API_KEY=

SKUMS_API_URL=http://localhost:3000
SKUMS_API_KEY=

POS_WEBHOOK_SECRET=
CRM_WEBHOOK_SECRET=
SKUMS_WEBHOOK_SECRET=
```

## Open Questions

- Should CRM and Loyalty share a Supabase project in early development, or stay separate with connector APIs from day one?
- Should member IDs be generated by Loyalty, or should CRM person IDs be accepted as first-class member keys?
- Which POS customer identifier is available at checkout most reliably: phone, email, CRM person ID, or POS-local customer ID?
- Should points be one currency per program at MVP, or multiple point accounts per program?
- Should rewards be claim-first or apply-at-checkout-first for POS MVP?
- What is the first real channel beyond POS: web, Shopify, marketplace, or mobile?

## Recommended First Implementation Decision

Use separate services, connected by APIs.

```text
CRM remains customer graph.
SKUMS remains commerce graph.
POS remains cashier surface.
Headless Loyalty becomes reward ledger and rules engine.
```

For MVP identity, use:

```text
member_key = crm:<crm_entity_id>
```

Then add email, phone, POS customer ID, and ecommerce customer ID as secondary identities in `loyalty_member_identities`.

This keeps the first implementation clean while still allowing real-world identity resolution later.
