/**
 * SKUMS CRM loyalty facade wiring (static source checks).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const root = new URL('..', import.meta.url)
const facade = readFileSync(new URL('../server/utils/crmLoyaltyFacade.ts', import.meta.url), 'utf8')
const mig = readFileSync(new URL('../core/db/073_workspace_crm_links.sql', import.meta.url), 'utf8')
const caps = readFileSync(new URL('../server/routes/fran/pos/capabilities.get.ts', import.meta.url), 'utf8')
const resolve = readFileSync(
  new URL('../server/routes/fran/pos/loyalty/member/resolve.post.ts', import.meta.url),
  'utf8',
)
const commit = readFileSync(
  new URL('../server/routes/fran/pos/loyalty/commit-sale.post.ts', import.meta.url),
  'utf8',
)
const arch = readFileSync(new URL('../docs/POS_CRM_SKUMS_CONNECTION_ARCHITECTURE.md', import.meta.url), 'utf8')

describe('workspace CRM links migration', () => {
  test('creates workspace_crm_links', () => {
    assert.match(mig, /create table if not exists public\.workspace_crm_links/i)
    assert.match(mig, /crm_base_url/)
    assert.match(mig, /service_token/)
    assert.match(mig, /service_role/)
  })
})

describe('loyalty facade', () => {
  test('resolves link and proxies with x-pos-client', () => {
    assert.match(facade, /resolveCrmLink/)
    assert.match(facade, /proxyLoyaltyToCrm/)
    assert.match(facade, /buildPosCapabilities/)
    assert.match(facade, /x-pos-client/)
    assert.match(facade, /loyalty_not_configured/)
    assert.match(facade, /FRAN_CRM_BASE_URL/)
  })

  test('POS routes exist for capabilities + loyalty', () => {
    assert.match(caps, /pos:read/)
    assert.match(caps, /buildPosCapabilities/)
    assert.match(resolve, /member\/resolve/)
    assert.match(commit, /pos:write/)
    assert.match(commit, /commit-sale/)
  })

  test('architecture doc describes skums facade', () => {
    assert.match(arch, /pos_connector/)
    assert.match(arch, /loyalty facade/i)
    assert.match(arch, /depend on POS or CRM/i)
    assert.match(arch, /workspace_crm_links|fran\/pos\/loyalty/)
  })
})
