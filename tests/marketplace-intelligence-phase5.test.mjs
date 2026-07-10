import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  computeProjection,
  suggestOrderQty,
  suggestWeeklyUnitsFromSold,
} from '../intelligence/projection/engine.mjs'
import {
  canDecidePo,
  canSubmitPo,
  makePoNumber,
  recomputePoTotals,
} from '../intelligence/po/service.mjs'
import { toolDefinitions } from '../mcp/src/tools.mjs'

const mig049 = readFileSync(new URL('../core/db/049_internal_purchase_orders.sql', import.meta.url), 'utf8')
const mig050 = readFileSync(new URL('../core/db/050_projections.sql', import.meta.url), 'utf8')
const migIndex = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')
const poUtil = readFileSync(new URL('../server/utils/internalPo.ts', import.meta.url), 'utf8')
const projUtil = readFileSync(new URL('../server/utils/projections.ts', import.meta.url), 'utf8')
const poPost = readFileSync(new URL('../server/api/v1/purchase-orders/index.post.ts', import.meta.url), 'utf8')
const projPost = readFileSync(new URL('../server/api/v1/projections/index.post.ts', import.meta.url), 'utf8')
const fromPo = readFileSync(new URL('../server/api/v1/projections/from-po.post.ts', import.meta.url), 'utf8')
const major = readFileSync(new URL('../Major Update.md', import.meta.url), 'utf8')
const wsScript = readFileSync(new URL('../scripts/print-workspace-id.mjs', import.meta.url), 'utf8')
const mcpReadme = readFileSync(new URL('../mcp/README.md', import.meta.url), 'utf8')

test('migrations 049/050 registered and create tables', () => {
  assert.match(migIndex, /049\s+\|\s+internal_purchase_orders/)
  assert.match(migIndex, /050\s+\|\s+projections/)
  assert.match(mig049, /create table if not exists public\.internal_purchase_orders/)
  assert.match(mig049, /create table if not exists public\.internal_purchase_order_lines/)
  assert.match(mig050, /create table if not exists public\.projection_runs/)
  assert.match(mig050, /projection_assumption_defaults/)
})

test('projection engine computes contribution band', () => {
  const r = computeProjection({
    unit_cost: 10,
    retail_price: 30,
    units_per_week_low: 5,
    units_per_week_high: 10,
    horizon_weeks: 12,
    payment_fees_pct: 0.03,
    shipping_per_unit: 1,
    returns_pct: 0.05,
    quantity_on_order: 80,
    currency: 'SGD',
  })
  assert.equal(r.horizon_weeks, 12)
  assert.ok(r.revenue_high > r.revenue_low)
  assert.ok(r.contribution_high !== null)
  assert.ok(r.unit_economics.contribution_per_unit > 0)
  assert.ok(r.cash_tied_stock > 0)

  const w = suggestWeeklyUnitsFromSold([5200, 1100, 400])
  assert.ok(w.units_per_week_high >= w.units_per_week_low)
  assert.ok(suggestOrderQty(10, 8) >= 80)
})

test('PO totals and status guards', () => {
  const t = recomputePoTotals([
    { title: 'A', quantity: 10, unit_cost: 5 },
    { title: 'B', quantity: 2, unit_cost: 12.5 },
  ])
  assert.equal(t.line_count, 2)
  assert.equal(t.subtotal, 75)
  assert.equal(t.lines[0].line_total, 50)
  assert.equal(canSubmitPo('draft'), true)
  assert.equal(canSubmitPo('approved'), false)
  assert.equal(canDecidePo('pending_approval', 'approved'), true)
  assert.equal(canDecidePo('draft', 'approved'), false)
  assert.match(makePoNumber(), /^IPO-/)
})

test('MCP tools include PO and projection surface', () => {
  const names = toolDefinitions.map((t) => t.name)
  for (const n of [
    'po_create_draft',
    'po_submit',
    'po_decide',
    'po_export',
    'projection_create',
    'projection_from_po',
    'projection_from_study',
    'projection_export',
  ]) {
    assert.ok(names.includes(n), n)
  }
  assert.ok(names.length >= 30)
})

test('HTTP routes and services wired for phase 5', () => {
  assert.match(poUtil, /createInternalPoDraft/)
  assert.match(poUtil, /submitInternalPo/)
  assert.match(projUtil, /createProjection/)
  assert.match(projUtil, /projectFromPo/)
  assert.match(projUtil, /projectFromStudy/)
  assert.match(poPost, /po:draft/)
  assert.match(projPost, /projection:run/)
  assert.match(fromPo, /projectFromPo/)
  assert.match(wsScript, /FRAN_MCP_WORKSPACE_ID/)
  assert.match(wsScript, /create_workspace|onboarding/i)
  assert.match(mcpReadme, /FRAN_MCP_WORKSPACE_ID|po_create|projection/i)
  assert.match(major, /Phase 5/)
})
