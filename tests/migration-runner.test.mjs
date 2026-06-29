import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const runner = readFileSync(new URL('../scripts/migrate.mjs', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')

test('package exposes migration runner scripts', () => {
  assert.equal(pkg.scripts['db:migrate'], 'node scripts/migrate.mjs')
  assert.equal(pkg.scripts['db:migrate:status'], 'node scripts/migrate.mjs --status')
})

test('migration runner supports dry-run, status, and range selection', () => {
  assert.match(runner, /--dry-run/)
  assert.match(runner, /--status/)
  assert.match(runner, /--from/)
  assert.match(runner, /--to/)
  assert.match(runner, /--only/)
})

test('migration runner tracks applied migrations with checksums', () => {
  assert.match(runner, /public\.skums_migrations/)
  assert.match(runner, /createHash\('sha256'\)/)
  assert.match(runner, /Checksum mismatch/)
})

test('migration runner applies each migration through postgres driver transaction', () => {
  assert.match(runner, /import postgres from 'postgres'/)
  assert.match(runner, /sql\.begin/)
  assert.match(runner, /tx\.unsafe\(migration\.sql\)/)
  assert.match(runner, /ssl: process\.env\.PGSSL === 'disable' \? false : 'require'/)
  assert.match(runner, /fileURLToPath/)
})

test('env example documents direct Postgres URL for migrations', () => {
  assert.match(envExample, /SUPABASE_DB_URL=postgresql:\/\//)
  assert.match(envExample, /Direct Postgres connection string for migrations/)
  assert.match(envExample, /Pooler example/)
  assert.match(envExample, /PGSSL=require/)
})

test('migration docs include runner usage and prerequisites', () => {
  assert.match(migrationsDoc, /npm run db:migrate:status/)
  assert.match(migrationsDoc, /npm run db:migrate -- --from 021 --to 029/)
  assert.match(migrationsDoc, /SUPABASE_DB_URL=postgresql:\/\//)
  assert.match(migrationsDoc, /Node `postgres` driver/)
  assert.match(migrationsDoc, /pooler URI/)
  assert.match(migrationsDoc, /public\.skums_migrations/)
})
