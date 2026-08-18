/**
 * Rostering moved to Fran HRM — SKUMS must not expose it.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { toolDefinitions } from '../mcp/src/tools.mjs'
import { TOOL_SCOPE_CATALOG } from '../mcp/src/toolScopes.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const GONE = [
  'roster_list_zones',
  'roster_list_employees',
  'roster_upsert_employee',
  'roster_import_rippling',
  'roster_list_shifts',
  'roster_upsert_shift',
  'roster_cancel_shift',
  'roster_board',
  'roster_my_assignment',
]

test('MCP has no roster tools', () => {
  const names = toolDefinitions.map((t) => t.name)
  for (const n of GONE) {
    assert.ok(!names.includes(n), `SKUMS MCP still exposes ${n}`)
    assert.ok(!TOOL_SCOPE_CATALOG[n], `scope catalog still has ${n}`)
  }
})

test('SKUMS roster UI and write APIs are gone', () => {
  const sidebar = readFileSync(join(root, 'app/components/AppSidebar.vue'), 'utf8')
  assert.ok(!sidebar.includes("to: '/roster'"), 'sidebar still links /roster')
  assert.equal(existsSync(join(root, 'app/pages/roster/index.vue')), false)
  assert.equal(existsSync(join(root, 'app/composables/useRoster.ts')), false)
  assert.equal(existsSync(join(root, 'mcp/src/lib/roster.mjs')), false)
  assert.equal(existsSync(join(root, 'server/utils/roster.ts')), false)
  assert.equal(existsSync(join(root, 'server/api/v1/roster/board.get.ts')), false)
  assert.equal(existsSync(join(root, 'scripts/_seed_roster_sample.mjs')), false)
})

test('POS roster routes return moved-to-HRM', () => {
  const me = readFileSync(join(root, 'server/api/v1/pos/roster/me.get.ts'), 'utf8')
  const board = readFileSync(join(root, 'server/api/v1/pos/roster/board.get.ts'), 'utf8')
  assert.match(me, /410/)
  assert.match(me, /rosterGone|roster_moved|rosterMoved/)
  assert.match(board, /410/)
})

test('mig 080 tables remain as unused history', () => {
  const sql = readFileSync(join(root, 'core/db/080_rostering.sql'), 'utf8')
  assert.match(sql, /roster_zones/)
  assert.match(sql, /roster_employees/)
})
