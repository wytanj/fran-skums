import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const listRoute = readFileSync(new URL('../server/api/v1/imports.get.ts', import.meta.url), 'utf8')
const postRoute = readFileSync(new URL('../server/api/v1/imports.post.ts', import.meta.url), 'utf8')
const getRoute = readFileSync(new URL('../server/api/v1/imports/[id].get.ts', import.meta.url), 'utf8')
const indexRoute = readFileSync(new URL('../server/api/v1/index.get.ts', import.meta.url), 'utf8')
const importPage = readFileSync(new URL('../app/pages/import-export.vue', import.meta.url), 'utf8')

test('import job API endpoints are advertised', () => {
  assert.match(indexRoute, /imports:\s*\{/)
  assert.match(indexRoute, /list:\s*'GET \/api\/v1\/imports'/)
  assert.match(indexRoute, /create:\s*'POST \/api\/v1\/imports'/)
  assert.match(indexRoute, /get:\s*'GET \/api\/v1\/imports\/:id'/)
})

test('import list endpoint is read-only and workspace scoped', () => {
  assert.match(listRoute, /requireApiKey\(event,\s*'products:read'\)/)
  assert.match(listRoute, /\.from\('v_import_job_summary'\)/)
  assert.match(listRoute, /\.eq\('workspace_id',\s*ctx\.workspaceId\)/)
  assert.doesNotMatch(listRoute, /\.insert\(/)
  assert.doesNotMatch(listRoute, /\.update\(/)
})

test('import create endpoint validates source type and writes workspace-scoped job', () => {
  assert.match(postRoute, /requireApiKey\(event,\s*'products:write'\)/)
  assert.match(postRoute, /allowedSourceTypes/)
  assert.match(postRoute, /Invalid source_type/)
  assert.match(postRoute, /workspace_id:\s*ctx\.workspaceId/)
  assert.match(postRoute, /mapping_source:\s*body\.mapping_source \|\| 'manual'/)
  assert.match(postRoute, /inferred_column_mapping:\s*body\.inferred_column_mapping \|\| \{\}/)
  assert.match(postRoute, /review_status:\s*body\.review_status \|\| 'pending'/)
  assert.match(postRoute, /setResponseStatus\(event,\s*201\)/)
})

test('import detail endpoint returns job summary plus first staged rows', () => {
  assert.match(getRoute, /\.from\('v_import_job_summary'\)/)
  assert.match(getRoute, /\.from\('import_job_rows'\)/)
  assert.match(getRoute, /\.eq\('workspace_id',\s*ctx\.workspaceId\)/)
  assert.match(getRoute, /rows: rows \|\| \[\]/)
})

test('import page accepts XLSX and stages normalized rows before product commit', () => {
  assert.match(importPage, /CSV, TSV, XLS, and XLSX files are supported/)
  assert.match(importPage, /await import\('xlsx'\)/)
  assert.match(importPage, /sheet_to_json/)
  assert.match(importPage, /makeUniqueHeaders/)
  assert.match(importPage, /source_type:\s*importSourceType\(\)/)
  assert.match(importPage, /\.from\('import_jobs'\)/)
  assert.match(importPage, /\.from\('import_job_rows'\)/)
  assert.match(importPage, /normalized_product:\s*product/)
  assert.match(importPage, /status:\s*'active'/)
  assert.match(importPage, /pos_enabled:\s*true/)
  assert.match(importPage, /storage_location_code/)
  assert.match(importPage, /store_location_code/)
  assert.match(importPage, /bin_location/)
})

test('import page shows row-level import progress while committing', () => {
  assert.match(importPage, /const importProgress = ref/)
  assert.match(importPage, /const importProgressPercent = computed/)
  assert.match(importPage, /setImportProgress\(/)
  assert.match(importPage, /{{ importProgressPercent }}%/)
  assert.match(importPage, /{{ importProgress\.current }} \/ {{ importProgress\.total }} rows/)
  assert.match(importPage, /{{ importProgress\.success }}/)
  assert.match(importPage, /{{ importProgress\.errors }}/)
})

test('import page batches large imports and falls back to row inserts on batch failure', () => {
  assert.match(importPage, /const IMPORT_BATCH_SIZE = 100/)
  assert.match(importPage, /interface PendingProductInsert/)
  assert.match(importPage, /function buildImportJobRow/)
  assert.match(importPage, /async function flushImportBatch/)
  assert.match(importPage, /pendingProducts\.length >= IMPORT_BATCH_SIZE/)
  assert.match(importPage, /batch product insert failed, retrying rows individually/)
  assert.match(importPage, /await yieldToBrowser\(\)/)
})
