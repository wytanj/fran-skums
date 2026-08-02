/**
 * Rostering schema + MCP tools + GUI surface
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { toolDefinitions } from '../mcp/src/tools.mjs'
import { TOOL_SCOPE_CATALOG } from '../mcp/src/toolScopes.mjs'
import { MCP_SCOPE_PROFILES } from '../mcp/src/context.mjs'

const EXPECTED = [
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

test('MCP exposes roster tools with correct scopes', () => {
  const names = toolDefinitions.map((t) => t.name)
  for (const n of EXPECTED) {
    assert.ok(names.includes(n), `missing ${n}`)
    assert.ok(TOOL_SCOPE_CATALOG[n], `scope catalog missing ${n}`)
  }
  assert.equal(TOOL_SCOPE_CATALOG.roster_board.scope, 'roster:read')
  assert.equal(TOOL_SCOPE_CATALOG.roster_upsert_shift.scope, 'roster:write')
  assert.equal(TOOL_SCOPE_CATALOG.roster_import_rippling.scope, 'roster:write')
  assert.ok(MCP_SCOPE_PROFILES.safe.includes('roster:read'))
})

test('migration defines zones employees shifts', () => {
  const sql = readFileSync(new URL('../core/db/080_rostering.sql', import.meta.url), 'utf8')
  assert.match(sql, /roster_zones/)
  assert.match(sql, /roster_employees/)
  assert.match(sql, /roster_shifts/)
  assert.match(sql, /zone_1/)
  assert.match(sql, /cashier/)
  assert.match(sql, /back_of_house/)
  assert.match(sql, /source_provider/)
  assert.match(sql, /rippling/)
  assert.match(sql, /pos_staff_ref/)
  assert.match(sql, /starts_at/)
  assert.match(sql, /seed_default_roster_zones/)
})

test('API and POS facade routes exist', () => {
  const board = readFileSync(
    new URL('../server/api/v1/roster/board.get.ts', import.meta.url),
    'utf8',
  )
  const me = readFileSync(new URL('../server/api/v1/pos/roster/me.get.ts', import.meta.url), 'utf8')
  const fran = readFileSync(
    new URL('../server/routes/fran/pos/roster/me.get.ts', import.meta.url),
    'utf8',
  )
  assert.match(board, /getBoard/)
  assert.match(me, /getMyAssignment/)
  assert.match(fran, /pos\/roster\/me/)
})

test('Roster nav and page exist', () => {
  const sidebar = readFileSync(new URL('../app/components/AppSidebar.vue', import.meta.url), 'utf8')
  assert.match(sidebar, /Roster/)
  assert.match(sidebar, /\/roster/)
  const page = readFileSync(new URL('../app/pages/roster/index.vue', import.meta.url), 'utf8')
  assert.match(page, /Schedule shift/)
  assert.match(page, /Add employee/)
})

test('seed script covers 9 people and 5 zones', () => {
  const seed = readFileSync(new URL('../scripts/_seed_roster_sample.mjs', import.meta.url), 'utf8')
  assert.match(seed, /Aisyah Rahman/)
  assert.match(seed, /Hana Kim/)
  assert.match(seed, /demo-staff-aisyah/)
  assert.match(seed, /back_of_house/)
  assert.match(seed, /cashier/)
})
