/**
 * Popup: settings, scan active Shopee tab, push shop resolve to SKUMS API.
 */

const $ = (id) => document.getElementById(id)

let lastScan = null
let selectedCandidate = null
let brands = []
let lastWorkspaceId = null

async function loadSettings() {
  const s = await chrome.storage.sync.get(['apiBase', 'apiKey'])
  $('apiBase').value = s.apiBase || 'https://fran-skums.vercel.app'
  $('apiKey').value = s.apiKey || ''
}

async function saveSettings() {
  await chrome.storage.sync.set({
    apiBase: $('apiBase').value.trim().replace(/\/$/, ''),
    apiKey: $('apiKey').value.trim(),
  })
  setStatus('Settings saved', 'ok')
}

function setStatus(msg, cls) {
  const el = $('status')
  el.textContent = msg
  el.className = cls || 'muted'
}

function authHeaders() {
  const key = $('apiKey').value.trim()
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

function apiBase() {
  return $('apiBase').value.trim().replace(/\/$/, '')
}

function parseApiBody(res, text) {
  const trimmed = String(text || '').trim()
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
    throw new Error(
      `Got HTML instead of JSON from ${apiBase()} (${res.status}).\n` +
        `The brand-universe API is not on this host yet (SPA fallback).\n` +
        `Fix: run local API and set base to http://127.0.0.1:3000\n` +
        `  npm run dev\n` +
        `Or deploy the uncommitted brand-radar routes to Vercel, then reload extension.`,
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 160)}`)
  }
}

async function apiGet(path) {
  const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() })
  const text = await res.text()
  const json = parseApiBody(res, text)
  if (!res.ok) {
    throw new Error(json.statusMessage || json.message || `HTTP ${res.status}`)
  }
  return json
}

async function apiPost(path, body) {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const json = parseApiBody(res, text)
  if (!res.ok) {
    throw new Error(json.statusMessage || json.message || `HTTP ${res.status}`)
  }
  return json
}

function needsShop(b) {
  return !b.shop_username || b.shop_resolve_status !== 'confirmed'
}

async function loadBrands() {
  if (!$('apiKey').value.trim()) {
    setStatus('Paste API key first (needs intel:read + intel:write)', 'err')
    return
  }
  setStatus('Loading brand universe…')
  const data = await apiGet('/api/v1/marketplace/brand-universe?limit=300')
  brands = Array.isArray(data.brands) ? data.brands : []
  lastWorkspaceId = data.workspace_id || null

  const need = brands.filter(needsShop)
  const sel = $('brandSelect')
  sel.innerHTML = ''
  const opt0 = document.createElement('option')
  opt0.value = ''

  if (brands.length === 0) {
    opt0.textContent = '— no brands in this key’s workspace —'
    sel.appendChild(opt0)
    setStatus(
      `0 brands for workspace ${lastWorkspaceId || '(unknown)'}.\n` +
        `API key is bound to a workspace that has no marketplace_brand_universe rows.\n` +
        `Import was done for c21c057f-ea01-4e19-bc79-fafcf2626b19 — use a key for that workspace,\n` +
        `or re-import against this key’s workspace.`,
      'err',
    )
    return
  }

  opt0.textContent = need.length
    ? `— ${need.length} need shop · ${brands.length} total —`
    : `— all ${brands.length} confirmed —`
  sel.appendChild(opt0)

  const sorted = [...brands].sort((a, b) => {
    const ap = a.pilot_tier === 'pilot' ? 0 : 1
    const bp = b.pilot_tier === 'pilot' ? 0 : 1
    if (ap !== bp) return ap - bp
    const an = needsShop(a) ? 0 : 1
    const bn = needsShop(b) ? 0 : 1
    if (an !== bn) return an - bn
    return String(a.display_name || '').localeCompare(String(b.display_name || ''))
  })

  for (const b of sorted) {
    const o = document.createElement('option')
    o.value = b.brand_key
    const flag = !needsShop(b) ? '✓' : b.shop_username ? '~' : '·'
    o.textContent = `${flag} ${b.display_name} (${b.brand_key})${b.shop_username ? ' → @' + b.shop_username : ''}`
    sel.appendChild(o)
  }

  setStatus(
    `Loaded ${brands.length} brands (${need.length} need shop)\nworkspace: ${lastWorkspaceId || '?'}`,
    'ok',
  )
}

function renderCandidates(scan) {
  const box = $('candidates')
  if (!scan?.candidates?.length) {
    box.innerHTML = `<div class="muted">No shop candidates on this page (${scan?.page_kind || '?'}).<br/>Open a Mall shop page or brand search results.</div>`
    $('btnPush').disabled = true
    selectedCandidate = null
    return
  }

  box.innerHTML = scan.candidates
    .map(
      (c, i) => `
    <div class="cand">
      <label style="font-weight:500;display:flex;gap:6px;align-items:flex-start">
        <input type="radio" name="cand" value="${i}" ${i === 0 ? 'checked' : ''} />
        <span>
          <strong>@${c.shop_username || '(shop id ' + (c.shop_id || '?') + ')'}</strong>
          <span class="muted"> · ${c.seller_hint || ''} · conf ${(c.confidence || 0).toFixed(2)}</span><br/>
          <span class="muted">${c.shop_name || ''} ${c.shop_url || ''}</span>
        </span>
      </label>
    </div>`,
    )
    .join('')

  selectedCandidate = scan.candidates[0]
  $('btnPush').disabled = !selectedCandidate?.shop_username && !selectedCandidate?.shop_url

  box.querySelectorAll('input[name="cand"]').forEach((el) => {
    el.addEventListener('change', () => {
      selectedCandidate = scan.candidates[Number(el.value)]
      $('btnPush').disabled = !selectedCandidate?.shop_username && !selectedCandidate?.shop_url
    })
  })
}

async function scanActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url || !/shopee\.sg/i.test(tab.url)) {
    setStatus('Open a shopee.sg tab first', 'err')
    return
  }
  setStatus('Scanning tab…')
  let res
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'SKUMS_SCAN_PAGE' })
  } catch (e) {
    setStatus(
      'Scan failed — reload the Shopee tab (content script not injected), then try again.\n' +
        (e?.message || ''),
      'err',
    )
    return
  }
  if (!res?.ok) {
    setStatus(res?.error || 'Scan failed — reload the Shopee tab and try again', 'err')
    return
  }
  lastScan = res.scan
  renderCandidates(lastScan)

  if (lastScan.search_query && brands.length) {
    const q = lastScan.search_query.toLowerCase()
    const match = brands.find(
      (b) =>
        q.includes(String(b.display_name).toLowerCase()) ||
        q.includes(String(b.brand_key).replace(/-/g, ' ')),
    )
    if (match) $('brandSelect').value = match.brand_key
  }

  if (lastScan.page_kind === 'shop' && brands.length) {
    const title = (lastScan.page_title || '').toLowerCase()
    const match = brands.find((b) => title.includes(String(b.display_name).toLowerCase()))
    if (match) $('brandSelect').value = match.brand_key
  }

  setStatus(
    `Found ${lastScan.candidates.length} candidate(s) · page=${lastScan.page_kind}`,
    'ok',
  )
}

async function pushResolve(payload) {
  const brand_key = $('brandSelect').value
  if (!brand_key) throw new Error('Select a brand first')
  if (!$('apiKey').value.trim()) throw new Error('API key required')

  const body = {
    brand_key,
    status: 'confirmed',
    source: payload.source || 'manual',
    shop_url: payload.shop_url || undefined,
    shop_username: payload.shop_username || undefined,
    shop_id: payload.shop_id || undefined,
    evidence: {
      via: 'chrome_extension',
      page_url: lastScan?.page_url || null,
      page_kind: lastScan?.page_kind || null,
      ...(payload.evidence || {}),
    },
  }

  return apiPost('/api/v1/marketplace/brand-universe/resolve-shop', body)
}

$('btnSave').addEventListener('click', () => saveSettings().catch((e) => setStatus(e.message, 'err')))
$('btnLoadBrands').addEventListener('click', () =>
  loadBrands().catch((e) => setStatus(String(e.message || e), 'err')),
)
$('btnScan').addEventListener('click', () => scanActiveTab().catch((e) => setStatus(e.message, 'err')))

$('btnPush').addEventListener('click', async () => {
  try {
    if (!selectedCandidate) throw new Error('No candidate selected')
    if (!selectedCandidate.shop_username && !selectedCandidate.shop_url) {
      throw new Error('Candidate has no username — open the shop page and scan again')
    }
    setStatus('Pushing…')
    const data = await pushResolve({
      shop_username: selectedCandidate.shop_username,
      shop_url: selectedCandidate.shop_url,
      shop_id: selectedCandidate.shop_id,
      source: 'serp',
      evidence: { candidate: selectedCandidate },
    })
    setStatus(
      `Confirmed @${data.brand?.shop_username} for ${data.brand?.brand_key}`,
      'ok',
    )
    await loadBrands()
  } catch (e) {
    setStatus(e.message, 'err')
  }
})

$('btnPushManual').addEventListener('click', async () => {
  try {
    const raw = $('manualUrl').value.trim()
    if (!raw) throw new Error('Paste a shop URL or username')
    setStatus('Pushing…')
    const data = await pushResolve({
      shop_url: raw.includes('/') || raw.includes('.') ? raw : undefined,
      shop_username: raw.includes('/') ? undefined : raw,
      source: 'manual',
    })
    // if only username without slash, still pass as username
    if (!data) return
    setStatus(
      `Confirmed @${data.brand?.shop_username} for ${data.brand?.brand_key}`,
      'ok',
    )
    await loadBrands()
  } catch (e) {
    setStatus(e.message, 'err')
  }
})

loadSettings().catch(() => {})
