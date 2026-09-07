#!/usr/bin/env node
/**
 * Apply apps/shipping/db/002_shipping_seed.sql via SUPABASE_DB_URL.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const __dirname = dirname(fileURLToPath(import.meta.url))
const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || ''
if (!url) {
  console.error('Set SUPABASE_DB_URL')
  process.exit(1)
}

const sqlPath = resolve(__dirname, '../db/002_shipping_seed.sql')
const body = readFileSync(sqlPath, "utf8")
const ssl = process.env.PGSSL === "disable" ? false : "require"
const sql = postgres(url, { ssl, max: 1 })
try {
  await sql.unsafe(body)
  console.log('Shipping seed applied:', sqlPath)
} finally {
  await sql.end({ timeout: 5 })
}
