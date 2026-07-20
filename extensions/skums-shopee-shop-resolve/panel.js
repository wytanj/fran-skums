/**
 * Side panel UI — stays open while browsing Shopee.
 * Persists brands + selected brand in chrome.storage.local.
 */

const $ = (id) => document.getElementById(id)

const CACHE_KEY = 'skums_brand_cache_v1'

let lastScan = null
let selectedCandidate = null
let brands = []
let lastWorkspaceId = null
let selectedBrandKey = ''

function setStatus(msg, cls) {
  const el = $('status')
  el.textContent = msg
  el.className = cls || 'muted'
}

function authHeaders() {
  return {
    Authorization: `Bearer ${$('apiKey').value.trim()}`,
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
        `Brand-universe API missing on this host, or wrong API base.\n` +
        `Use https://fran-skums.vercel.app after deploy, or http://127.0.0.1:3000 for local.`,
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
  if (!res.ok) throw new Error(json.statusMessage || json.message || `HTTP ${res.status}`)
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
  if (!res.ok) throw new Error(json.statusMessage || json.message || `HTTP ${res.status}`)
  return json
}

function needsShop(b) {
  return !b.shop_username || b.shop_resolve_status !== 'confirmed'
}

async function saveSettings() {
  await chrome.storage.sync.set({
    apiBase: apiBase(),
    apiKey: $('apiKey').value.trim(),
  })
  setStatus('Settings saved', 'ok')
}

async function loadSettings() {
  const s = await chrome.storage.sync.get(['apiBase', 'apiKey'])
  $('apiBase').value = s.apiBase || 'https://fran-skums.vercel.app'
  $('apiKey').value = s.apiKey || ''
}

async function persistBrandCache() {
  await chrome.storage.local.set({
    [CACHE_KEY]: {
      brands,
      workspace_id: lastWorkspaceId,
      selectedBrandKey,
      saved_at: Date.now(),
      apiBase: apiBase(),
    },
  })
}

async function restoreBrandCache() {
  const stored = await chrome.storage.local.get([CACHE_KEY])
  const cache = stored[CACHE_KEY]
  if (!cache?.brands?.length) return false

  // Only restore if same API base (avoid wrong env)
  const base = apiBase()
  if (cache.apiBase && base && cache.apiBase !== base) return false

  brands = cache.brands
  lastWorkspaceId = cache.workspace_id || null
  selectedBrandKey = cache.selectedBrandKey || ''
  renderBrandSelect()
  if (selectedBrandKey) $('brandSelect').value = selectedBrandKey
  const need = brands.filter(needsShop).length
  $('brandMeta').textContent =
    `${brands.length} brands cached · ${need} need shop` +
    (lastWorkspaceId ? ` · ws ${lastWorkspaceId.slice(0, 8)}…` : '')
  setStatus(
    `Restored ${brands.length} brands from cache` +
      (cache.saved_at ? ` (${new Date(cache.saved_at).toLocaleString()})` : '') +
      `\nClick Refresh brands if list is stale.`,
    'ok',
  )
  return true
}

function renderBrandSelect() {
  const sel = $('brandSelect')
  const prev = selectedBrandKey || sel.value
  sel.innerHTML = ''
  const opt0 = document.createElement('option')
  opt0.value = ''

  if (!brands.length) {
    opt0.textContent = '— no brands —'
    sel.appendChild(opt0)
    return
  }

  const need = brands.filter(needsShop)
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

  if (prev && [...sel.options].some((o) => o.value === prev)) {
    sel.value = prev
    selectedBrandKey = prev
  }
}

async function loadBrands({ quiet } = {}) {
  if (!$('apiKey').value.trim()) {
    setStatus('Paste API key in Settings, then Save', 'err')
    $('settingsBox').open = true
    return
  }
  if (!quiet) setStatus('Loading brand universe…')
  const data = await apiGet('/api/v1/marketplace/brand-universe?limit=300')
  brands = Array.isArray(data.brands) ? data.brands : []
  lastWorkspaceId = data.workspace_id || null

  if (!brands.length) {
    renderBrandSelect()
    await persistBrandCache()
    setStatus(
      `0 brands for workspace ${lastWorkspaceId || '(unknown)'}.\n` +
        `Use a key for the workspace where brands were imported.`,
      'err',
    )
    return
  }

  renderBrandSelect()
  await persistBrandCache()
  const need = brands.filter(needsShop).length
  $('brandMeta').textContent =
    `${brands.length} brands · ${need} need shop` +
    (lastWorkspaceId ? ` · ${lastWorkspaceId}` : '')
  setStatus(`Loaded ${brands.length} brands (${need} need shop)`, 'ok')
}

function renderCandidates(scan) {
  const box = $('candidates')
  if (!scan?.candidates?.length) {
    box.innerHTML = `<div class="muted">No shop candidates (${scan?.page_kind || '?'}). Open a Mall shop or brand SERP.</div>`
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
          <span class="muted">${escapeHtml(c.shop_name || '')} ${escapeHtml(c.shop_url || '')}</span>
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function getActiveShopeeTab() {
  // Prefer focused window active tab if Shopee; else any shopee tab
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (active?.id && active.url && /shopee\.sg/i.test(active.url)) return active

  const tabs = await chrome.tabs.query({ url: ['https://shopee.sg/*', 'https://*.shopee.sg/*'] })
  if (tabs.length) return tabs[tabs.length - 1]
  return null
}

async function scanActiveTab() {
  const tab = await getActiveShopeeTab()
  if (!tab?.id) {
    setStatus('No Shopee tab found — open shopee.sg in this browser', 'err')
    return
  }
  setStatus(`Scanning: ${tab.title || tab.url}…`)
  let res
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'SKUMS_SCAN_PAGE' })
  } catch (e) {
    // Content script may not be injected yet — inject and retry
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      })
      res = await chrome.tabs.sendMessage(tab.id, { type: 'SKUMS_SCAN_PAGE' })
    } catch (e2) {
      setStatus(
        'Scan failed — reload the Shopee tab, then Scan again.\n' + (e2?.message || e?.message || ''),
        'err',
      )
      return
    }
  }
  if (!res?.ok) {
    setStatus(res?.error || 'Scan failed', 'err')
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
    if (match) {
      $('brandSelect').value = match.brand_key
      selectedBrandKey = match.brand_key
      await persistBrandCache()
    }
  }

  if (lastScan.page_kind === 'shop' && brands.length) {
    const title = (lastScan.page_title || '').toLowerCase()
    const match = brands.find((b) => title.includes(String(b.display_name).toLowerCase()))
    if (match) {
      $('brandSelect').value = match.brand_key
      selectedBrandKey = match.brand_key
      await persistBrandCache()
    }
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

  return apiPost('/api/v1/marketplace/brand-universe/resolve-shop', {
    brand_key,
    status: 'confirmed',
    source: payload.source || 'manual',
    shop_url: payload.shop_url || undefined,
    shop_username: payload.shop_username || undefined,
    shop_id: payload.shop_id || undefined,
    evidence: {
      via: 'chrome_extension_side_panel',
      page_url: lastScan?.page_url || null,
      page_kind: lastScan?.page_kind || null,
      ...(payload.evidence || {}),
    },
  })
}

$('btnSave').addEventListener('click', () => saveSettings().catch((e) => setStatus(e.message, 'err')))
$('btnLoadBrands').addEventListener('click', () =>
  loadBrands().catch((e) => setStatus(String(e.message || e), 'err')),
)
$('btnScan').addEventListener('click', () => scanActiveTab().catch((e) => setStatus(e.message, 'err')))

$('brandSelect').addEventListener('change', async () => {
  selectedBrandKey = $('brandSelect').value
  await persistBrandCache()
})

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
    setStatus(`Confirmed @${data.brand?.shop_username} for ${data.brand?.brand_key}`, 'ok')
    await loadBrands({ quiet: true })
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
      shop_url: raw.includes('/') || raw.includes('shopee') ? raw : undefined,
      shop_username: raw.includes('/') || raw.includes('shopee') ? undefined : raw,
      source: 'manual',
    })
    setStatus(`Confirmed @${data.brand?.shop_username} for ${data.brand?.brand_key}`, 'ok')
    await loadBrands({ quiet: true })
  } catch (e) {
    setStatus(e.message, 'err')
  }
})

// Boot: settings → restore cache → auto-fetch if key set and cache empty
;(async () => {
  try {
    await loadSettings()
    const restored = await restoreBrandCache()
    if (!restored && $('apiKey').value.trim()) {
      await loadBrands({ quiet: true })
    } else if (!$('apiKey').value.trim()) {
      $('settingsBox').open = true
      setStatus('Open Settings, paste API key, Save, then Refresh brands', 'muted')
    }
  } catch (e) {
    setStatus(String(e.message || e), 'err')
    $('settingsBox').open = true
  }
})()
