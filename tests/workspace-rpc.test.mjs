import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const workspaceComposable = readFileSync(new URL('../app/composables/useWorkspace.ts', import.meta.url), 'utf8')

test('workspace creation does not send null org id to legacy RPC signature', () => {
  assert.match(workspaceComposable, /const payload:\s*\{ ws_name: string; ws_slug: string; ws_org_id\?: string \}/)
  assert.match(workspaceComposable, /if \(organizationId\) payload\.ws_org_id = organizationId/)
  assert.doesNotMatch(workspaceComposable, /ws_org_id:\s*organizationId\s*\|\|\s*null/)
})
