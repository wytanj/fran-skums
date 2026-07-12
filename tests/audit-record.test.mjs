import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  channelToSourceType,
  defaultNextActions,
  mutationEnvelope,
  recordAudit,
} from '../core/audit/record.mjs'

describe('audit record (M1)', () => {
  test('channelToSourceType maps known channels', () => {
    assert.equal(channelToSourceType('mcp'), 'mcp')
    assert.equal(channelToSourceType('ui'), 'ui')
    assert.equal(channelToSourceType('api'), 'api')
    assert.equal(channelToSourceType('nope'), 'system')
  })

  test('mutationEnvelope marks draft statuses', () => {
    const e = mutationEnvelope({
      object_type: 'internal_purchase_orders',
      id: 'abc',
      status: 'draft',
      channel: 'mcp',
      next_allowed_actions: ['po_submit'],
    })
    assert.equal(e.is_draft, true)
    assert.equal(e.channel, 'mcp')
    assert.deepEqual(e.next_allowed_actions, ['po_submit'])
  })

  test('defaultNextActions for draft PO', () => {
    const actions = defaultNextActions('internal_purchase_orders', 'draft')
    assert.ok(actions.includes('po_update_draft'))
    assert.ok(actions.includes('po_submit'))
  })

  test('recordAudit inserts via mock client with source_type mcp', async () => {
    /** @type {Record<string, unknown>[]} */
    const inserted = []
    const db = {
      from(table) {
        assert.equal(table, 'audit_events')
        return {
          insert(row) {
            inserted.push(row)
            return {
              select() {
                return {
                  maybeSingle: async () => ({ data: { id: 'audit-1' }, error: null }),
                }
              },
            }
          },
        }
      },
    }

    const result = await recordAudit(db, {
      workspace_id: 'ws-1',
      entity_type: 'internal_purchase_orders',
      entity_id: 'po-1',
      event_type: 'mcp.po_create_draft',
      operation: 'INSERT',
      channel: 'mcp',
      actor_user_id: null,
      actor_kind: 'agent',
      client_name: 'cursor',
      tool_name: 'po_create_draft',
      request_id: 'req-1',
      after_data: { id: 'po-1', status: 'draft' },
    })

    assert.equal(result.ok, true)
    assert.equal(inserted.length, 1)
    assert.equal(inserted[0].source_type, 'mcp')
    assert.equal(inserted[0].metadata.tool_name, 'po_create_draft')
    assert.equal(inserted[0].metadata.channel, 'mcp')
    assert.equal(inserted[0].metadata.client_name, 'cursor')
  })

  test('recordAudit ui channel', async () => {
    /** @type {Record<string, unknown>[]} */
    const inserted = []
    const db = {
      from() {
        return {
          insert(row) {
            inserted.push(row)
            return {
              select() {
                return {
                  maybeSingle: async () => ({ data: { id: 'a2' }, error: null }),
                }
              },
            }
          },
        }
      },
    }

    await recordAudit(db, {
      workspace_id: 'ws-1',
      entity_type: 'products',
      entity_id: 'p1',
      operation: 'INSERT',
      channel: 'ui',
      actor_user_id: 'user-1',
      actor_kind: 'user',
      client_name: 'fran-web',
    })

    assert.equal(inserted[0].source_type, 'ui')
    assert.equal(inserted[0].actor_user_id, 'user-1')
  })

  test('migration expands source_type check', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync(new URL('../core/db/052_audit_source_channels.sql', import.meta.url), 'utf8')
    assert.match(sql, /'mcp'/)
    assert.match(sql, /'ui'/)
    assert.match(sql, /'assistant'/)
    assert.match(sql, /'worker'/)
  })
})
