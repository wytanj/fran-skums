#!/usr/bin/env node
/**
 * Seed sample roster: 5 zones + 9 employees + today's hourly shifts.
 *
 * Prefers direct Postgres (SUPABASE_DB_URL) so PostgREST schema-cache lag
 * cannot block seeding right after migration 080.
 *
 * Usage:
 *   node scripts/_seed_roster_sample.mjs [--workspace <uuid>] [--dry-run]
 *
 * Default workspace: FRAN_MCP_WORKSPACE_ID or demo c21c057f-…
 */
import { readFileSync, existsSync } from 'node:fs'
import postgres from 'postgres'

function loadEnv(p) {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]] !== undefined) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    process.env[m[1]] = v
  }
}
loadEnv('.env')
loadEnv('.env.local')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const wi = args.indexOf('--workspace')
const WS =
  (wi >= 0 ? args[wi + 1] : null) ||
  process.env.FRAN_MCP_WORKSPACE_ID ||
  'c21c057f-ea01-4e19-bc79-fafcf2626b19'

if (!process.env.SUPABASE_DB_URL) {
  console.error('Need SUPABASE_DB_URL')
  process.exit(1)
}

const sql = postgres(process.env.SUPABASE_DB_URL, { ssl: 'require', max: 1 })
const todaySgt = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })

// name, email, role, source, external_id, pos_staff_ref, zone, start_hour SGT, duration_h
const PEOPLE = [
  ['Tiffany', 'tiffany@fran.demo', 'cashier', 'manual', null, 'demo-staff-tiffany', 'cashier', 10, 6],
  ['Jarrell', 'jarrell@fran.demo', 'manager', 'manual', null, 'demo-staff-jarrell', 'zone_1', 9, 8],
  ['Jazelle', 'jazelle@fran.demo', 'associate', 'rippling', 'rippling-worker-1001', 'demo-staff-jazelle', 'zone_1', 11, 5],
  ['Jeremy', 'jeremy@fran.demo', 'associate', 'rippling', 'rippling-worker-1002', 'demo-staff-jeremy', 'zone_2', 10, 6],
  ['Fern', 'fern@fran.demo', 'associate', 'rippling', 'rippling-worker-1003', 'demo-staff-fern', 'zone_2', 12, 4],
  ['Kristle', 'kristle@fran.demo', 'associate', 'manual', null, 'demo-staff-kristle', 'zone_3', 10, 5],
  ['MJ', 'mj@fran.demo', 'associate', 'rippling', 'rippling-worker-1004', 'demo-staff-mj', 'zone_3', 14, 4],
  ['Soobin', 'soobin@fran.demo', 'stock', 'manual', null, 'demo-staff-soobin', 'back_of_house', 8, 8],
  ['Hiok', 'hiok@fran.demo', 'cashier', 'rippling', 'rippling-worker-1005', 'demo-staff-hiok', 'cashier', 14, 5],
]

console.log(`Workspace ${WS}${dryRun ? ' (dry-run)' : ''}`)
console.log(`Day (SGT) ${todaySgt}`)

if (dryRun) {
  for (const p of PEOPLE) console.log(`  - ${p[0]} → ${p[6]} @ ${p[7]}:00 SGT`)
  process.exit(0)
}

await sql`select public.seed_default_roster_zones(${WS}::uuid)`
const zones = await sql`select id, code, name from roster_zones where workspace_id = ${WS}::uuid order by sort_order`
const byCode = Object.fromEntries(zones.map((z) => [z.code, z]))
console.log(`Zones: ${zones.map((z) => z.code).join(', ')}`)

await sql`delete from roster_shifts where workspace_id = ${WS}::uuid and metadata->>'seed' = 'roster-sample-9'`
await sql`delete from roster_employees where workspace_id = ${WS}::uuid and metadata->>'seed' = 'roster-sample-9'`

for (const [name, email, role, source, externalId, posRef, zoneCode, hour, dur] of PEOPLE) {
  const zone = byCode[zoneCode]
  const [emp] = await sql`
    insert into roster_employees (
      workspace_id, display_name, email, role_label, source_provider, external_id,
      pos_staff_ref, default_zone_id, employment_status, is_active, metadata, synced_at
    ) values (
      ${WS}::uuid, ${name}, ${email}, ${role}, ${source}, ${externalId},
      ${posRef}, ${zone.id}::uuid, 'active', true,
      ${sql.json({ seed: 'roster-sample-9', day: todaySgt })},
      ${source === 'rippling' ? new Date().toISOString() : null}
    )
    returning *
  `
  const start = new Date(`${todaySgt}T${String(hour).padStart(2, '0')}:00:00+08:00`)
  const end = new Date(start.getTime() + dur * 3600 * 1000)
  await sql`
    insert into roster_shifts (
      workspace_id, employee_id, zone_id, starts_at, ends_at, status, notes, metadata
    ) values (
      ${WS}::uuid, ${emp.id}::uuid, ${zone.id}::uuid,
      ${start.toISOString()}, ${end.toISOString()}, 'published', 'Sample seed shift',
      ${sql.json({ seed: 'roster-sample-9' })}
    )
  `
  console.log(`${name} → ${zoneCode}`)
}

try {
  await sql.unsafe("NOTIFY pgrst, 'reload schema'")
} catch {
  /* optional */
}

const counts = await sql`
  select
    (select count(*)::int from roster_employees where workspace_id = ${WS}::uuid and metadata->>'seed' = 'roster-sample-9') as employees,
    (select count(*)::int from roster_shifts where workspace_id = ${WS}::uuid and metadata->>'seed' = 'roster-sample-9') as shifts
`
console.log(counts[0])
await sql.end()
console.log('Done. POS: GET /fran/pos/roster/me?pos_staff_ref=demo-staff-tiffany')
