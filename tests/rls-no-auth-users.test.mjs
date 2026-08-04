/**
 * No *effective* RLS policy may read auth.users.
 *
 * An RLS policy is evaluated with the privileges of the querying role, and
 * Supabase grants the `authenticated` role no SELECT on auth.users. A policy
 * that subqueries it therefore raises "permission denied for table users" before
 * its comparison is reached, and the failure lands on whatever statement touched
 * the table — including the RETURNING clause of an unrelated INSERT, which is how
 * this first showed up: inviting a teammate failed with a users permission error
 * even though the INSERT policy would have allowed it.
 *
 * Read the claim from auth.jwt() instead. Inside a `security definer` function
 * auth.users is fine — the function runs as its owner — so this guards policy
 * expressions only.
 *
 * "Effective" matters because applied migrations are immutable: 009 still
 * contains the bad policy and always will. A later migration that drops and
 * recreates the same policy without auth.users is the fix, so the scanner
 * resolves policies in migration order and only judges the final definition.
 *
 * @see core/db/084_invite_policy_no_auth_users.sql
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbDir = join(root, 'core/db')

/** Drop -- line comments so quoted examples in a header don't read as code. */
function stripComments(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

function migrationFiles() {
  return readdirSync(dbDir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort() // zero-padded, so lexical order is migration order
}

/**
 * Final definition of every policy, keyed by "table::name", walking migrations
 * in order so a later DROP + CREATE supersedes an earlier definition.
 */
function effectivePolicies() {
  const byKey = new Map()
  for (const file of migrationFiles()) {
    const sql = stripComments(readFileSync(join(dbDir, file), 'utf8'))
    for (const stmt of sql.split(/;\s*\n/)) {
      const created = stmt.match(/create\s+policy\s+"([^"]+)"\s+on\s+([a-z_][a-z_.]*)/i)
      if (created) {
        byKey.set(`${created[2]}::${created[1]}`, { file, stmt })
        continue
      }
      const dropped = stmt.match(/drop\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+([a-z_][a-z_.]*)/i)
      if (dropped) byKey.delete(`${dropped[2]}::${dropped[1]}`)
    }
  }
  return byKey
}

test('no effective RLS policy reads auth.users', () => {
  const offenders = []
  for (const [key, { file, stmt }] of effectivePolicies()) {
    if (/\bauth\.users\b/.test(stmt)) offenders.push(`${key}  (last defined in ${file})`)
  }
  assert.deepEqual(
    offenders,
    [],
    'RLS policies cannot read auth.users — the authenticated role has no '
      + "privilege on it. Use auth.jwt() ->> 'email' / auth.uid(), or move the "
      + 'lookup into a security definer function. Offenders:\n  '
      + offenders.join('\n  '),
  )
})

test('the scanner actually resolves a later DROP + CREATE', () => {
  // Guards the guard: if this stopped working, the test above would pass
  // vacuously on a repo where 009's bad policy is still the live one.
  const policies = effectivePolicies()
  const key = 'public.workspace_invites::Users can view own invites'
  const entry = policies.get(key)
  assert.ok(entry, 'invite self-view policy should still exist')
  assert.equal(entry.file, '084_invite_policy_no_auth_users.sql')
  assert.ok(!/\bauth\.users\b/.test(entry.stmt))
})

test('084 replaced the invite policy with a JWT claim read', () => {
  const sql = stripComments(readFileSync(join(dbDir, '084_invite_policy_no_auth_users.sql'), 'utf8'))
  assert.match(sql, /drop policy if exists "Users can view own invites"/)
  // Case-insensitive so a user can always SEE an invite they can ACCEPT —
  // accept_invite() compares with lower() on both sides.
  assert.match(sql, /lower\(email\) = lower\(auth\.jwt\(\) ->> 'email'\)/)
  assert.ok(!/from auth\.users/.test(sql))
})

test('the invite-acceptance functions still verify the email, via security definer', () => {
  // The guard above must not be satisfiable by dropping the check entirely:
  // both accept paths still confirm the signed-in address matches the invited
  // one, which is what binds a membership row to a real identity.
  const team = readFileSync(join(dbDir, '009_team_permissions.sql'), 'utf8')
  assert.match(team, /security definer/)
  assert.match(team, /lower\(v_invite\.email\) <> lower\(v_user_email\)/)

  const org = readFileSync(join(dbDir, '015_organizations.sql'), 'utf8')
  assert.match(org, /lower\(v_email\) <> lower\(v_invite\.email\)/)
})
