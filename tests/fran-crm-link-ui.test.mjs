/**
 * M4: HQ Fran CRM link UI + session API wiring
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const linkGet = readFileSync(
  new URL('../server/api/integrations/fran-crm/link.get.ts', import.meta.url),
  'utf8',
)
const linkPut = readFileSync(
  new URL('../server/api/integrations/fran-crm/link.put.ts', import.meta.url),
  'utf8',
)
const testPost = readFileSync(
  new URL('../server/api/integrations/fran-crm/test.post.ts', import.meta.url),
  'utf8',
)
const integrationsPage = readFileSync(
  new URL('../app/pages/integrations.vue', import.meta.url),
  'utf8',
)
const arch = readFileSync(
  new URL('../docs/POS_CRM_SKUMS_CONNECTION_ARCHITECTURE.md', import.meta.url),
  'utf8',
)

describe('M4 fran-crm link session API', () => {
  test('get/put/test use session auth', () => {
    assert.match(linkGet, /serverSupabaseUser/)
    assert.match(linkGet, /resolveCrmLink/)
    assert.match(linkGet, /has_service_token/)
    assert.match(linkGet, /never return service_token/)
    assert.match(linkPut, /Owner or admin/)
    assert.match(linkPut, /workspace_crm_links/)
    assert.match(testPost, /proxyLoyaltyToCrm/)
  })

  test('integrations page has Fran CRM loyalty card', () => {
    assert.match(integrationsPage, /Fran CRM \(POS loyalty\)/)
    assert.match(integrationsPage, /loadCrmLink/)
    assert.match(integrationsPage, /saveCrmLink/)
    assert.match(integrationsPage, /testCrmLink/)
    assert.match(integrationsPage, /\/api\/integrations\/fran-crm\/link/)
  })

  test('architecture marks M4', () => {
    assert.match(arch, /M4/)
    assert.match(arch, /HQ CRM-link UI/)
  })
})
