/**
 * Track K — agentic report registry (Rpt-0 scopes, Rpt-1 schema/API, Rpt-2 seeds).
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  SCOPE_PACKAGES,
  REPORT_SCOPES,
  expandScopePackage,
  hasScope,
  permissionsMapToScopes,
} from '../server/utils/scopes.ts'
import { runStubSections } from '../server/utils/reportRegistry.ts'

const root = new URL('..', import.meta.url)

describe('Rpt-0 report scopes', () => {
  test('REPORT_SCOPES catalog lists reports:* and automations:*', () => {
    for (const s of [
      'reports:read',
      'reports:run',
      'reports:write',
      'reports:admin',
      'automations:webhook',
      'automations:inbound',
    ]) {
      assert.ok(REPORT_SCOPES.includes(s), `missing ${s}`)
    }
  })

  test('packages map: viewer read; member run; ops_safe write', () => {
    const viewer = expandScopePackage('mcp:viewer')
    assert.ok(hasScope(viewer, 'reports:read'))
    assert.equal(hasScope(viewer, 'reports:run'), false)
    assert.equal(hasScope(viewer, 'reports:write'), false)

    const member = expandScopePackage('mcp:member')
    assert.ok(hasScope(member, 'reports:read'))
    assert.ok(hasScope(member, 'reports:run'))
    assert.equal(hasScope(member, 'reports:write'), false)

    const ops = expandScopePackage('mcp:ops_safe')
    assert.ok(hasScope(ops, 'reports:write'))
    assert.ok(hasScope(ops, 'reports:run'))

    const inv = SCOPE_PACKAGES.inventory_ops
    assert.ok(hasScope(inv, 'reports:write'))
  })

  test('permissionsMapToScopes maps reports + automations areas', () => {
    const scopes = permissionsMapToScopes({
      reports: { read: true, run: true, write: true, admin: false },
      automations: { webhook: true, inbound: false },
    })
    assert.ok(scopes.has('reports:read'))
    assert.ok(scopes.has('reports:run'))
    assert.ok(scopes.has('reports:write'))
    assert.equal(scopes.has('reports:admin'), false)
    assert.ok(scopes.has('automations:webhook'))
    assert.equal(scopes.has('automations:inbound'), false)
  })
})

describe('Rpt-1 schema + API + UI', () => {
  test('migration 066 defines tables and permission areas', () => {
    const sql = readFileSync(new URL('../core/db/066_report_registry.sql', import.meta.url), 'utf8')
    assert.match(sql, /report_templates/)
    assert.match(sql, /report_subscriptions/)
    assert.match(sql, /report_runs/)
    assert.match(sql, /reports.*read/)
    assert.match(sql, /automations/)
    assert.match(sql, /enabled/)
  })

  test('API routes and registry util exist', () => {
    assert.ok(existsSync(new URL('../server/utils/reportRegistry.ts', import.meta.url)))
    assert.ok(existsSync(new URL('../server/api/reports/subscriptions.get.ts', import.meta.url)))
    assert.ok(existsSync(new URL('../server/api/reports/subscriptions/[id].patch.ts', import.meta.url)))
    assert.ok(existsSync(new URL('../server/api/reports/subscriptions/[id]/run.post.ts', import.meta.url)))
    assert.ok(existsSync(new URL('../app/pages/reports/index.vue', import.meta.url)))
    assert.ok(existsSync(new URL('../app/composables/useReports.ts', import.meta.url)))

    const list = readFileSync(new URL('../server/api/reports/subscriptions.get.ts', import.meta.url), 'utf8')
    assert.match(list, /reports:read/)
    const patch = readFileSync(
      new URL('../server/api/reports/subscriptions/[id].patch.ts', import.meta.url),
      'utf8',
    )
    assert.match(patch, /reports:write/)
    const run = readFileSync(
      new URL('../server/api/reports/subscriptions/[id]/run.post.ts', import.meta.url),
      'utf8',
    )
    assert.match(run, /reports:run/)
  })

  test('sidebar links to /reports', () => {
    const side = readFileSync(new URL('../app/components/AppSidebar.vue', import.meta.url), 'utf8')
    assert.match(side, /\/reports/)
    assert.match(side, /Reports/)
  })
})

describe('Rpt-2 seed packs', () => {
  test('three platform seed slugs in migration', () => {
    const sql = readFileSync(new URL('../core/db/066_report_registry.sql', import.meta.url), 'utf8')
    assert.match(sql, /marketing-weekly/)
    assert.match(sql, /warehouse-weekly-baseline/)
    assert.match(sql, /finance-stock-rewards/)
  })

  test('stub section runner is suggest-only', () => {
    const r = runStubSections(['sales.top_movers', 'ops.open_queues'])
    assert.equal(r.sections.length, 2)
    assert.ok(r.markdown.includes('Suggest'))
    assert.ok(r.sections.every((s) => s.status === 'stub'))
  })
})
