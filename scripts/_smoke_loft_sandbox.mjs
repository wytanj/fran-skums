/**
 * Smoke-test Loft / WorldSyntech OFS sandbox credentials.
 *
 * Required env (from .env or shell):
 *   LOFT_SANDBOX_TOKEN   — Basic token (opaque). Header: Authorization: Basic <token>
 *   LOFT_SANDBOX_BASE_URL — HTTPS host with Rest Customer API enabled
 *
 * Optional:
 *   LOFT_SANDBOX_USER / LOFT_SANDBOX_PASSWORD
 *     If omitted and LOFT_SANDBOX_TOKEN is base64(user:pass), that pair is used
 *     as body user_name/password (common Loft handoff shape).
 *
 * Usage:
 *   node scripts/_smoke_loft_sandbox.mjs
 *   $env:LOFT_SANDBOX_BASE_URL='https://...'; node scripts/_smoke_loft_sandbox.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  const p = resolve(process.cwd(), '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let val = m[2]
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val
  }
}

loadEnv()

const basicToken = String(process.env.LOFT_SANDBOX_TOKEN || process.env.LOFT_SANDBOX_BASIC_TOKEN || '').trim()
const baseUrl = String(process.env.LOFT_SANDBOX_BASE_URL || '').trim().replace(/\/+$/, '')

let decodedUser = ''
let decodedPass = ''
try {
  const decoded = Buffer.from(basicToken, 'base64').toString('utf8')
  if (decoded.includes(':') && !/[\x00-\x08\x0e-\x1f]/.test(decoded)) {
    const i = decoded.indexOf(':')
    decodedUser = decoded.slice(0, i)
    decodedPass = decoded.slice(i + 1)
  }
} catch {
  // ignore
}

const userName = String(process.env.LOFT_SANDBOX_USER || decodedUser || '').trim()
const password = String(process.env.LOFT_SANDBOX_PASSWORD || decodedPass || '').trim()

const fallbackHosts = [
  'https://orderfulfillmentdemo3.worldsyntech.com',
  'https://orderfulfillmentdemo2.worldsyntech.com',
  'https://orderfulfillmentdemo.worldsyntech.com',
  'https://orderfulfillment.worldsyntech.com',
]

function loginUrl(base) {
  const url = new URL('index.php', base.endsWith('/') ? base : `${base}/`)
  url.searchParams.set('route', 'rest_customer/customer_security/api_login')
  url.searchParams.set('grant_type', 'client_credentials')
  return url
}

function routeUrl(base, route) {
  const url = new URL('index.php', base.endsWith('/') ? base : `${base}/`)
  url.searchParams.set('route', route)
  return url
}

async function login(base) {
  const res = await fetch(loginUrl(base), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${basicToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'SKUMS WorldSyntech OFS Connector/1.0',
    },
    body: JSON.stringify({ user_name: userName, password }),
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // non-json
  }
  const data = Array.isArray(json?.data) ? json.data[0] : json?.data
  const ok = res.ok && (json?.success === 1 || json?.success === true || json?.success === '1') && data?.access_token
  return {
    base,
    httpStatus: res.status,
    ok: Boolean(ok),
    success: json?.success,
    error: json?.error ?? text.slice(0, 240),
    accessToken: data?.access_token,
    meta: data
      ? {
          customer_id: data.customer_id,
          username: data.username,
          email: data.email,
          expires_in: data.expires_in,
          token_type: data.token_type,
        }
      : null,
  }
}

async function bearerCall(base, accessToken, route, body = {}) {
  const res = await fetch(routeUrl(base, route), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'SKUMS WorldSyntech OFS Connector/1.0',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // ignore
  }
  const ok = res.ok && (json?.success === 1 || json?.success === true || json?.success === '1')
  const data = json?.data
  return {
    route,
    httpStatus: res.status,
    ok,
    error: json?.error,
    count: Array.isArray(data) ? data.length : data ? 1 : 0,
    sample: Array.isArray(data) ? data.slice(0, 2) : data,
  }
}

console.log('=== Loft / WorldSyntech OFS sandbox smoke ===')
if (!basicToken) {
  console.error('Missing LOFT_SANDBOX_TOKEN (Basic token for Authorization header).')
  process.exit(1)
}
if (!userName || !password) {
  console.error('Missing user_name/password. Set LOFT_SANDBOX_USER + LOFT_SANDBOX_PASSWORD,')
  console.error('or provide a LOFT_SANDBOX_TOKEN that base64-decodes to user:pass.')
  process.exit(1)
}

console.log('basic_token length:', basicToken.length)
console.log('user_name:', userName)
console.log('password length:', password.length)
console.log('base_url:', baseUrl || '(not set — will probe public demo hosts only)')
console.log('')

const hosts = baseUrl ? [baseUrl] : fallbackHosts
const results = []
for (const host of hosts) {
  process.stdout.write(`login ${host} ... `)
  try {
    const r = await login(host)
    results.push(r)
    if (r.ok) console.log('OK', r.meta)
    else console.log('fail', r.httpStatus, JSON.stringify(r.error).slice(0, 160))
  } catch (err) {
    const msg = err?.cause?.code || err?.message || String(err)
    results.push({ base: host, ok: false, error: msg, httpStatus: 0 })
    console.log('fail', msg)
  }
}

const winner = results.find((r) => r.ok)
if (!winner) {
  console.log('')
  console.log('=== No successful login ===')
  console.log('Our connector expects WorldSyntech auth as:')
  console.log('  POST {base}/index.php?route=rest_customer/customer_security/api_login&grant_type=client_credentials')
  console.log('  Header Authorization: Basic <LOFT_SANDBOX_TOKEN>')
  console.log('  Body { "user_name", "password" }')
  console.log('')
  console.log('Common remote errors:')
  console.log('  - "Rest Admin API is disabled." → host is up but Rest Customer API is off for that tenant/domain')
  console.log('  - 404 / empty Apache → hostname is not an OFS install')
  console.log('')
  if (!baseUrl) {
    console.log('Next: set LOFT_SANDBOX_BASE_URL to the LISE sandbox host Loft gave you, then re-run.')
    console.log('Public demo hosts (orderfulfillmentdemo*.worldsyntech.com) currently return API disabled.')
  } else {
    console.log('Next: confirm with Loft that Rest Customer API is enabled on this base URL,')
    console.log('and that Basic token + API user/password are the correct pair for this tenant.')
  }
  process.exit(2)
}

console.log('')
console.log('=== Read-only checks ===')
const steps = [
  await bearerCall(winner.base, winner.accessToken, 'rest_customer/customer/user_get', {}),
  await bearerCall(winner.base, winner.accessToken, 'rest_customer/product/get_list', {
    language_id: 1,
    offset: 0,
    limit: 5,
    status: 1,
  }),
  await bearerCall(winner.base, winner.accessToken, 'rest_customer/inventory/get_list', {
    language_id: 1,
    offset: 0,
    limit: 5,
    status: 1,
    hit_stock_alert: 0,
    sort_by: 'available',
  }),
  await bearerCall(winner.base, winner.accessToken, 'rest_customer/delivery_method/get_list', {
    offset: 0,
    limit: 50,
  }),
  await bearerCall(winner.base, winner.accessToken, 'rest_customer/address/get_list', {}),
]

for (const s of steps) {
  console.log(
    s.ok ? 'OK  ' : 'FAIL',
    s.route,
    `http=${s.httpStatus}`,
    `count=${s.count}`,
    s.ok ? '' : `err=${JSON.stringify(s.error)}`,
  )
  if (s.ok && s.sample) {
    console.log('    sample:', JSON.stringify(s.sample).slice(0, 360))
  }
}

const failed = steps.filter((s) => !s.ok)
console.log('')
if (failed.length) {
  console.log(`Auth works on ${winner.base}, but ${failed.length} read call(s) failed.`)
  process.exit(4)
}
console.log('All sandbox smoke checks passed against', winner.base)
process.exit(0)
