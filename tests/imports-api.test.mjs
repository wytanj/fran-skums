import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const listRoute = readFileSync(new URL('../server/api/v1/imports.get.ts', import.meta.url), 'utf8')
const postRoute = readFileSync(new URL('../server/api/v1/imports.post.ts', import.meta.url), 'utf8')
const getRoute = readFileSync(new URL('../server/api/v1/imports/[id].get.ts', import.meta.url), 'utf8')
const indexRoute = readFileSync(new URL('../server/api/v1/index.get.ts', import.meta.url), 'utf8')
const importPage = readFileSync(new URL('../app/pages/import-export.vue', import.meta.url), 'utf8')
const importComposable = readFileSync(new URL('../app/composables/useCatalogImport.ts', import.meta.url), 'utf8')
const importCore = readFileSync(new URL('../core/import/index.mjs', import.meta.url), 'utf8')

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

test('import detail endpoint returns job summary, staged rows, and completion progress', () => {
  assert.match(getRoute, /\.from\('v_import_job_summary'\)/)
  assert.match(getRoute, /\.from\('import_job_rows'\)/)
  assert.match(getRoute, /\.eq\('workspace_id',\s*ctx\.workspaceId\)/)
  assert.match(getRoute, /rows: rows \|\| \[\]/)
  assert.match(getRoute, /is_complete/)
  assert.match(getRoute, /completion:/)
  assert.match(getRoute, /progress/)
})

test('import page uses shared catalog import pipeline', () => {
  assert.match(importPage, /useCatalogImport/)
  assert.match(importPage, /core\/import/)
  assert.match(importPage, /LARGE_IMPORT_ROW_THRESHOLD/)
  assert.match(importPage, /activeJobId/)
  assert.match(importPage, /Import Complete/)
  assert.match(importPage, /jobSnapshot/)
})

test('import page and composable show live job progress for large files', () => {
  assert.match(importPage, /importProgressPercent/)
  assert.match(importPage, /importProgress\.current/)
  assert.match(importPage, /importProgress\.success/)
  assert.match(importPage, /importProgress\.errors/)
  assert.match(importPage, /Created \/ Updated|created.*updated/i)
  assert.match(importComposable, /startJobPoll/)
  assert.match(importComposable, /persistJobProgress/)
  assert.match(importComposable, /buildJobProgress/)
  assert.match(importComposable, /LARGE_IMPORT_ROW_THRESHOLD/)
})

test('import composable batches writes, upserts by SKU, and stages job rows', () => {
  assert.match(importComposable, /IMPORT_BATCH_SIZE/)
  assert.match(importComposable, /loadExistingSkuMap/)
  assert.match(importComposable, /\.from\('import_jobs'\)/)
  assert.match(importComposable, /\.from\('import_job_rows'\)/)
  assert.match(importComposable, /buildImportJobRow/)
  assert.match(importComposable, /retrying|rowError|insert\(item\.product/)
  assert.match(importCore, /LARGE_IMPORT_ROW_THRESHOLD/)
  assert.match(importCore, /buildJobProgress/)
})
