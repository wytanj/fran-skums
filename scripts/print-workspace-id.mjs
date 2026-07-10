#!/usr/bin/env node
/**
 * List Fran workspaces so you can set FRAN_MCP_WORKSPACE_ID.
 *
 * Usage (from repo root):
 *   node scripts/print-workspace-id.mjs
 *
 * How to create a workspace if none exist:
 *   1. npm run dev
 *   2. Sign up / log in at the app
 *   3. Complete onboarding (creates workspace via create_workspace RPC)
 *   4. Re-run this script — copy the id into .env as FRAN_MCP_WORKSPACE_ID=
 */
import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

function loadEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]] !== undefined) continue
    let v = m[2].trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    process.env[m[1]] = v
  }
}

loadEnv()

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const dbUrl = process.env.SUPABASE_DB_URL

console.log(`
Fran MCP workspace id
=====================
FRAN_MCP_WORKSPACE_ID is the UUID of a row in public.workspaces.

Create one (recommended):
  1. npm run dev
  2. Open the app, log in
  3. Onboarding → create workspace (uses create_workspace RPC)
  4. Re-run: node scripts/print-workspace-id.mjs
  5. Add to .env:
       FRAN_MCP_WORKSPACE_ID=<id>

Also visible in the app after login (workspace switcher / settings).
`)

let rows = []

if (url && key) {
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await db.from('workspaces').select('id, name, slug, created_at').order('created_at')
  if (error) console.error('Supabase list error:', error.message)
  else rows = data || []
}

if (!rows.length && dbUrl) {
  const sql = postgres(dbUrl, { ssl: 'require', max: 1 })
  rows = await sql`select id, name, slug, created_at from public.workspaces order by created_at`
  await sql.end({ timeout: 2 })
}

if (!rows.length) {
  console.log('No workspaces found yet. Create one via the app onboarding flow.')
  process.exit(0)
}

console.log('Workspaces:\n')
for (const w of rows) {
  console.log(`  id:   ${w.id}`)
  console.log(`  name: ${w.name}`)
  console.log(`  slug: ${w.slug}`)
  console.log('')
}

if (rows.length === 1) {
  console.log(`Suggested .env line:\nFRAN_MCP_WORKSPACE_ID=${rows[0].id}`)
}
