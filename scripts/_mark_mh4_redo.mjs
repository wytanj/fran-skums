/**
 * Mark brands that need a deeper MH-4 pass (platform category on PDPs).
 * Writes .mh4-redo.json — does not change harvest state.
 *
 *   node scripts/_mark_mh4_redo.mjs [--target 40]
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultCycleStatePath, loadCycleState } from '../marketplace/mallCycleState.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUT = resolve(ROOT, '.mh4-redo.json')

let target = 40
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--target') target = Math.max(Number(argv[++i]) || 40, 1)
}

const state = loadCycleState(defaultCycleStatePath(ROOT))
const redo = []
const ok = []

for (const [brand, st] of Object.entries(state.brands || {}).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (!st?.list_ok || !(st.list_products > 0)) continue
  const mh4 = Number(st.mh4_count) || 0
  const row = {
    brand_key: brand,
    list_products: st.list_products,
    mh4_count: mh4,
    mh4_ok: st.mh4_ok ?? null,
    shop_username: st.shop_username || null,
    reason:
      mh4 <= 0
        ? 'no_mh4'
        : mh4 < target
          ? `mh4_below_target_${mh4}_lt_${target}`
          : null,
  }
  if (row.reason) redo.push(row)
  else ok.push(row)
}

const payload = {
  updated_at: new Date().toISOString(),
  target_mh4: target,
  redo_count: redo.length,
  ok_count: ok.length,
  redo,
  note: 'List harvest can stay; re-run mall-brand-cycle with higher --mh4-top (and clear mh4 flags or force) later.',
}

writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8')
console.log(`wrote ${OUT}`)
console.log(`target=${target} redo=${redo.length} ok=${ok.length}`)
for (const r of redo) {
  console.log(`  ${r.brand_key} list=${r.list_products} mh4=${r.mh4_count} (${r.reason})`)
}
