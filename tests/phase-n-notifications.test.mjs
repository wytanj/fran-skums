/**
 * Phase N — stakeholder notification bus (schema + pure helpers + wiring).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// notifications.ts is TS — exercise pure helpers via source contracts + re-export path when built.
// Unit-test pure key/template logic inlined from the design (mirror of server/utils/notifications.ts).

function deliveryIdempotencyKey(root, channel, recipient) {
  const safeRoot = String(root || '').replace(/\s+/g, '')
  const safeRecipient = String(recipient || '').replace(/\s+/g, '')
  return `${safeRoot}:${channel}:${safeRecipient}`.slice(0, 240)
}

function renderDeepLink(template, entityId, explicit) {
  if (explicit) return explicit
  if (!template) return null
  return template.replace(/\{entity_id\}/g, entityId)
}

function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key]
    return v == null ? '' : String(v)
  })
}

describe('Phase N notifications', () => {
  test('migration 064 defines policies, deliveries, settings + store-ops defaults', () => {
    const sql = readFileSync(new URL('../core/db/064_notification_bus.sql', import.meta.url), 'utf8')
    assert.match(sql, /workspace_notification_settings/)
    assert.match(sql, /notification_policies/)
    assert.match(sql, /notification_deliveries/)
    assert.match(sql, /idempotency_key/)
    assert.match(sql, /store_ops\.request\.submitted/)
    assert.match(sql, /store_ops\.request\.decided/)
    assert.match(sql, /store_ops\.exception\.opened/)
    assert.match(sql, /store_ops\.exception\.verified/)
    assert.match(sql, /po\.submitted/)
    assert.match(sql, /in_app/)
    assert.match(sql, /slack/)
  })

  test('idempotency key is stable and channel-scoped', () => {
    const a = deliveryIdempotencyKey('store_ops.request.submitted:abc', 'in_app', 'scope:store_ops:approve')
    const b = deliveryIdempotencyKey('store_ops.request.submitted:abc', 'in_app', 'scope:store_ops:approve')
    const c = deliveryIdempotencyKey('store_ops.request.submitted:abc', 'slack', 'workspace_slack')
    assert.equal(a, b)
    assert.notEqual(a, c)
    assert.match(a, /^store_ops\.request\.submitted:abc:in_app:/)
  })

  test('deep link template renders entity id; explicit wins', () => {
    assert.equal(
      renderDeepLink('/store-ops?tab=queue&request={entity_id}', 'req-1', null),
      '/store-ops?tab=queue&request=req-1',
    )
    assert.equal(
      renderDeepLink('/store-ops?tab=queue&request={entity_id}', 'req-1', '/custom'),
      '/custom',
    )
    assert.equal(renderDeepLink(null, 'x', null), null)
  })

  test('template vars for subject/body', () => {
    const s = renderTemplate('Request {request_number} {status}', {
      request_number: 'SRR-1',
      status: 'approved',
    })
    assert.equal(s, 'Request SRR-1 approved')
  })

  test('notification bus util exports emitLifecycleNotification + helpers', () => {
    const src = readFileSync(new URL('../server/utils/notifications.ts', import.meta.url), 'utf8')
    assert.match(src, /export async function emitLifecycleNotification/)
    assert.match(src, /export function deliveryIdempotencyKey/)
    assert.match(src, /export async function expandRecipients/)
    assert.match(src, /notification\.requested/)
    assert.match(src, /notification\.delivered/)
    assert.match(src, /Never auto-email on MCP draft|never auto-email/i)
    // No agent send_email tool here
    assert.doesNotMatch(src, /send_email_to_arbitrary/)
  })

  test('store request submit routes through Phase N bus', () => {
    const orch = readFileSync(new URL('../server/utils/storeReplenishment.ts', import.meta.url), 'utf8')
    assert.match(orch, /emitLifecycleNotification/)
    assert.match(orch, /store_ops\.request\.submitted/)
    assert.match(orch, /store_ops\.request\.decided/)
    assert.match(orch, /notifyReplenishmentRequestDecided/)

    const api = readFileSync(new URL('../server/api/store-ops/requests.post.ts', import.meta.url), 'utf8')
    assert.match(api, /notifyReplenishmentRequestSubmitted/)
    assert.match(api, /requestedBy/)
  })

  test('receive exceptions emit store_ops.exception.opened', () => {
    const recv = readFileSync(new URL('../server/utils/storeReceive.ts', import.meta.url), 'utf8')
    assert.match(recv, /store_ops\.exception\.opened/)
    assert.match(recv, /store_ops\.exception\.verified/)
    assert.match(recv, /emitLifecycleNotification/)
  })

  test('inbox API filters by scope / user target', () => {
    const inbox = readFileSync(new URL('../server/api/store-ops/inbox.get.ts', import.meta.url), 'utf8')
    assert.match(inbox, /target_scope/)
    assert.match(inbox, /user:\$\{userId\}|user:\$\{/)
    assert.match(inbox, /unread_count/)
  })

  test('store-ops UI has Inbox tab and deep-link handling', () => {
    const page = readFileSync(new URL('../app/pages/store-ops/index.vue', import.meta.url), 'utf8')
    assert.match(page, /activeTab === 'inbox'/)
    assert.match(page, /loadInbox/)
    assert.match(page, /applyDeepLinkFromQuery/)
    assert.match(page, /HQ notification inbox/)
  })

  test('MCP safe tools still have no send_email', () => {
    const tools = readFileSync(new URL('../mcp/src/tools.mjs', import.meta.url), 'utf8')
    assert.doesNotMatch(tools, /name:\s*['"]send_email['"]/)
    assert.doesNotMatch(tools, /name:\s*['"]notify_email['"]/)
  })
})
