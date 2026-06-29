import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const baseSchema = readFileSync(new URL('../core/db/001_workspaces.sql', import.meta.url), 'utf8')
const apiAuth = readFileSync(new URL('../server/utils/apiAuth.ts', import.meta.url), 'utf8')
const supabaseUtil = readFileSync(new URL('../server/utils/supabase.ts', import.meta.url), 'utf8')

test('current product schema has workspace-scoped legacy SKU uniqueness', () => {
  assert.match(baseSchema, /create table public\.products/i)
  assert.match(baseSchema, /unique\s*\(\s*workspace_id\s*,\s*sku\s*\)/i)
})

test('current product variants are subordinate to products', () => {
  assert.match(baseSchema, /create table public\.product_variants/i)
  assert.match(baseSchema, /product_id\s+uuid\s+not null\s+references public\.products\(id\)/i)
})

test('current API auth resolves workspace context from API keys', () => {
  assert.match(apiAuth, /workspaceId:\s*data\.workspace_id/)
  assert.match(apiAuth, /requireApiKey\(event:\s*H3Event,\s*requiredScope\?:\s*string\)/)
  assert.match(apiAuth, /authHeader\.match\(\/\^Bearer\\s\+\(\.\+\)\$\/i\)/)
  assert.match(apiAuth, /headers\['x-api-key'\]/)
  assert.match(apiAuth, /query\.api_key/)
})

test('server admin client uses service-role access for API-key protected routes', () => {
  assert.match(supabaseUtil, /export function getAdminClient/)
  assert.match(supabaseUtil, /supabaseServiceRoleKey/)
  assert.match(supabaseUtil, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(supabaseUtil, /const key = config\.supabaseKey/)
  assert.match(supabaseUtil, /export function getServiceClient\(\): SupabaseClient \{\s*return getAdminClient\(\)\s*\}/)
})

test('API auth selects total_requests before incrementing usage count', () => {
  assert.match(apiAuth, /\.select\('id, workspace_id, name, scopes, is_active, expires_at, total_requests'\)/)
  assert.match(apiAuth, /total_requests:\s*data\.total_requests \+ 1/)
})
