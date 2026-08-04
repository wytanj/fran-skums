/**
 * Client-registry lookups for the MCP OAuth connector.
 *
 * These run against a fake supabase builder rather than asserting on source
 * text, which is the reason mcpOauthClients.ts exists as its own module. The
 * behaviour under test is the fix for a real bug: the original single lookup
 * returned "the newest live row", so generating credentials for a second
 * workspace silently stopped the first workspace's connector from being
 * recognised — and it broke the OLDER one, so it would have surfaced as the demo
 * mysteriously dying rather than as production failing to start.
 *
 * @see server/utils/mcpOauthClients.ts
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findAnyMcpOauthClient,
  findMcpOauthClientById,
} from '../server/utils/mcpOauthClients.ts'

/**
 * Minimal stand-in for the supabase query builder: chainable, thenable, and it
 * actually applies eq/is/order/limit so a filter that is missing from the
 * implementation shows up as a wrong row rather than a passing test.
 */
function fakeDb(rows) {
  const calls = []
  function builder(state) {
    const api = {
      select(cols) {
        calls.push(['select', cols])
        return api
      },
      eq(col, val) {
        calls.push(['eq', col, val])
        state.filters.push((r) => r[col] === val)
        return api
      },
      is(col, val) {
        calls.push(['is', col, val])
        state.filters.push((r) => (val === null ? r[col] == null : r[col] === val))
        return api
      },
      order(col, opts) {
        calls.push(['order', col, opts])
        state.order = { col, ascending: opts?.ascending !== false }
        return api
      },
      limit(n) {
        calls.push(['limit', n])
        state.limit = n
        return api
      },
      then(resolve, reject) {
        try {
          let out = rows.filter((r) => state.filters.every((f) => f(r)))
          if (state.order) {
            const { col, ascending } = state.order
            out = [...out].sort((a, b) =>
              ascending ? String(a[col]).localeCompare(String(b[col]))
                : String(b[col]).localeCompare(String(a[col])),
            )
          }
          if (state.limit != null) out = out.slice(0, state.limit)
          return Promise.resolve({ data: out, error: null }).then(resolve, reject)
        } catch (e) {
          return Promise.reject(e).then(resolve, reject)
        }
      },
    }
    return api
  }
  return {
    calls,
    from(table) {
      calls.push(['from', table])
      return builder({ filters: [], order: null, limit: null })
    },
  }
}

const DEMO = {
  id: 'row-demo',
  client_id: 'fran-mcp-demo',
  client_secret_hash: 'hash-demo',
  revoked_at: null,
  created_at: '2026-08-04T00:00:00Z',
}
const PROD = {
  id: 'row-prod',
  client_id: 'fran-mcp-prod',
  client_secret_hash: 'hash-prod',
  revoked_at: null,
  created_at: '2026-09-01T00:00:00Z',
}
const REVOKED = {
  id: 'row-old',
  client_id: 'fran-mcp-old',
  client_secret_hash: 'hash-old',
  revoked_at: '2026-08-20T00:00:00Z',
  created_at: '2026-07-01T00:00:00Z',
}

// ---------------------------------------------------------------------------
// The regression this module exists for
// ---------------------------------------------------------------------------

test('two workspaces registered: BOTH clients still resolve', async () => {
  // The original bug in one assertion. PROD is newer, so a newest-row-wins
  // lookup returned it for every request and the demo connector went dead.
  const db = fakeDb([DEMO, PROD])

  const demo = await findMcpOauthClientById(db, 'fran-mcp-demo')
  const prod = await findMcpOauthClientById(db, 'fran-mcp-prod')

  assert.equal(demo?.clientId, 'fran-mcp-demo')
  assert.equal(demo?.clientSecretHash, 'hash-demo')
  assert.equal(prod?.clientId, 'fran-mcp-prod')
  assert.equal(prod?.clientSecretHash, 'hash-prod')
})

test('adding a newer client does not shadow the older one', async () => {
  const before = await findMcpOauthClientById(fakeDb([DEMO]), 'fran-mcp-demo')
  const after = await findMcpOauthClientById(fakeDb([DEMO, PROD]), 'fran-mcp-demo')
  assert.deepEqual(after, before)
})

// ---------------------------------------------------------------------------
// findMcpOauthClientById
// ---------------------------------------------------------------------------

test('an unknown client_id resolves to null, not to some other client', async () => {
  const db = fakeDb([DEMO, PROD])
  assert.equal(await findMcpOauthClientById(db, 'fran-mcp-nope'), null)
})

test('a revoked client resolves to null', async () => {
  // Same answer as unknown, so the caller can say invalid_client for both
  // without revealing which — there is nothing to probe.
  const db = fakeDb([REVOKED])
  assert.equal(await findMcpOauthClientById(db, 'fran-mcp-old'), null)
})

test('a blank client_id never reaches the database', async () => {
  for (const id of [null, undefined, '', '   ']) {
    const db = fakeDb([DEMO])
    assert.equal(await findMcpOauthClientById(db, id), null)
    assert.equal(db.calls.length, 0, `queried for ${JSON.stringify(id)}`)
  }
})

test('the id lookup filters on client_id AND revoked_at', async () => {
  const db = fakeDb([DEMO])
  await findMcpOauthClientById(db, 'fran-mcp-demo')
  assert.ok(db.calls.some(([m, c, v]) => m === 'eq' && c === 'client_id' && v === 'fran-mcp-demo'))
  assert.ok(db.calls.some(([m, c, v]) => m === 'is' && c === 'revoked_at' && v === null))
})

test('a null secret hash is preserved as null, not coerced', async () => {
  // Null means public client; an empty string would be compared against and fail.
  const publicClient = { ...DEMO, client_secret_hash: null }
  const row = await findMcpOauthClientById(fakeDb([publicClient]), 'fran-mcp-demo')
  assert.equal(row?.clientSecretHash, null)
})

// ---------------------------------------------------------------------------
// findAnyMcpOauthClient — the boolean gate only
// ---------------------------------------------------------------------------

test('the any-client gate returns something when a client exists', async () => {
  const row = await findAnyMcpOauthClient(fakeDb([DEMO, PROD]))
  assert.ok(row)
})

test('the any-client gate ignores revoked rows', async () => {
  // Otherwise revoking the last client would leave discovery advertising an
  // OAuth server that can no longer complete a flow.
  assert.equal(await findAnyMcpOauthClient(fakeDb([REVOKED])), null)
})

test('the any-client gate returns null on an empty registry', async () => {
  assert.equal(await findAnyMcpOauthClient(fakeDb([])), null)
})

// ---------------------------------------------------------------------------
// Wiring: the authenticating paths must use the id lookup
// ---------------------------------------------------------------------------

test('token endpoint and authorize resolve by client_id', async () => {
  const { readFileSync } = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const read = (p) => readFileSync(join(root, p), 'utf8')

  const token = read('server/routes/oauth/token.post.ts')
  assert.match(token, /mcpOauthClientById\(creds\.clientId, db\)/)
  // The old shape compared a fetched client against the presented id.
  assert.ok(!/creds\.clientId !== client\.clientId/.test(token))

  const util = read('server/utils/mcpOauth.ts')
  assert.match(util, /mcpOauthClientById\(query\.client_id\)/)
})

test('the boolean gates use anyMcpOauthClient, never the id lookup', async () => {
  const { readFileSync } = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const read = (p) => readFileSync(join(root, p), 'utf8')

  for (const f of ['server/utils/mcpHttpHandler.ts', 'server/middleware/mcpOauthMetadata.ts']) {
    const src = read(f)
    assert.match(src, /anyMcpOauthClient\(\)/, f)
    assert.ok(!/mcpOauthClientById/.test(src), `${f} should not authenticate`)
  }
})
