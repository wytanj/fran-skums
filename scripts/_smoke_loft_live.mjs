/**
 * Smoke-test Loft / WorldSyntech OFS LIVE credentials.
 * Usage: node scripts/_smoke_loft_live.mjs
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

const liveTok = String(process.env.LOFT_LIVE_TOKEN || '').trim()
const sandboxTok = String(process.env.LOFT_SANDBOX_TOKEN || '').trim()
const portalUser = String(process.env.LOFT_SANDBOX_USER || process.env.LOFT_LIVE_USER || 'Fra01testingaccount').trim()
const portalPass = String(process.env.LOFT_SANDBOX_PASSWORD || process.env.LOFT_LIVE_PASSWORD || '123456').trim()
const preferredLiveBase = String(process.env.LOFT_LIVE_BASE_URL || '').trim().replace(/\/+$/, '')

function decodeBasic(tok) {
  try {
    const s = Buffer.from(tok, 'base64').toString('utf8')
    if (s.includes(':') && !/[\x00-\x08\x0e-\x1f]/.test(s)) {
      const i = s.indexOf(':')
      return { user: s.slice(0, i), pass: s.slice(i + 1) }
    }
  } catch {
    // ignore
  }
  return { user: '', pass: '' }
}

const liveDecoded = decodeBasic(liveTok)
const sandboxDecoded = decodeBasic(sandboxTok)

const hosts = [
  preferredLiveBase,
  'https://orderfulfillment.worldsyntech.com',
  'https://orderfulfillmentdemo3.worldsyntech.com',
  'https://orderfulfillmentdemo2.worldsyntech.com',
  'https://orderfulfillmentdemo.worldsyntech.com',
].filter(Boolean)

async function restLogin(base, token, user, pass) {
  const url = new URL('index.php', base.endsWith('/') ? base : `${base}/`)
  url.searchParams.set('route', 'rest_customer/customer_security/api_login')
  url.searchParams.set('grant_type', 'client_credentials')
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'SKUMS WorldSyntech OFS Connector/1.0',
    },
    body: JSON.stringify({ user_name: user, password: pass }),
    signal: AbortSignal.timeout(25000),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // ignore
  }
  const data = Array.isArray(json?.data) ? json.data[0] : json?.data
  const ok =
    res.ok &&
    (json?.success === 1 || json?.success === true || json?.success === '1') &&
    Boolean(data?.access_token)
  return {
    ok,
    status: res.status,
    error: json?.error ?? text.slice(0, 200),
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

async function portalLogin(base, email, password) {
  const res = await fetch(`${base}/index.php?route=account/login/loginMerchantSupplier&type=1&merchant=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0',
    },
    body: new URLSearchParams({ email, password }).toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  })
  const loc = res.headers.get('location') || ''
  const ok = res.status === 302 && loc.includes('account/account')
  return { status: res.status, loc, ok }
}

async function bearerCall(base, accessToken, route, body = {}) {
  const url = new URL('index.php', base.endsWith('/') ? base : `${base}/`)
  url.searchParams.set('route', route)
  const res = await fetch(url, {
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
    ok,
    status: res.status,
    error: json?.error,
    count: Array.isArray(data) ? data.length : data ? 1 : 0,
    sample: Array.isArray(data) ? data.slice(0, 2) : data,
  }
}

if (!liveTok) {
  console.error('Missing LOFT_LIVE_TOKEN')
  process.exit(1)
}

console.log('=== Loft LIVE smoke ===')
console.log('live token length:', liveTok.length)
console.log('live token decodes to:', liveDecoded.user || '(opaque)', liveDecoded.pass ? `pass_len=${liveDecoded.pass.length}` : '')
console.log('portal user:', portalUser)
console.log('preferred live base:', preferredLiveBase || '(none)')
console.log('')

// Live-only combos first. Sandbox token is checked separately and never counts as live success.
const liveCombos = [
  { label: 'liveTok + portal user/pass', token: liveTok, user: portalUser, pass: portalPass },
  { label: 'liveTok + decoded live user/pass', token: liveTok, user: liveDecoded.user, pass: liveDecoded.pass },
  { label: 'liveTok + sandbox decoded', token: liveTok, user: sandboxDecoded.user, pass: sandboxDecoded.pass },
  {
    label: 'liveTok + LOFT_LIVE_USER/PASS env',
    token: liveTok,
    user: String(process.env.LOFT_LIVE_USER || '').trim(),
    pass: String(process.env.LOFT_LIVE_PASSWORD || '').trim(),
  },
]
const sandboxCompareCombos = [
  { label: '(compare) sandboxTok + portal', token: sandboxTok, user: portalUser, pass: portalPass },
]
const restCombos = [...liveCombos, ...sandboxCompareCombos]

let winner = null

for (const host of hosts) {
  console.log(`---- ${host}`)
  for (const c of restCombos) {
    if (!c.token || !c.user || !c.pass) continue
    try {
      const r = await restLogin(host, c.token, c.user, c.pass)
      const msg = r.ok
        ? `OK ${JSON.stringify(r.meta)}`
        : `${r.status} ${JSON.stringify(r.error).slice(0, 140)}`
      console.log(`  REST ${c.label}: ${msg}`)
      if (r.ok && !winner && c.label.startsWith('liveTok')) {
        winner = { base: host, ...r, combo: c.label }
      }
    } catch (e) {
      console.log(`  REST ${c.label}: ERR ${e.cause?.code || e.message}`)
    }
  }

  for (const [label, user, pass] of [
    ['portal user', portalUser, portalPass],
    ['decoded live', liveDecoded.user, liveDecoded.pass],
  ]) {
    if (!user || !pass) continue
    try {
      const p = await portalLogin(host, user, pass)
      console.log(`  PORTAL ${label}: ${p.status} ${p.ok ? 'OK ' + p.loc : p.loc || '(no redirect)'}`)
    } catch (e) {
      console.log(`  PORTAL ${label}: ERR ${e.cause?.code || e.message}`)
    }
  }
  console.log('')
}

if (!winner) {
  console.log('=== Summary: LIVE REST login failed ===')
  console.log('No host accepted LOFT_LIVE_TOKEN + known user/pass combos for rest_customer api_login.')
  console.log('If you have a dedicated live base URL (not demo3), set LOFT_LIVE_BASE_URL and re-run.')
  process.exit(2)
}

console.log('=== REST success ===')
console.log('host:', winner.base)
console.log('combo:', winner.combo)
console.log('meta:', winner.meta)
console.log('')
console.log('=== Read-only checks ===')

const named = [
  [
    'user_get',
    await bearerCall(winner.base, winner.accessToken, 'rest_customer/customer/user_get', {}),
  ],
  [
    'products',
    await bearerCall(winner.base, winner.accessToken, 'rest_customer/product/get_list', {
      language_id: 1,
      offset: 0,
      limit: 5,
      status: 1,
    }),
  ],
  [
    'inventory',
    await bearerCall(winner.base, winner.accessToken, 'rest_customer/inventory/get_list', {
      language_id: 1,
      offset: 0,
      limit: 5,
      status: 1,
      hit_stock_alert: 0,
      sort_by: 'available',
    }),
  ],
  [
    'delivery_methods',
    await bearerCall(winner.base, winner.accessToken, 'rest_customer/delivery_method/get_list', {
      offset: 0,
      limit: 50,
    }),
  ],
]
for (const [name, s] of named) {
  console.log(
    s.ok ? 'OK  ' : 'FAIL',
    name,
    `http=${s.status}`,
    `count=${s.count}`,
    s.ok ? '' : `err=${JSON.stringify(s.error)}`,
  )
  if (s.ok && s.sample) console.log('   sample:', JSON.stringify(s.sample).slice(0, 300))
}

const failed = named.map(([, s]) => s).filter((s) => !s.ok)
if (failed.length) {
  console.log(`\nAuth works but ${failed.length} read(s) failed.`)
  process.exit(4)
}
console.log('\nAll live smoke checks passed against', winner.base)
process.exit(0)
