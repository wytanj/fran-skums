/**
 * Signing in without a workspace must not become "create a workspace".
 *
 * The global workspace middleware redirects any signed-in user with no
 * currentWorkspace to /onboarding. That is right for a genuinely new account and
 * wrong for the two cases where having no workspace is the *normal* state:
 *
 *   /invite/<token>   — an invitee has no workspace; that page is what fixes it
 *   /oauth/authorize  — the MCP consent screen must be able to say
 *                       "not a member of any Fran workspace"
 *
 * Both were being bounced. The consequence was worse than a dead end: the page
 * they landed on offered to create a workspace, so an invitee could end up
 * owning an empty one — and since resolveWorkspaceForUser picks the user's own
 * membership, Claude would then connect them to that empty workspace instead of
 * the team's.
 *
 * @see app/middleware/workspace.global.ts
 * @see server/utils/mcpOauth.ts (resolveWorkspaceForUser)
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const middleware = read('app/middleware/workspace.global.ts')

/** Re-implements the middleware's allowlist check against its own source. */
function allowlist() {
  const raw = middleware.match(/NO_WORKSPACE_REQUIRED = \[([^\]]+)\]/)
  assert.ok(raw, 'NO_WORKSPACE_REQUIRED not found — was the allowlist renamed?')
  return raw[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
}

function bypasses(path) {
  return allowlist().some((p) => path === p || path.startsWith(p))
}

test('the invite page is reachable without a workspace', () => {
  assert.equal(bypasses('/invite/abc123'), true)
})

test('the MCP consent screen is reachable without a workspace', () => {
  // Otherwise Connect from Claude lands on "create a workspace".
  assert.equal(bypasses('/oauth/authorize'), true)
})

test('auth, onboarding and the mobile surface still bypass', () => {
  for (const p of ['/auth/login', '/auth/confirm', '/onboarding', '/m/scan']) {
    assert.equal(bypasses(p), true, p)
  }
})

test('ordinary app pages are still gated', () => {
  // The middleware must keep doing its job — this is not a blanket bypass.
  for (const p of ['/', '/products', '/settings', '/store-ops', '/reports']) {
    assert.equal(bypasses(p), false, p)
  }
})

test('a path merely containing an allowlisted word is still gated', () => {
  // Guards against loosening '/invite/' to '/invite' or matching anywhere.
  assert.equal(bypasses('/products/invite-banner'), false)
  assert.equal(bypasses('/settings/oauth-help'), false)
})

test('the middleware still redirects to onboarding when there is no workspace', () => {
  assert.match(middleware, /navigateTo\('\/onboarding'\)/)
})

// ---------------------------------------------------------------------------
// Stale workspace state across accounts
// ---------------------------------------------------------------------------

test('workspace state is dropped when a different account signs in', () => {
  const src = read('app/composables/useWorkspace.ts')
  // Module-level refs survive sign-out → sign-in in the same tab, so the second
  // account saw the first account's workspace name and role.
  assert.match(src, /fetchedForUid/)
  assert.match(src, /if \(fetchedForUid\.value && fetchedForUid\.value !== uid\)[\s\S]{0,120}resetWorkspaceState\(\)/)
})

test('a selected workspace the user can no longer reach is cleared', () => {
  const src = read('app/composables/useWorkspace.ts')
  assert.match(src, /!foundWorkspaces\.some\(\(ws\) => ws\.id === currentWorkspace\.value!\.id\)/)
})

test('signing out clears workspace state', () => {
  const src = read('app/components/AppTopbar.vue')
  assert.match(src, /signOut\(\)[\s\S]{0,200}resetWorkspaceState\(\)/)
})

// ---------------------------------------------------------------------------
// Onboarding offers the invite
// ---------------------------------------------------------------------------

test('onboarding surfaces pending invites ahead of the create form', () => {
  const src = read('app/pages/onboarding.vue')
  assert.match(src, /fetchMyPendingInvites/)
  assert.match(src, /acceptInvite\(invite\.token\)/)
  // Accepting must land them in the team workspace, not leave them on the form.
  assert.match(src, /await fetchWorkspaces\(\)[\s\S]{0,80}router\.push\('\/'\)/)
})

test('onboarding names the signed-in account', () => {
  // Signing in with the wrong Google account is the likeliest cause of an
  // unexpected "create a workspace" screen; showing the email explains it.
  assert.match(read('app/pages/onboarding.vue'), /Signed in as \{\{ user\.email \}\}/)
})

test('a failed invite fetch still leaves the create path usable', () => {
  const src = read('app/pages/onboarding.vue')
  assert.match(src, /catch \{[\s\S]{0,80}pendingInvites\.value = \[\]/)
})

// ---------------------------------------------------------------------------
// Invite uniqueness: one PENDING invite, not one invite per status
// ---------------------------------------------------------------------------

test('085 constrains only pending invites, so revoke history can accumulate', () => {
  const sql = read('core/db/085_invite_unique_pending_only.sql')
  assert.match(sql, /drop constraint if exists workspace_invites_workspace_id_email_status_key/)
  assert.match(sql, /create unique index[\s\S]{0,200}where status = 'pending'/)
  // Case-insensitive, matching sendInvite's lowercasing and accept_invite's
  // lower() comparison — otherwise a re-invite with different casing slips a
  // second live invitation through.
  assert.match(sql, /\(workspace_id, lower\(email\)\)/)
})

test('no migration re-adds a unique across all invite statuses', () => {
  // unique (workspace_id, email, status) caps history at one revoked and one
  // accepted row per address, so the SECOND revoke of the same person fails with
  // a duplicate key error. That is the bug 085 removes; re-adding it would
  // reintroduce it silently.
  const dbDir = join(root, 'core/db')
  const offenders = []
  for (const f of readdirSync(dbDir).filter((x) => /^\d{3}_.*\.sql$/.test(x)).sort()) {
    const sql = read(`core/db/${f}`)
      .split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n')
    if (/unique\s*\(\s*workspace_id\s*,\s*email\s*,\s*status\s*\)/i.test(sql) && f !== '009_team_permissions.sql') {
      offenders.push(f)
    }
  }
  assert.deepEqual(offenders, [], `re-adds the all-status unique: ${offenders.join(', ')}`)
})
