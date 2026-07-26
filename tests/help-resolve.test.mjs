/**
 * Help Center matcher + wiring (no DB required for rank tests)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { rankHelpArticles, tokenizeHelpQuery } from '../core/help/index.mjs'

const migration = readFileSync(new URL('../core/db/053_help_articles.sql', import.meta.url), 'utf8')
const tools = readFileSync(new URL('../server/utils/assistantTools.ts', import.meta.url), 'utf8')
const prompt = readFileSync(new URL('../server/utils/assistantPrompt.ts', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../app/components/AppSidebar.vue', import.meta.url), 'utf8')
const helpIndex = readFileSync(new URL('../app/pages/help/index.vue', import.meta.url), 'utf8')

const seedArticles = [
  {
    id: '1',
    slug: 'edit-products',
    title: 'Edit products',
    summary: 'Find and change product master data',
    body_md: '## Steps\n1. Open Products\n2. Click a product\n3. Save changes',
    category: 'products',
    primary_path: '/products',
    related_paths: ['/products/new'],
    intent_tags: ['edit', 'product', 'products', 'change', 'where', 'go'],
    sort_order: 20,
  },
  {
    id: '2',
    slug: 'import-catalog',
    title: 'Import a catalog',
    summary: 'Bulk load CSVs',
    body_md: '1. Open Import / Export',
    category: 'products',
    primary_path: '/import-export',
    related_paths: [],
    intent_tags: ['import', 'csv', 'upload', 'bulk'],
    sort_order: 30,
  },
  {
    id: '3',
    slug: 'actions-inbox',
    title: 'Actions inbox',
    summary: 'Approve drafts',
    body_md: '1. Open Actions',
    category: 'actions',
    primary_path: '/actions',
    related_paths: [],
    intent_tags: ['actions', 'approve', 'draft', 'mcp'],
    sort_order: 60,
  },
  {
    id: '4',
    slug: 'inventory-stock',
    title: 'Inventory and stock',
    summary: 'Stock levels',
    body_md: '1. Open Inventory',
    category: 'inventory',
    primary_path: '/inventory',
    related_paths: [],
    intent_tags: ['inventory', 'stock', 'ats'],
    sort_order: 50,
  },
  {
    id: '5',
    slug: 'store-ops-replenishment',
    title: 'Approve store replenishment',
    summary: 'HQ approve or defer to Mon/Thu wave',
    body_md: '1. Open Store Ops Queue\n2. Approve or defer\n3. Send to Loft separately',
    category: 'operations',
    primary_path: '/store-ops',
    related_paths: [],
    intent_tags: ['approve', 'replenishment', 'request', 'wave', 'lift', 'defer', 'monday', 'thursday'],
    sort_order: 71,
  },
  {
    id: '6',
    slug: 'operator-runbook',
    title: 'Operator runbook',
    summary: 'How to operate SKUMS day to day',
    body_md: '1. Use Store Ops for waves and receive\n2. Floor apply for damage',
    category: 'operations',
    primary_path: '/store-ops',
    related_paths: [],
    intent_tags: ['operator', 'runbook', 'operate', 'store ops', 'loft', 'floor'],
    sort_order: 12,
  },
  {
    id: '7',
    slug: 'po-transfer-lifecycle',
    title: 'PO and stock movement statuses',
    summary: 'Status rules for supplier POs and transfers as of 2026-07-24',
    body_md: '## AGENT RULES\n1. approve ≠ confirm ≠ in transit\n2. FOB before supplier in transit',
    category: 'operations',
    primary_path: '/actions',
    related_paths: [],
    intent_tags: [
      'po',
      'purchase order',
      'status',
      'lifecycle',
      'fob',
      'in transit',
      'transfer',
      'confirmed',
      'stock movement',
    ],
    sort_order: 55,
  },
  {
    id: '8',
    slug: 'crm-pos-skums-setup',
    title: 'Setup CRM POS SKUMS',
    summary: 'Connect POS and CRM through SKUMS workspace key',
    body_md: '## AGENT RULES\n1. POS holds only SKUMS key\n2. CRM linked on SKUMS HQ',
    category: 'operations',
    primary_path: '/integrations',
    related_paths: [],
    intent_tags: [
      'crm',
      'pos',
      'skums',
      'setup',
      'loyalty',
      'workspace key',
      'live demo',
      'connect',
    ],
    sort_order: 54,
  },
]

describe('help resolve matcher', () => {
  test('tokenizes query', () => {
    const t = tokenizeHelpQuery('Where should I go to edit the products?')
    assert.ok(t.includes('edit'))
    assert.ok(t.includes('products'))
    assert.ok(!t.includes('where') || t.includes('edit'))
  })

  test('edit products question ranks edit-products first', () => {
    const r = rankHelpArticles(seedArticles, 'where should i go to edit the products')
    assert.ok(r.matches.length >= 1)
    assert.equal(r.matches[0].slug, 'edit-products')
    assert.equal(r.matches[0].primary_path, '/products')
    assert.equal(r.matches[0].help_path, '/help/edit-products')
    assert.ok(r.matches[0].steps_preview?.length >= 1)
  })

  test('import csv question ranks import', () => {
    const r = rankHelpArticles(seedArticles, 'how do I upload a supplier csv')
    assert.equal(r.matches[0].slug, 'import-catalog')
  })

  test('approve draft ranks actions', () => {
    const r = rankHelpArticles(seedArticles, 'how do I approve a draft PO from MCP')
    assert.equal(r.matches[0].slug, 'actions-inbox')
  })

  test('store replenishment ranks store-ops-replenishment', () => {
    const r = rankHelpArticles(seedArticles, 'how do I approve a store replenishment request')
    assert.ok(r.matches.length >= 1)
    assert.equal(r.matches[0].slug, 'store-ops-replenishment')
  })

  test('operator runbook ranks for operate query', () => {
    const r = rankHelpArticles(seedArticles, 'how do we operate store ops loft waves')
    assert.ok(r.matches.some((m) => m.slug === 'operator-runbook' || m.slug === 'store-ops-replenishment'))
  })

  test('PO status / FOB / in transit ranks po-transfer-lifecycle', () => {
    const r = rankHelpArticles(seedArticles, 'what statuses does a purchase order have and when is fob in transit')
    assert.ok(r.matches.length >= 1)
    assert.equal(r.matches[0].slug, 'po-transfer-lifecycle')
  })

  test('help migration 072 seeds po-transfer-lifecycle', () => {
    const mig072 = readFileSync(new URL('../core/db/072_help_po_transfer_lifecycle.sql', import.meta.url), 'utf8')
    assert.match(mig072, /po-transfer-lifecycle/)
    assert.match(mig072, /AGENT RULES/)
    assert.match(mig072, /2026-07-24/)
    assert.match(mig072, /on conflict \(slug\) do update/)
  })

  test('POS CRM SKUMS setup ranks crm-pos-skums-setup', () => {
    const r = rankHelpArticles(seedArticles, 'how do I connect POS to CRM with SKUMS workspace key for live loyalty')
    assert.ok(r.matches.length >= 1)
    assert.equal(r.matches[0].slug, 'crm-pos-skums-setup')
  })

  test('help migration 074 seeds crm-pos-skums-setup', () => {
    const mig074 = readFileSync(new URL('../core/db/074_help_crm_pos_skums_setup.sql', import.meta.url), 'utf8')
    assert.match(mig074, /crm-pos-skums-setup/)
    assert.match(mig074, /AGENT RULES/)
    assert.match(mig074, /SKUMS workspace API key/)
    assert.match(mig074, /on conflict \(slug\) do update/)
  })

  test('weak query needs clarification', () => {
    const r = rankHelpArticles(seedArticles, 'zzz qq xx', { min_score: 2 })
    assert.equal(r.needs_clarification, true)
    assert.equal(r.matches.length, 0)
  })
})

describe('help wiring', () => {
  test('migration creates help_articles and seeds edit-products', () => {
    assert.match(migration, /create table if not exists public\.help_articles/)
    assert.match(migration, /edit-products/)
    assert.match(migration, /on conflict \(slug\) do update/)
  })

  test('assistant exposes resolve_help and get_help_article', () => {
    assert.match(tools, /name: 'resolve_help'/)
    assert.match(tools, /name: 'get_help_article'/)
    assert.match(tools, /list_help_articles/)
    assert.match(tools, /resolveHelp|getHelpArticleForAgent/)
    assert.match(prompt, /always call resolve_help/i)
    assert.match(prompt, /get_help_article/)
    assert.match(prompt, /Never invent routes/)
    assert.match(prompt, /po-transfer-lifecycle/)
    assert.match(prompt, /crm-pos-skums-setup/)
    assert.match(prompt, /2026-07-24/)
  })

  test('MCP instructions route setup to crm-pos-skums-setup', () => {
    const mcp = readFileSync(new URL('../mcp/src/agentInstructions.mjs', import.meta.url), 'utf8')
    assert.match(mcp, /crm-pos-skums-setup/)
    assert.match(mcp, /help_get slug=crm-pos-skums-setup|slug=\*\*crm-pos-skums-setup\*\*|slug \*\*crm-pos-skums-setup\*\*/)
  })

  test('sidebar and help page exist', () => {
    assert.match(sidebar, /href: '\/help'/)
    assert.match(helpIndex, /Help Center/)
  })
})
