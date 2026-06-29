import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const createRoute = readFileSync(new URL('../server/api/v1/keys/create.post.ts', import.meta.url), 'utf8')
const settingsPage = readFileSync(new URL('../app/pages/settings.vue', import.meta.url), 'utf8')

test('UI API key creation requires a Supabase user session', () => {
  assert.match(createRoute, /serverSupabaseUser\(event\)/)
  assert.match(createRoute, /statusCode:\s*401/)
})

test('UI API key creation checks workspace access through service-side authorization', () => {
  assert.match(createRoute, /getServiceClient\(\)/)
  assert.match(createRoute, /\.from\('workspaces'\)/)
  assert.match(createRoute, /\.select\('id, owner_id, organization_id'\)/)
  assert.match(createRoute, /\.from\('workspace_members'\)/)
  assert.match(createRoute, /\.eq\('workspace_id',\s*body\.workspace_id\)/)
  assert.match(createRoute, /\.eq\('user_id',\s*uid\)/)
  assert.match(createRoute, /workspace\.owner_id === uid/)
  assert.match(createRoute, /\.from\('organization_members'\)/)
  assert.match(createRoute, /statusCode:\s*403/)
})

test('POS connector key creation is self-serve for workspace members only', () => {
  assert.match(createRoute, /const isPosOnlyKey = scopes\.length > 0/)
  assert.match(createRoute, /'pos:read', 'pos:write'/)
  assert.match(createRoute, /const canCreatePosConnector = isWorkspaceAdmin \|\| directRole === 'member'/)
  assert.match(createRoute, /Workspace access required to create a POS connector key/)
})

test('UI API key creation records the authenticated creator', () => {
  assert.match(createRoute, /created_by:\s*uid/)
  assert.doesNotMatch(createRoute, /created_by:\s*body\.created_by/)
})

test('settings page provides one-click POS connector setup', () => {
  assert.match(settingsPage, /const POS_SCOPES = \['pos:read', 'pos:write'\]/)
  assert.match(settingsPage, /async function handleCreatePosKey\(\)/)
  assert.match(settingsPage, /name:\s*`POS connector - \$\{currentWorkspace\.value\.name\}`/)
  assert.match(settingsPage, /scopes:\s*POS_SCOPES/)
  assert.match(settingsPage, /SKUMS API URL:/)
  assert.match(settingsPage, /SKUMS account key:/)
  assert.match(settingsPage, /POS app's SKUMS Connector settings/)
  assert.match(settingsPage, /Create POS connector/)
})

test('settings page exposes POS scopes in manual API key creation', () => {
  assert.match(settingsPage, /\{ key: 'pos:read', label: 'Read POS Catalog' \}/)
  assert.match(settingsPage, /\{ key: 'pos:write', label: 'Write POS Sales' \}/)
})
