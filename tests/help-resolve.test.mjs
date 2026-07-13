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

  test('assistant exposes resolve_help', () => {
    assert.match(tools, /name: 'resolve_help'/)
    assert.match(tools, /list_help_articles/)
    assert.match(tools, /resolveHelp/)
    assert.match(prompt, /always call resolve_help/)
    assert.match(prompt, /Never invent routes/)
  })

  test('sidebar and help page exist', () => {
    assert.match(sidebar, /href: '\/help'/)
    assert.match(helpIndex, /Help Center/)
  })
})
