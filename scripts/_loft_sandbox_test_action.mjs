/**
 * Perform one visible write action on Loft demo3 sandbox so it can be
 * inspected in the merchant dashboard.
 *
 * Action: create a clearly labeled test product, then create a ship_to_warehouse
 * inbound notice for that SKU (派送去仓库).
 *
 * Usage: node scripts/_loft_sandbox_test_action.mjs
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

const base = String(process.env.LOFT_SANDBOX_BASE_URL || 'https://orderfulfillmentdemo3.worldsyntech.com').replace(/\/+$/, '')
const basicToken = String(process.env.LOFT_SANDBOX_TOKEN || '').trim()
const userName = String(process.env.LOFT_SANDBOX_USER || 'Fra01testingaccount').trim()
const password = String(process.env.LOFT_SANDBOX_PASSWORD || '123456').trim()

if (!basicToken) {
  console.error('Missing LOFT_SANDBOX_TOKEN')
  process.exit(1)
}

function routeUrl(route, extra = {}) {
  const url = new URL('index.php', `${base}/`)
  url.searchParams.set('route', route)
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
  return url
}

async function api(accessToken, route, body = {}, extra = {}) {
  const res = await fetch(routeUrl(route, extra), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'SKUMS WorldSyntech OFS Connector/1.0',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // ignore
  }
  const ok = res.ok && (json?.success === 1 || json?.success === true || json?.success === '1')
  return { ok, status: res.status, json, text: text.slice(0, 800) }
}

// unique markers for dashboard search
const stamp = new Date()
const stampTag = stamp.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) // YYYYMMDDHHmmss
const sku = `SKUMS-TEST-${stampTag}`
const productName = `SKUMS sandbox probe ${stampTag}`
const trackingNumber = `SKUMS-ASN-${stampTag}`
const orderRef = `SKUMS-ORD-${stampTag}`

console.log('=== Loft demo3 sandbox WRITE test ===')
console.log('base:', base)
console.log('markers you can search in the dashboard:')
console.log('  SKU:             ', sku)
console.log('  Product name:    ', productName)
console.log('  ASN tracking:    ', trackingNumber)
console.log('  Order reference: ', orderRef)
console.log('')

// login
const loginRes = await fetch(routeUrl('rest_customer/customer_security/api_login', { grant_type: 'client_credentials' }), {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    Authorization: `Basic ${basicToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'SKUMS WorldSyntech OFS Connector/1.0',
  },
  body: JSON.stringify({ user_name: userName, password }),
})
const loginJson = await loginRes.json()
const tokenData = Array.isArray(loginJson.data) ? loginJson.data[0] : loginJson.data
const accessToken = tokenData?.access_token
if (!accessToken) {
  console.error('Login failed:', loginJson)
  process.exit(2)
}
console.log('login OK customer_id=', tokenData.customer_id, 'username=', tokenData.username)

// 1) Create product (most visible: 商品管理)
// Apidoc-style fields from WORLDSYNTECH plan + common OFS shapes
const productPayload = {
  products: [
    {
      product_name: productName,
      product_description: `Created by SKUMS sandbox smoke at ${stamp.toISOString()}. Safe to delete.`,
      sku,
      upc: `UPC${stampTag.slice(-12)}`,
      supplier_sku: sku,
      variation: '',
      price: '1.00',
      cost: '0.50',
      length: '10',
      width: '10',
      height: '5',
      weight: '0.1',
      status: 1,
      quantity: 0,
      image: '',
    },
  ],
}

console.log('\n--- product/create ---')
let productCreate = await api(accessToken, 'rest_customer/product/create', productPayload)
if (!productCreate.ok) {
  // try non-array single-product body
  console.log('array body failed:', productCreate.status, productCreate.text.slice(0, 300))
  productCreate = await api(accessToken, 'rest_customer/product/create', productPayload.products[0])
}
console.log('status', productCreate.status, 'ok', productCreate.ok)
console.log(JSON.stringify(productCreate.json, null, 2)?.slice(0, 1200))

// resolve product_id from create response or list
let productId =
  productCreate.json?.data?.product_id ||
  productCreate.json?.data?.[0]?.product_id ||
  productCreate.json?.data?.products?.[0]?.product_id ||
  null

if (!productId) {
  console.log('\n--- product/get_list lookup by sku ---')
  const list = await api(accessToken, 'rest_customer/product/get_list', {
    language_id: 1,
    offset: 0,
    limit: 50,
    status: 1,
  })
  const rows = Array.isArray(list.json?.data) ? list.json.data : []
  const hit = rows.find((p) => String(p.sku || '') === sku || String(p.product_name || '').includes(stampTag))
  console.log('list count', rows.length, 'hit', hit ? { product_id: hit.product_id, sku: hit.sku, name: hit.product_name } : null)
  productId = hit?.product_id || null
}

// 2) ship_to_warehouse create — visible under 派送去仓库
const asnPayload = {
  shipments: [
    {
      products: [
        {
          product_id: Number(productId || 0),
          sku,
          quantity: 2,
          product_name: productName,
          product_price: '1.00',
          product_dimension: '10x10x5',
          product_weight: '0.1',
          product_description:
            `SKUMS sandbox ASN line\n` +
            JSON.stringify({
              v: 1,
              src: 'skums',
              kind: 'inbound_line',
              tracking_number: trackingNumber,
              sku,
              note: 'sandbox_probe',
            }),
        },
      ],
      tracking_number: trackingNumber,
      date_estimate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    },
  ],
}

console.log('\n--- ship_to_warehouse/create ---')
console.log('using product_id=', productId || 0)
const asn = await api(accessToken, 'rest_customer/ship_to_warehouse/create', asnPayload)
console.log('status', asn.status, 'ok', asn.ok)
console.log(JSON.stringify(asn.json, null, 2)?.slice(0, 1200))

// 3) optional order only if we have product + a delivery method (outbound 运单)
let order = null
if (productId) {
  const dm = await api(accessToken, 'rest_customer/delivery_method/get_list', { offset: 0, limit: 20 })
  const methods = Array.isArray(dm.json?.data) ? dm.json.data : []
  const methodId = methods[0]?.delivery_method_id
  console.log('\n--- order/create (store replenishment style) ---')
  console.log('delivery_method_id=', methodId, 'from', methods[0]?.delivery_compeny_name || methods[0]?.delivery_method_name)
  if (methodId) {
    const orderPayload = {
      orders: [
        {
          reference_no: orderRef,
          atomic_order_id: orderRef,
          marketplace_code: 'skums_sandbox_probe',
          shipping_address_detail: {
            address_id: 0,
            address: 'SKUMS test store door, 04-1A Krislite Building',
            name: 'SKUMS Test Store',
            city: 'Singapore',
            postcode: '408564',
            country_id: 188, // often SG; may need adjust
            zone_id: 0,
            company: 'LISE/SKUMS',
            telephone: '6500000000',
          },
          payment_address_detail: {
            address_id: 0,
            address: 'SKUMS test store door, 04-1A Krislite Building',
            name: 'SKUMS Test Store',
            city: 'Singapore',
            postcode: '408564',
            country_id: 188,
            zone_id: 0,
            company: 'LISE/SKUMS',
            telephone: '6500000000',
          },
          order_products: [
            {
              product_id: Number(productId),
              sku,
              quantity: 1,
            },
          ],
          delivery_method_id: Number(methodId),
          order_comment: `SKUMS sandbox probe order ${stampTag} — safe to cancel`,
          cod_total: 0,
          tracking_no: '',
          airwaybill: '',
        },
      ],
    }
    order = await api(accessToken, 'rest_customer/order/create', orderPayload)
    console.log('status', order.status, 'ok', order.ok)
    console.log(JSON.stringify(order.json, null, 2)?.slice(0, 1200))
  }
}

console.log('\n========== DASHBOARD INSPECTION ==========')
console.log('Portal: https://orderfulfillmentdemo3.worldsyntech.com/')
console.log('Login:  merchant / Fra01testingaccount')
console.log('')
console.log('What we attempted:')
console.log(`  1) PRODUCT  name="${productName}"  sku=${sku}`)
console.log(`     → 商品管理 / product_manage`)
console.log(`     create ok=${productCreate.ok} product_id=${productId || '(unknown)'}`)
console.log(`  2) INBOUND ASN  tracking=${trackingNumber}`)
console.log(`     → 派送去仓库 / ship_to_warehouse`)
console.log(`     create ok=${asn.ok}`)
if (order) {
  console.log(`  3) ORDER  reference_no=${orderRef}`)
  console.log(`     → 运单记录 / order`)
  console.log(`     create ok=${order.ok}`)
}
console.log('')
console.log('Search the dashboard for stamp:', stampTag)
console.log('or SKU prefix: SKUMS-TEST-')

const anyOk = productCreate.ok || asn.ok || order?.ok
process.exit(anyOk ? 0 : 3)
