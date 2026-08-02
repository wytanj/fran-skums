/**
 * Research notebook helpers (study_sessions + study_artifacts conventions).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  normalizeNotebookMetadata,
  researchDeepLink,
} from '../mcp/src/lib/study.mjs'
import { toolDefinitions } from '../mcp/src/tools.mjs'
import { TOOL_SCOPE_CATALOG } from '../mcp/src/toolScopes.mjs'

test('normalizeNotebookMetadata defaults crawl_intent to none', () => {
  const m = normalizeNotebookMetadata({})
  assert.equal(m.crawl_intent, 'none')
  assert.ok(Array.isArray(m.discovery))
})

test('normalizeNotebookMetadata folds discovery_url into discovery[]', () => {
  const m = normalizeNotebookMetadata({
    discovery_url: 'https://www.sephora.sg/products/olaplex-volumizing-blow-dry-mist/v/150ml',
    discovery_channel: 'sephora',
  })
  assert.equal(m.subject_kind, 'product')
  assert.equal(m.discovery.length, 1)
  assert.equal(m.discovery[0].channel, 'sephora')
  assert.match(m.discovery[0].url, /sephora/)
})

test('normalizeNotebookMetadata brand_key slug', () => {
  const m = normalizeNotebookMetadata({}, { brand_key: 'Olaplex Hair!', subject_kind: 'brand' })
  assert.equal(m.brand_key, 'olaplex-hair')
  assert.equal(m.subject_kind, 'brand')
})

test('researchDeepLink points at /research', () => {
  assert.equal(researchDeepLink('abc-123'), '/research/abc-123')
})

test('MCP exposes notebook tools with study:write', () => {
  for (const name of ['study_add_note', 'study_add_artifact', 'study_update']) {
    assert.ok(toolDefinitions.some((t) => t.name === name), `missing ${name}`)
    assert.equal(TOOL_SCOPE_CATALOG[name]?.scope, 'study:write')
  }
  const start = toolDefinitions.find((t) => t.name === 'study_start')
  assert.match(start.description, /Does NOT start Shopee|no crawl|notebook/i)
})

test('Research GUI and nav exist; Product Quality removed from sidebar', () => {
  const sidebar = readFileSync(new URL('../app/components/AppSidebar.vue', import.meta.url), 'utf8')
  assert.match(sidebar, /Research/)
  assert.match(sidebar, /\/research/)
  assert.doesNotMatch(sidebar, /name: 'Product Quality'/)
  assert.doesNotMatch(sidebar, /href: '\/product-quality'/)

  const index = readFileSync(new URL('../app/pages/research/index.vue', import.meta.url), 'utf8')
  const detail = readFileSync(new URL('../app/pages/research/[id].vue', import.meta.url), 'utf8')
  assert.match(index, /New notebook/)
  assert.match(detail, /Add note/)
  assert.match(detail, /crawl/)
})

test('API artifact + patch routes exist', () => {
  const art = readFileSync(
    new URL('../server/api/v1/study/sessions/[id]/artifacts.post.ts', import.meta.url),
    'utf8',
  )
  const patch = readFileSync(
    new URL('../server/api/v1/study/sessions/[id].patch.ts', import.meta.url),
    'utf8',
  )
  assert.match(art, /addStudyArtifact/)
  assert.match(patch, /updateStudySession/)
})
