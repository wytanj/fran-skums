import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const indexRoute = readFileSync(new URL('../server/api/v1/index.get.ts', import.meta.url), 'utf8')
const appsGet = readFileSync(new URL('../server/api/v1/apps.get.ts', import.meta.url), 'utf8')
const workspaceAppsGet = readFileSync(new URL('../server/api/v1/workspace-apps.get.ts', import.meta.url), 'utf8')
const workspaceAppsPost = readFileSync(new URL('../server/api/v1/workspace-apps.post.ts', import.meta.url), 'utf8')
const capabilityGet = readFileSync(new URL('../server/api/v1/capability-sources.get.ts', import.meta.url), 'utf8')
const capabilityPost = readFileSync(new URL('../server/api/v1/capability-sources.post.ts', import.meta.url), 'utf8')
const eventsGet = readFileSync(new URL('../server/api/v1/events.get.ts', import.meta.url), 'utf8')
const eventsPost = readFileSync(new URL('../server/api/v1/events.post.ts', import.meta.url), 'utf8')
const proposalsGet = readFileSync(new URL('../server/api/v1/agent-proposals.get.ts', import.meta.url), 'utf8')
const proposalsPost = readFileSync(new URL('../server/api/v1/agent-proposals.post.ts', import.meta.url), 'utf8')
const decisionPost = readFileSync(new URL('../server/api/v1/agent-proposals/[id]/decision.post.ts', import.meta.url), 'utf8')

test('app platform API is advertised with scopes', () => {
  for (const endpoint of [
    'GET /api/v1/apps',
    'GET|POST /api/v1/workspace-apps',
    'GET|POST /api/v1/capability-sources',
    'GET /api/v1/events',
    'POST /api/v1/events',
    'GET /api/v1/agent-proposals',
    'POST /api/v1/agent-proposals',
  ]) {
    assert.match(indexRoute, new RegExp(endpoint.replace(/[|/]/g, (m) => `\\${m}`)))
  }

  for (const scope of ['apps:read', 'apps:write', 'events:read', 'events:write', 'agents:read', 'agents:write']) {
    assert.match(indexRoute, new RegExp(`'${scope}'`))
  }
})

test('app definition and workspace app APIs are workspace scoped', () => {
  assert.match(appsGet, /requireApiKey\(event,\s*'apps:read'\)/)
  assert.match(appsGet, /\.from\('app_definitions'\)/)
  assert.match(appsGet, /workspace_id\.is\.null,workspace_id\.eq\.\$\{ctx\.workspaceId\}/)

  assert.match(workspaceAppsGet, /requireApiKey\(event,\s*'apps:read'\)/)
  assert.match(workspaceAppsGet, /\.from\('workspace_apps'\)/)
  assert.match(workspaceAppsGet, /\.eq\('workspace_id',\s*ctx\.workspaceId\)/)

  assert.match(workspaceAppsPost, /requireApiKey\(event,\s*'apps:write'\)/)
  assert.match(workspaceAppsPost, /\.upsert\(/)
  assert.match(workspaceAppsPost, /workspace_id:\s*ctx\.workspaceId/)
  assert.match(workspaceAppsPost, /onConflict:\s*'workspace_id,app_key'/)
})

test('capability source APIs declare per-workspace app/system ownership', () => {
  assert.match(capabilityGet, /requireApiKey\(event,\s*'apps:read'\)/)
  assert.match(capabilityGet, /\.from\('workspace_capability_sources'\)/)
  assert.match(capabilityGet, /\.eq\('workspace_id',\s*ctx\.workspaceId\)/)

  assert.match(capabilityPost, /requireApiKey\(event,\s*'apps:write'\)/)
  assert.match(capabilityPost, /\.from\('workspace_capability_sources'\)/)
  assert.match(capabilityPost, /capability_key:\s*capabilityKey/)
  assert.match(capabilityPost, /owner_type:\s*body\.owner_type \|\| 'workspace_app'/)
  assert.match(capabilityPost, /mode:\s*body\.mode \|\| 'source_of_truth'/)
})

test('domain event APIs are append-only by route behavior', () => {
  assert.match(eventsGet, /requireApiKey\(event,\s*'events:read'\)/)
  assert.match(eventsGet, /\.from\('domain_events'\)/)
  assert.match(eventsGet, /\.eq\('workspace_id',\s*ctx\.workspaceId\)/)
  assert.doesNotMatch(eventsGet, /\.insert\(|\.update\(|\.delete\(/)

  assert.match(eventsPost, /requireApiKey\(event,\s*'events:write'\)/)
  assert.match(eventsPost, /\.from\('domain_events'\)/)
  assert.match(eventsPost, /\.insert\(/)
  assert.match(eventsPost, /workspace_id:\s*ctx\.workspaceId/)
})

test('agent proposal APIs create and decide deterministic proposals', () => {
  assert.match(proposalsGet, /requireApiKey\(event,\s*'agents:read'\)/)
  assert.match(proposalsGet, /\.from\('agent_proposals'\)/)
  assert.match(proposalsGet, /\.eq\('workspace_id',\s*ctx\.workspaceId\)/)

  assert.match(proposalsPost, /requireApiKey\(event,\s*'agents:write'\)/)
  assert.match(proposalsPost, /agent_type and intent_summary are required/)
  assert.match(proposalsPost, /proposed_steps:\s*body\.proposed_steps \|\| \[\]/)
  assert.match(proposalsPost, /approval_required:\s*body\.approval_required \?\? true/)

  assert.match(decisionPost, /getRouterParam\(event,\s*'id'\)/)
  assert.match(decisionPost, /\.update\(patch\)/)
  assert.match(decisionPost, /\.eq\('workspace_id',\s*ctx\.workspaceId\)/)
  assert.match(decisionPost, /\.from\('approval_requests'\)\.insert/)
})
