import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')
const attentionMigration = readFileSync(new URL('../core/db/041_product_attention_items.sql', import.meta.url), 'utf8')
const channelMigration = readFileSync(new URL('../core/db/042_channel_intelligence.sql', import.meta.url), 'utf8')
const attentionGet = readFileSync(new URL('../server/api/v1/attention-items.get.ts', import.meta.url), 'utf8')
const attentionPost = readFileSync(new URL('../server/api/v1/attention-items.post.ts', import.meta.url), 'utf8')
const attentionResolve = readFileSync(new URL('../server/api/v1/attention-items/[id]/resolve.post.ts', import.meta.url), 'utf8')
const attentionProposal = readFileSync(new URL('../server/api/v1/attention-items/[id]/proposals.post.ts', import.meta.url), 'utf8')
const fromAttention = readFileSync(new URL('../server/api/v1/agent-proposals/from-attention-item.post.ts', import.meta.url), 'utf8')
const dryRun = readFileSync(new URL('../server/api/v1/agent-proposals/[id]/dry-run.post.ts', import.meta.url), 'utf8')
const execute = readFileSync(new URL('../server/api/v1/agent-proposals/[id]/execute.post.ts', import.meta.url), 'utf8')
const attentionUtils = readFileSync(new URL('../server/utils/attentionItems.ts', import.meta.url), 'utf8')
const salesRoute = readFileSync(new URL('../server/api/v1/pos/sales.post.ts', import.meta.url), 'utf8')
const posSaleIngest = readFileSync(new URL('../server/utils/posSaleIngest.ts', import.meta.url), 'utf8')
const inventoryEventsRoute = readFileSync(new URL('../server/api/v1/pos/inventory-events.post.ts', import.meta.url), 'utf8')
const catalogRoute = readFileSync(new URL('../server/api/v1/pos/catalog.get.ts', import.meta.url), 'utf8')
const indexRoute = readFileSync(new URL('../server/api/v1/index.get.ts', import.meta.url), 'utf8')
const openapiRoute = readFileSync(new URL('../server/api/v1/openapi.get.ts', import.meta.url), 'utf8')
const types = readFileSync(new URL('../app/types/index.ts', import.meta.url), 'utf8')
const squareAdapter = readFileSync(new URL('../channels/square/adapter.ts', import.meta.url), 'utf8')
const squareMapping = readFileSync(new URL('../channels/square/mapping.ts', import.meta.url), 'utf8')
const squareWebhook = readFileSync(new URL('../channels/square/webhook.ts', import.meta.url), 'utf8')
const squareReadme = readFileSync(new URL('../channels/square/README.md', import.meta.url), 'utf8')
const headlessDoc = readFileSync(new URL('../docs/headless-commerce-api.md', import.meta.url), 'utf8')

test('Phase 1 migrations are registered and define attention/channel primitives', () => {
  assert.match(migrationsDoc, /\|\s*041\s*\|\s*product_attention_items\.sql\s*\|/)
  assert.match(migrationsDoc, /\|\s*042\s*\|\s*channel_intelligence\.sql\s*\|/)

  assert.match(attentionMigration, /create table if not exists public\.product_attention_items/i)
  assert.match(attentionMigration, /attention_type\s+text not null/)
  assert.match(attentionMigration, /proposal_id\s+uuid references public\.agent_proposals/)
  assert.match(attentionMigration, /create unique index if not exists idx_product_attention_items_idempotency/)
  assert.match(attentionMigration, /create or replace function public\.create_product_attention_item/)
  assert.match(attentionMigration, /alter table public\.product_attention_items enable row level security/i)

  for (const table of [
    'channel_capabilities',
    'channel_requirements',
    'channel_offer_rules',
    'listing_content_variants',
    'promotion_events',
    'fulfillment_policies',
    'channel_fee_snapshots',
    'listing_quality_findings',
  ]) {
    assert.match(channelMigration, new RegExp(`create table if not exists public\\.${table}`, 'i'))
  }
  assert.match(channelMigration, /create or replace function public\.resolve_channel_capabilities/)
  assert.match(channelMigration, /'square'/)
})

test('attention item APIs are scoped, idempotent, and proposal-aware', () => {
  assert.match(attentionGet, /requireApiKey\(event,\s*'agents:read'\)/)
  assert.match(attentionGet, /\.from\('product_attention_items'\)/)
  assert.match(attentionGet, /\.eq\('workspace_id',\s*ctx\.workspaceId\)/)

  assert.match(attentionPost, /requireApiKey\(event,\s*'agents:write'\)/)
  assert.match(attentionPost, /attention_type is required/)
  assert.match(attentionPost, /idempotency_key/)
  assert.match(attentionPost, /\.from\('product_attention_items'\)/)

  assert.match(attentionResolve, /attention_item\.\$\{status\}/)
  assert.match(attentionResolve, /\.from\('domain_events'\)\.insert/)
  assert.match(attentionProposal, /buildAgentProposalFromAttentionItem\(item, body\)/)
  assert.match(attentionProposal, /\.from\('agent_proposals'\)/)
  assert.match(attentionProposal, /status: 'proposed'/)

  assert.match(attentionUtils, /attentionAgentType/)
  assert.match(attentionUtils, /inventory_resolution_agent/)
  assert.match(attentionUtils, /channel_listing_agent/)
})

test('agent proposal APIs support attention creation, dry-run, and approved execution', () => {
  assert.match(fromAttention, /attention_item_id is required/)
  assert.match(fromAttention, /buildAgentProposalFromAttentionItem/)
  assert.match(fromAttention, /\.from\('product_attention_items'\)/)

  assert.match(dryRun, /mode: 'dry_run'/)
  assert.match(dryRun, /\.from\('agent_execution_logs'\)\.insert/)
  assert.match(dryRun, /would_execute: proposal\.status === 'approved'/)

  assert.match(execute, /proposal must be approved before execution/)
  assert.match(execute, /status: 'executing'/)
  assert.match(execute, /agent_proposal\.executed/)
  assert.match(execute, /source_attention_item_id/)
  assert.match(execute, /status: 'resolved'/)
})

test('POS routes emit headless domain signals and attention items', () => {
  assert.match(catalogRoute, /revision: product\.updated_at \|\| product\.created_at \|\| product\.id/)
  assert.match(catalogRoute, /updated_at: product\.updated_at \|\| null/)

  assert.match(salesRoute, /createPosSaleFromBody/)
  assert.match(posSaleIngest, /\.eq\('idempotency_key', body\.idempotency_key\)/)
  assert.match(posSaleIngest, /duplicate: true/)
  assert.match(posSaleIngest, /pos_sale\.completed/)
  assert.match(posSaleIngest, /pos_return\.completed/)
  assert.match(posSaleIngest, /\.from\('domain_events'\)\.insert/)

  assert.match(inventoryEventsRoute, /pos\.\$\{eventType\}/)
  assert.match(inventoryEventsRoute, /\.from\('product_attention_items'\)/)
  assert.match(inventoryEventsRoute, /attention_item: attentionItem/)
})

test('API discovery, OpenAPI, types, and docs expose Phase 1 contracts', () => {
  for (const path of [
    'GET /api/v1/attention-items',
    'POST /api/v1/attention-items',
    'POST /api/v1/agent-proposals/from-attention-item',
    'POST /api/v1/agent-proposals/:id/dry-run',
    'POST /api/v1/agent-proposals/:id/execute',
  ]) {
    assert.match(indexRoute, new RegExp(path.replace(/[/:]/g, (m) => `\\${m}`)))
  }

  for (const token of [
    'ProductAttentionItem',
    'AgentProposalDryRun',
    'createAttentionItem',
    'createAgentProposalFromAttentionItem',
    'dryRunAgentProposal',
    'executeAgentProposal',
    'createPosSale',
  ]) {
    assert.match(openapiRoute, new RegExp(token))
  }

  for (const name of [
    'ProductAttentionItem',
    'ChannelCapability',
    'ChannelRequirement',
    'ChannelOfferRule',
    'ListingContentVariant',
    'PromotionEvent',
    'FulfillmentPolicy',
    'ChannelFeeSnapshot',
    'ListingQualityFinding',
    'AgentProposalDryRunResult',
  ]) {
    assert.match(types, new RegExp(`export interface ${name}`))
  }

  assert.match(headlessDoc, /Headless Commerce API/)
  assert.match(headlessDoc, /attention items/i)
  assert.match(headlessDoc, /Square Scaffold/)
})

test('Square channel scaffold maps, validates, and normalizes webhooks without live API writes', () => {
  assert.match(squareAdapter, /id: 'square'/)
  assert.match(squareAdapter, /validateSquareSku/)
  assert.match(squareAdapter, /square_connector_not_configured/)
  assert.match(squareAdapter, /handleWebhook/)
  assert.match(squareMapping, /skumsToSquareCatalogObjects/)
  assert.match(squareMapping, /ITEM_VARIATION/)
  assert.match(squareWebhook, /squareWebhookToDeltas/)
  assert.match(squareWebhook, /inventory_change/)
  assert.match(squareReadme, /non-networked/)
})
