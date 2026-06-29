import { createHash } from 'node:crypto'
import type { InboundShipmentRequest, StoreReplenishmentOrder } from '../_types'
import {
  mapInboundShipmentToWorldsyntechPayload,
  mapStoreReplenishmentToWorldsyntechPayload,
} from './mapping'
import type {
  NormalizedWorldsyntechCredentials,
  WorldsyntechCredentials,
  WorldsyntechEnvelope,
  WorldsyntechInventoryRecord,
  WorldsyntechPageOptions,
  WorldsyntechProduct,
  WorldsyntechReferenceData,
  WorldsyntechTokenData,
} from './types'

export type { WorldsyntechCredentials } from './types'

const DEFAULT_LANGUAGE_ID = 1
const DEFAULT_PAGE_LIMIT = 250
const TOKEN_SKEW_MS = 60_000

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function asInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function tokenExpiresAt(credentials: WorldsyntechCredentials): Date | undefined {
  if (!credentials.expires_at) return undefined
  const date = new Date(String(credentials.expires_at))
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function normalizeWorldsyntechCredentials(credentials: WorldsyntechCredentials): NormalizedWorldsyntechCredentials {
  const rawBaseUrl = String(credentials.base_url || '').trim()
  const basicToken = String(credentials.basic_token || '').trim()
  const userName = String(credentials.user_name || '').trim()
  const password = String(credentials.password || '').trim()

  if (!rawBaseUrl) throw new Error('WorldSyntech/OFS base_url is required')
  if (!basicToken) throw new Error('WorldSyntech/OFS basic_token is required')
  if (!userName) throw new Error('WorldSyntech/OFS user_name is required')
  if (!password) throw new Error('WorldSyntech/OFS password is required')

  const baseUrl = new URL(/^https?:\/\//i.test(rawBaseUrl) ? rawBaseUrl : `https://${rawBaseUrl}`)
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, '/')

  if (baseUrl.protocol !== 'https:' && !isLocalHost(baseUrl.hostname)) {
    throw new Error('WorldSyntech/OFS base_url must use HTTPS')
  }

  return {
    baseUrl,
    basicToken,
    userName,
    password,
    languageId: asInteger(credentials.language_id, DEFAULT_LANGUAGE_ID),
    accessToken: String(credentials.access_token || '').trim() || undefined,
    expiresAt: tokenExpiresAt(credentials),
  }
}

function buildRouteUrl(baseUrl: URL, route: string): URL {
  const url = new URL('index.php', baseUrl)
  url.searchParams.set('route', route)
  if (route === 'rest_customer/customer_security/api_login') {
    url.searchParams.set('grant_type', 'client_credentials')
  }
  return url
}

function envelopeOk(success: unknown): boolean {
  return success === true || success === 1 || success === '1'
}

function errorMessage(error: unknown): string {
  if (Array.isArray(error)) return error.map(String).filter(Boolean).join(', ') || 'Remote validation failed'
  if (error && typeof error === 'object') return JSON.stringify(error)
  return String(error || 'Remote validation failed')
}

async function parseWorldsyntechResponse<T>(response: Response): Promise<WorldsyntechEnvelope<T>> {
  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`WorldSyntech/OFS returned non-JSON response: ${text.slice(0, 240)}`)
    }
  }

  if (!response.ok) {
    throw new Error(`WorldSyntech/OFS API ${response.status}: ${text.slice(0, 240) || response.statusText}`)
  }

  const envelope = parsed as WorldsyntechEnvelope<T>
  if (!envelopeOk(envelope?.success)) {
    throw new Error(`WorldSyntech/OFS rejected request: ${errorMessage(envelope?.error)}`)
  }
  return envelope
}

export async function loginWorldsyntech(credentials: WorldsyntechCredentials): Promise<WorldsyntechCredentials> {
  const normalized = normalizeWorldsyntechCredentials(credentials)
  const response = await fetch(buildRouteUrl(normalized.baseUrl, 'rest_customer/customer_security/api_login'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${normalized.basicToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'SKUMS WorldSyntech OFS Connector/1.0',
    },
    body: JSON.stringify({
      user_name: normalized.userName,
      password: normalized.password,
    }),
  })

  const envelope = await parseWorldsyntechResponse<WorldsyntechTokenData | WorldsyntechTokenData[]>(response)
  const tokenData = Array.isArray(envelope.data) ? envelope.data[0] : envelope.data
  const accessToken = String(tokenData?.access_token || '').trim()
  if (!accessToken) throw new Error('WorldSyntech/OFS token response did not include access_token')

  const expiresInSeconds = asInteger(tokenData?.expires_in, 0)
  const expiresAt = expiresInSeconds > 0
    ? new Date(Date.now() + expiresInSeconds * 1000)
    : undefined

  return {
    ...credentials,
    access_token: accessToken,
    token_type: String(tokenData?.token_type || 'Bearer'),
    expires_at: expiresAt?.toISOString(),
    customer_id: tokenData?.customer_id,
    username: tokenData?.username,
    email: tokenData?.email,
  }
}

export async function ensureWorldsyntechToken(credentials: WorldsyntechCredentials): Promise<WorldsyntechCredentials> {
  const normalized = normalizeWorldsyntechCredentials(credentials)
  const hasUsableToken = normalized.accessToken
    && (!normalized.expiresAt || normalized.expiresAt.getTime() - TOKEN_SKEW_MS > Date.now())

  return hasUsableToken ? credentials : loginWorldsyntech(credentials)
}

export async function fetchWorldsyntechApi<T>(
  credentials: WorldsyntechCredentials,
  route: string,
  body: Record<string, unknown> = {},
): Promise<{ data: T; credentials: WorldsyntechCredentials; raw: WorldsyntechEnvelope<T> }> {
  const nextCredentials = await ensureWorldsyntechToken(credentials)
  const normalized = normalizeWorldsyntechCredentials(nextCredentials)
  if (!normalized.accessToken) throw new Error('WorldSyntech/OFS access token is missing')

  const response = await fetch(buildRouteUrl(normalized.baseUrl, route), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${normalized.accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'SKUMS WorldSyntech OFS Connector/1.0',
    },
    body: JSON.stringify(body),
  })

  const envelope = await parseWorldsyntechResponse<T>(response)
  return { data: envelope.data, credentials: nextCredentials, raw: envelope }
}

function pageBody(options: WorldsyntechPageOptions = {}) {
  return {
    language_id: options.language_id ?? DEFAULT_LANGUAGE_ID,
    offset: Math.max(asInteger(options.offset, 0), 0),
    limit: Math.min(Math.max(asInteger(options.limit, DEFAULT_PAGE_LIMIT), 1), DEFAULT_PAGE_LIMIT),
    status: options.status ?? 1,
  }
}

export async function fetchWorldsyntechProductsPage(
  credentials: WorldsyntechCredentials,
  options: WorldsyntechPageOptions = {},
) {
  const body = pageBody(options)
  const result = await fetchWorldsyntechApi<WorldsyntechProduct[]>(
    credentials,
    'rest_customer/product/get_list',
    body,
  )
  const records = Array.isArray(result.data) ? result.data : []
  return {
    ...result,
    records,
    offset: body.offset,
    limit: body.limit,
    has_more: records.length >= body.limit,
    next_cursor: records.length >= body.limit ? String(body.offset + body.limit) : undefined,
  }
}

export async function fetchWorldsyntechInventoryPage(
  credentials: WorldsyntechCredentials,
  options: WorldsyntechPageOptions = {},
) {
  const body = {
    ...pageBody(options),
    hit_stock_alert: 0,
    sort_by: 'available',
  }
  const result = await fetchWorldsyntechApi<WorldsyntechInventoryRecord[]>(
    credentials,
    'rest_customer/inventory/get_list',
    body,
  )
  const records = Array.isArray(result.data) ? result.data : []
  return {
    ...result,
    records,
    offset: body.offset,
    limit: body.limit,
    has_more: records.length >= body.limit,
    next_cursor: records.length >= body.limit ? String(body.offset + body.limit) : undefined,
  }
}

async function fetchPagedReference(
  credentials: WorldsyntechCredentials,
  route: string,
  maxPages = 5,
  limit = DEFAULT_PAGE_LIMIT,
) {
  const records: Record<string, unknown>[] = []
  let nextCredentials = credentials
  for (let page = 0; page < maxPages; page++) {
    const offset = page * limit
    const result = await fetchWorldsyntechApi<Record<string, unknown>[]>(
      nextCredentials,
      route,
      { offset, limit },
    )
    nextCredentials = result.credentials
    const pageRecords = Array.isArray(result.data) ? result.data : []
    records.push(...pageRecords)
    if (pageRecords.length < limit) break
  }
  return { records, credentials: nextCredentials }
}

export async function fetchWorldsyntechReferenceData(
  credentials: WorldsyntechCredentials,
  options: { maxPages?: number; limit?: number } = {},
): Promise<{ data: WorldsyntechReferenceData; credentials: WorldsyntechCredentials }> {
  const maxPages = Math.min(Math.max(asInteger(options.maxPages, 5), 1), 25)
  const limit = Math.min(Math.max(asInteger(options.limit, DEFAULT_PAGE_LIMIT), 1), DEFAULT_PAGE_LIMIT)
  let nextCredentials = await ensureWorldsyntechToken(credentials)

  const addressResult = await fetchWorldsyntechApi<Record<string, unknown>[]>(
    nextCredentials,
    'rest_customer/address/get_list',
    {},
  )
  nextCredentials = addressResult.credentials

  const countries = await fetchPagedReference(nextCredentials, 'rest_customer/country/get_list', maxPages, limit)
  nextCredentials = countries.credentials
  const zones = await fetchPagedReference(nextCredentials, 'rest_customer/zone/get_list', maxPages, limit)
  nextCredentials = zones.credentials
  const deliveryMethods = await fetchPagedReference(nextCredentials, 'rest_customer/delivery_method/get_list', maxPages, limit)
  nextCredentials = deliveryMethods.credentials

  return {
    credentials: nextCredentials,
    data: {
      addresses: Array.isArray(addressResult.data) ? addressResult.data : [],
      countries: countries.records,
      zones: zones.records,
      delivery_methods: deliveryMethods.records,
    },
  }
}

export async function createWorldsyntechStoreReplenishmentOrder(
  credentials: WorldsyntechCredentials,
  order: StoreReplenishmentOrder,
) {
  return fetchWorldsyntechApi<Record<string, unknown>>(
    credentials,
    'rest_customer/order/create',
    mapStoreReplenishmentToWorldsyntechPayload(order, credentials),
  )
}

export async function createWorldsyntechInboundShipment(
  credentials: WorldsyntechCredentials,
  shipment: InboundShipmentRequest,
) {
  return fetchWorldsyntechApi<Record<string, unknown>[]>(
    credentials,
    'rest_customer/ship_to_warehouse/create',
    mapInboundShipmentToWorldsyntechPayload(shipment),
  )
}

export function stableWorldsyntechHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function testWorldsyntechCredentials(credentials: WorldsyntechCredentials) {
  const nextCredentials = await loginWorldsyntech(credentials)
  const result = await fetchWorldsyntechApi<Record<string, unknown>>(
    nextCredentials,
    'rest_customer/customer/user_get',
    {},
  )
  const user = result.data || {}
  return {
    ok: true,
    credentials: result.credentials,
    details: `Connected to WorldSyntech/OFS${user.email ? ` as ${String(user.email)}` : ''}.`,
  }
}
