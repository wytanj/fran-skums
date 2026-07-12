import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const workspaceComposable = readFileSync(new URL('../app/composables/useWorkspace.ts', import.meta.url), 'utf8')
const fixOverload = readFileSync(new URL('../core/db/051_fix_create_workspace_overload.sql', import.meta.url), 'utf8')

test('workspace creation only includes org id when provided', () => {
  assert.match(workspaceComposable, /const payload:\s*\{ ws_name: string; ws_slug: string; ws_org_id\?: string \}/)
  assert.match(workspaceComposable, /if \(organizationId\) payload\.ws_org_id = organizationId/)
  assert.doesNotMatch(workspaceComposable, /ws_org_id:\s*organizationId\s*\|\|\s*null/)
})

test('create_workspace overload fix drops the 2-arg signature', () => {
  assert.match(fixOverload, /drop function if exists public\.create_workspace\(text, text\);/i)
  assert.match(fixOverload, /create or replace function public\.create_workspace\(ws_name text, ws_slug text, ws_org_id uuid default null\)/i)
})
