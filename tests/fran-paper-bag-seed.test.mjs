import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(new URL('../core/db/088_fran_paper_bag.sql', import.meta.url), 'utf8')
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')

test('088 seeds FRANBAG as a zero-price non-stock paper bag', () => {
  assert.match(sql, /'FRANBAG'/)
  assert.match(sql, /'Paper Bag'/)
  assert.match(sql, /0\.00/)
  assert.match(sql, /track_inventory,\s*\n\s*status/s)
  assert.match(sql, /false,\s*\n\s*'active'/s)
  assert.match(sql, /'fran_reward_eligible', false/)
  assert.match(sql, /'fran_reward_exclusion_reason', 'non_stock'/)
  assert.match(sql, /'fran_sample_eligible', false/)
  assert.match(sql, /'pos_enabled', true/)
  assert.match(sql, /lower\(existing\.sku\) = 'franbag'/)
  assert.match(sql, /ensure_fran_paper_bag\(w\.id\)/)
  assert.match(sql, /after insert on public\.workspaces/)
  assert.doesNotMatch(sql, /inventory_levels/)
  assert.doesNotMatch(sql, /upsert_inventory_level/)
  assert.doesNotMatch(sql, /stock_quantity/)
  assert.match(migrationsDoc, /088 \| fran_paper_bag\.sql/)
})
