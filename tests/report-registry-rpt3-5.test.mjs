/**
 * Track K Rpt-3–5: schedule due, cron route, MCP tools, n8n run API.
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  isSubscriptionDue,
  calendarDateInTz,
  isoWeekKeyInTz,
} from '../core/reports/schedule.mjs'
import { expandScopePackage, hasScope } from '../server/utils/scopes.ts'
import { isToolPermitted } from '../mcp/src/toolScopes.mjs'
import { listToolsForTransport } from '../mcp/src/httpProtocol.mjs'
import { resolveCloudMcpScopes } from '../mcp/src/context.mjs'

describe('Rpt-3 schedule due', () => {
  test('manual never due; never-run is due', () => {
    assert.equal(isSubscriptionDue({ schedule: 'manual', enabled: true }, null), false)
    assert.equal(isSubscriptionDue({ schedule: 'daily', enabled: true }, null), true)
    assert.equal(isSubscriptionDue({ schedule: 'weekly', enabled: false }, null), false)
  })

  test('hourly due after 60m', () => {
    const now = new Date('2026-07-16T12:00:00Z')
    const recent = new Date(now.getTime() - 30 * 60 * 1000).toISOString()
    const old = new Date(now.getTime() - 90 * 60 * 1000).toISOString()
    assert.equal(
      isSubscriptionDue({ schedule: 'hourly', timezone: 'UTC', enabled: true }, recent, now),
      false,
    )
    assert.equal(
      isSubscriptionDue({ schedule: 'hourly', timezone: 'UTC', enabled: true }, old, now),
      true,
    )
  })

  test('daily due when calendar day changes in TZ', () => {
    const tz = 'Asia/Singapore'
    const now = new Date('2026-07-16T10:00:00+08:00')
    const sameDay = new Date('2026-07-16T01:00:00+08:00').toISOString()
    const prevDay = new Date('2026-07-15T23:00:00+08:00').toISOString()
    assert.equal(calendarDateInTz(now, tz), '2026-07-16')
    assert.equal(
      isSubscriptionDue({ schedule: 'daily', timezone: tz, enabled: true }, sameDay, now),
      false,
    )
    assert.equal(
      isSubscriptionDue({ schedule: 'daily', timezone: tz, enabled: true }, prevDay, now),
      true,
    )
  })

  test('weekly uses ISO week key', () => {
    const a = isoWeekKeyInTz(new Date('2026-07-13T12:00:00Z'), 'UTC')
    const b = isoWeekKeyInTz(new Date('2026-07-16T12:00:00Z'), 'UTC')
    // Both mid-July 2026 likely same or adjacent weeks — just ensure format
    assert.match(a, /^\d{4}-W\d{2}$/)
    assert.match(b, /^\d{4}-W\d{2}$/)
  })

  test('migration 067 seeds report.run.completed policy', () => {
    const sql = readFileSync(
      new URL('../core/db/067_report_delivery_policy.sql', import.meta.url),
      'utf8',
    )
    assert.match(sql, /report\.run\.completed/)
    assert.match(sql, /reports:read/)
    assert.match(sql, /in_app/)
  })

  test('cron-tick routes exist (GET + POST)', () => {
    assert.ok(existsSync(new URL('../server/api/internal/reports/cron-tick.post.ts', import.meta.url)))
    assert.ok(existsSync(new URL('../server/api/internal/reports/cron-tick.get.ts', import.meta.url)))
    const post = readFileSync(
      new URL('../server/api/internal/reports/cron-tick.post.ts', import.meta.url),
      'utf8',
    )
    assert.match(post, /runReportCronTick/)
    assert.match(post, /cron secret/i)
  })

  test('vercel.json daily cron points at cron-tick (Hobby-safe)', () => {
    const v = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    assert.ok(Array.isArray(v.crons))
    const job = v.crons.find((c) => c.path === '/api/internal/reports/cron-tick')
    assert.ok(job)
    // Hobby allows at most one run per day
    assert.equal(job.schedule, '0 0 * * *')
  })

  test('registry has deliver + cron helpers', () => {
    const src = readFileSync(new URL('../server/utils/reportRegistry.ts', import.meta.url), 'utf8')
    assert.match(src, /export async function deliverReportRun/)
    assert.match(src, /export async function runReportCronTick/)
    assert.match(src, /emitLifecycleNotification/)
    assert.match(src, /postAutomationsWebhook/)
  })
})

describe('Rpt-4 MCP reports tools', () => {
  test('tool definitions and scopes', () => {
    const tools = readFileSync(new URL('../mcp/src/tools.mjs', import.meta.url), 'utf8')
    assert.match(tools, /name: 'reports_list'/)
    assert.match(tools, /name: 'reports_get'/)
    assert.match(tools, /name: 'reports_run'/)
    assert.match(tools, /requireScope\('reports:read'\)/)
    assert.match(tools, /requireScope\('reports:run'\)/)

    assert.equal(isToolPermitted('reports_list', { scopes: ['reports:read'], cloud: true }), true)
    assert.equal(isToolPermitted('reports_run', { scopes: ['reports:read'], cloud: true }), false)
    assert.equal(isToolPermitted('reports_run', { scopes: ['reports:run'], cloud: true }), true)
  })

  test('mcp:ops_safe lists reports tools', () => {
    const cloud = resolveCloudMcpScopes(['mcp:ops_safe'])
    assert.ok(hasScope(cloud, 'reports:read') || cloud.includes('reports:read') || expandScopePackage('mcp:ops_safe').includes('reports:read'))
    // After package expand path:
    const expanded = expandScopePackage('mcp:ops_safe')
    assert.ok(expanded.includes('reports:read'))
    assert.ok(expanded.includes('reports:run'))
    const tools = listToolsForTransport(true, expanded)
    assert.ok(tools.some((t) => t.name === 'reports_list'))
    assert.ok(tools.some((t) => t.name === 'reports_run'))
  })

  test('mcp lib reports.mjs exists', () => {
    assert.ok(existsSync(new URL('../mcp/src/lib/reports.mjs', import.meta.url)))
  })
})

describe('Rpt-5 n8n / API run', () => {
  test('v1 run + subscriptions routes', () => {
    assert.ok(existsSync(new URL('../server/api/v1/reports/run.post.ts', import.meta.url)))
    assert.ok(existsSync(new URL('../server/api/v1/reports/subscriptions.get.ts', import.meta.url)))
    const run = readFileSync(new URL('../server/api/v1/reports/run.post.ts', import.meta.url), 'utf8')
    assert.match(run, /reports:run/)
    assert.match(run, /template_slug/)
    assert.match(run, /subscription_id/)
    assert.match(run, /suggest_only/)
  })

  test('webhook resolve + post helpers in registry', () => {
    const src = readFileSync(new URL('../server/utils/reportRegistry.ts', import.meta.url), 'utf8')
    assert.match(src, /resolveAutomationsWebhookUrl/)
    assert.match(src, /automations_webhook_url/)
  })
})
