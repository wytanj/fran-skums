import { createHash } from 'node:crypto'
import type {
  HanshowArticle,
  HanshowArticlePage,
  HanshowCredentials,
  HanshowEnvelope,
  HanshowFlashControl,
  HanshowLabelLink,
  HanshowPageSwitch,
  HanshowTokenData,
  NormalizedHanshowCredentials,
} from './types'

export type { HanshowCredentials } from './types'

export const HANSHOW_DEFAULT_BASE_URL = 'https://ap-allstar.hanshowcloud.net'
const TOKEN_SKEW_MS = 60_000
const USER_AGENT = 'SKUMS Hanshow All-Star Connector/0.1'

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function tokenExpiresAt(credentials: HanshowCredentials): Date | undefined {
  if (!credentials.expires_at) return undefined
  const date = new Date(String(credentials.expires_at))
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** Spec HS-ALLSTAR-V220005: MD5(password + username), 32-bit uppercase. */
export function hashHanshowPassword(password: string, username: string): string {
  return createHash('md5').update(`${password}${username}`, 'utf8').digest('hex').toUpperCase()
}

export function hanshowSuccess(envelope: HanshowEnvelope | null | undefined): boolean {
  if (!envelope) return false
  const code = envelope.resultCode ?? envelope.code
  if (code === 1001 || code === '1001') return true
  const result = String(envelope.result || '').toLowerCase()
  return result === 'success' || result === 'succeed'
}

export function normalizeHanshowCredentials(credentials: HanshowCredentials): NormalizedHanshowCredentials {
  const rawBaseUrl = String(credentials.base_url || HANSHOW_DEFAULT_BASE_URL).trim()
  const username = String(credentials.username || '').trim()
  const password = String(credentials.password || '').trim()
  const clientId = String(credentials.client_id || '').trim()
  const clientSecret = String(credentials.client_secret || '').trim()

  if (!rawBaseUrl) throw new Error('Hanshow All-Star base_url is required')
  if (!username) throw new Error('Hanshow All-Star username is required')
  if (!password) throw new Error('Hanshow All-Star password is required')
  if (!clientId) throw new Error('Hanshow All-Star client_id is required (issued by Hanshow, not the web login)')
  if (!clientSecret) throw new Error('Hanshow All-Star client_secret is required (issued by Hanshow)')

  const baseUrl = new URL(/^https?:\/\//i.test(rawBaseUrl) ? rawBaseUrl : `https://${rawBaseUrl}`)
  baseUrl.pathname = '/'
  baseUrl.search = ''
  baseUrl.hash = ''

  if (baseUrl.protocol !== 'https:' && !isLocalHost(baseUrl.hostname)) {
    throw new Error('Hanshow All-Star base_url must use HTTPS')
  }

  const org = String(credentials.org || '').trim() || undefined
  const terminal = String(credentials.terminal || '').trim() || undefined
  const customerCode = String(credentials.customer_code || org || '').trim() || undefined
  const storeCode = String(credentials.store_code || terminal || '').trim() || undefined

  return {
    baseUrl,
    username,
    password,
    clientId,
    clientSecret,
    org,
    terminal,
    customerCode,
    storeCode,
    accessToken: String(credentials.access_token || '').trim() || undefined,
    refreshToken: String(credentials.refresh_token || '').trim() || undefined,
    expiresAt: tokenExpiresAt(credentials),
  }
}

function joinUrl(baseUrl: URL, path: string): URL {
  return new URL(path.replace(/^\/+/, '/'), baseUrl)
}

function basicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')
}

function asInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function errorMessage(envelope: HanshowEnvelope | null | undefined, fallback: string): string {
  return String(envelope?.message || envelope?.result || fallback)
}

async function parseHanshowResponse<T>(response: Response): Promise<HanshowEnvelope<T>> {
  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`Hanshow All-Star returned non-JSON response: ${text.slice(0, 240)}`)
    }
  }

  const envelope = (parsed || {}) as HanshowEnvelope<T>
  if (!response.ok) {
    throw new Error(`Hanshow All-Star API ${response.status}: ${errorMessage(envelope, text.slice(0, 240) || response.statusText)}`)
  }
  if (!hanshowSuccess(envelope)) {
    throw new Error(`Hanshow All-Star rejected request: ${errorMessage(envelope, 'Remote validation failed')}`)
  }
  return envelope
}

function withTokens(credentials: HanshowCredentials, token: HanshowTokenData): HanshowCredentials {
  const accessToken = String(token.access_token || '').trim()
  if (!accessToken) throw new Error('Hanshow All-Star token response did not include access_token')
  const expiresInSeconds = asInteger(token.expires_in, 0)
  return {
    ...credentials,
    access_token: accessToken,
    refresh_token: String(token.refresh_token || credentials.refresh_token || '').trim() || undefined,
    token_type: String(token.token_type || 'bearer'),
    expires_at: expiresInSeconds > 0
      ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
      : credentials.expires_at,
  }
}

export async function loginHanshow(credentials: HanshowCredentials): Promise<HanshowCredentials> {
  const normalized = normalizeHanshowCredentials(credentials)
  const body = new URLSearchParams({
    username: normalized.username,
    password: hashHanshowPassword(normalized.password, normalized.username),
    grant_type: 'password',
  })

  const response = await fetch(joinUrl(normalized.baseUrl, '/proxy/allstar/oauth/token'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${basicAuth(normalized.clientId, normalized.clientSecret)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body,
  })

  const envelope = await parseHanshowResponse<HanshowTokenData>(response)
  return withTokens(credentials, envelope.data || {})
}

export async function refreshHanshow(credentials: HanshowCredentials): Promise<HanshowCredentials> {
  const normalized = normalizeHanshowCredentials(credentials)
  if (!normalized.refreshToken) return loginHanshow(credentials)

  const body = new URLSearchParams({
    refresh_token: normalized.refreshToken,
    grant_type: 'refresh_token',
  })

  const response = await fetch(joinUrl(normalized.baseUrl, '/proxy/allstar/oauth/token'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${basicAuth(normalized.clientId, normalized.clientSecret)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body,
  })

  const envelope = await parseHanshowResponse<HanshowTokenData>(response)
  return withTokens(credentials, envelope.data || {})
}

export async function ensureHanshowToken(credentials: HanshowCredentials): Promise<HanshowCredentials> {
  const normalized = normalizeHanshowCredentials(credentials)
  const hasUsableToken = normalized.accessToken
    && (!normalized.expiresAt || normalized.expiresAt.getTime() - TOKEN_SKEW_MS > Date.now())
  if (hasUsableToken) return credentials
  if (normalized.refreshToken) {
    try {
      return await refreshHanshow(credentials)
    } catch {
      return loginHanshow(credentials)
    }
  }
  return loginHanshow(credentials)
}

async function hanshowRequest<T>(
  credentials: HanshowCredentials,
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; credentials: HanshowCredentials; raw: HanshowEnvelope<T> }> {
  const nextCredentials = await ensureHanshowToken(credentials)
  const normalized = normalizeHanshowCredentials(nextCredentials)
  if (!normalized.accessToken) throw new Error('Hanshow All-Star access token is missing')

  const response = await fetch(joinUrl(normalized.baseUrl, path), {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${normalized.accessToken}`,
      'User-Agent': USER_AGENT,
      ...(init.body ? { 'Content-Type': 'application/json;charset=utf-8' } : {}),
      ...(init.headers || {}),
    },
  })

  const envelope = await parseHanshowResponse<T>(response)
  return { data: envelope.data as T, credentials: nextCredentials, raw: envelope }
}

function requireOrgTerminal(credentials: HanshowCredentials): { org: string; terminal: string } {
  const org = String(credentials.org || '').trim()
  const terminal = String(credentials.terminal || '').trim()
  if (!org) throw new Error('Hanshow org (customer code) is required')
  if (!terminal) throw new Error('Hanshow terminal (store number) is required')
  return { org, terminal }
}

function requireStoreCodes(credentials: HanshowCredentials): { customerCode: string; storeCode: string } {
  const customerCode = String(credentials.customer_code || credentials.org || '').trim()
  const storeCode = String(credentials.store_code || credentials.terminal || '').trim()
  if (!customerCode) throw new Error('Hanshow customer_code / org is required')
  if (!storeCode) throw new Error('Hanshow store_code / terminal is required')
  return { customerCode, storeCode }
}

export async function testHanshowCredentials(credentials: HanshowCredentials): Promise<{
  credentials: HanshowCredentials
  details: {
    token: boolean
    org?: string
    terminal?: string
    article_count?: number
    article_probe?: 'skipped' | 'ok' | 'failed'
    article_probe_error?: string
    blocked: string[]
  }
}> {
  const loggedIn = await loginHanshow(credentials)
  const details: {
    token: boolean
    org?: string
    terminal?: string
    article_count?: number
    article_probe?: 'skipped' | 'ok' | 'failed'
    article_probe_error?: string
    blocked: string[]
  } = {
    token: true,
    org: loggedIn.org || undefined,
    terminal: loggedIn.terminal || undefined,
    article_probe: 'skipped',
    blocked: [
      'article_create_update — waiting on Hanshow article import/update spec',
      'shelf_refresh — waiting on a store Hanshow AP + ESL online',
    ],
  }

  if (loggedIn.org && loggedIn.terminal) {
    try {
      const page = await queryHanshowArticlesPage(loggedIn, { pageNum: 1, pageSize: 1 })
      details.article_probe = 'ok'
      details.article_count = page.page.count ?? page.page.pageData?.length ?? 0
      return { credentials: page.credentials, details }
    } catch (error: any) {
      details.article_probe = 'failed'
      details.article_probe_error = error?.message || 'Article query failed'
    }
  }

  return { credentials: loggedIn, details }
}

export async function queryHanshowArticlesByIds(
  credentials: HanshowCredentials,
  ids: string[],
): Promise<{ articles: HanshowArticle[]; credentials: HanshowCredentials }> {
  const { org, terminal } = requireOrgTerminal(credentials)
  const cleaned = ids.map(id => String(id || '').trim()).filter(Boolean)
  if (!cleaned.length) throw new Error('At least one SKU / article id is required')
  const path = `/proxy/allstar/v2/pda/articles/${encodeURIComponent(org)}/${encodeURIComponent(terminal)}/ids?ids=${encodeURIComponent(cleaned.join(','))}`
  const result = await hanshowRequest<HanshowArticle[]>(credentials, path, { method: 'GET' })
  return { articles: Array.isArray(result.data) ? result.data : [], credentials: result.credentials }
}

export async function queryHanshowArticlesPage(
  credentials: HanshowCredentials,
  opts: {
    pageNum?: number
    pageSize?: number
    indexes?: string
    matchRule?: 'ALL' | 'RIGHT'
  } = {},
): Promise<{ page: HanshowArticlePage; credentials: HanshowCredentials }> {
  const { org, terminal } = requireOrgTerminal(credentials)
  const params = new URLSearchParams()
  params.set('pageNum', String(Math.max(asInteger(opts.pageNum, 1), 1)))
  params.set('pageSize', String(Math.min(Math.max(asInteger(opts.pageSize, 10), 1), 1000)))
  if (opts.indexes) params.set('indexes', opts.indexes)
  if (opts.matchRule) params.set('matchRule', opts.matchRule)
  const path = `/proxy/allstar/v2/pda/articles/${encodeURIComponent(org)}/${encodeURIComponent(terminal)}/indexes?${params}`
  const result = await hanshowRequest<HanshowArticlePage>(credentials, path, { method: 'GET' })
  return { page: result.data || {}, credentials: result.credentials }
}

export async function bindHanshowLabels(
  credentials: HanshowCredentials,
  links: HanshowLabelLink[],
): Promise<{ data: unknown; credentials: HanshowCredentials }> {
  const { customerCode, storeCode } = requireStoreCodes(credentials)
  if (!links.length) throw new Error('At least one ESL ↔ SKU link is required')
  const path = `/proxy/openapi3/store/links?customer-code=${encodeURIComponent(customerCode)}&store-code=${encodeURIComponent(storeCode)}`
  const result = await hanshowRequest(credentials, path, {
    method: 'PUT',
    body: JSON.stringify(links),
  })
  return { data: result.data, credentials: result.credentials }
}

export async function unbindHanshowLabels(
  credentials: HanshowCredentials,
  links: HanshowLabelLink[],
): Promise<{ data: unknown; credentials: HanshowCredentials }> {
  const { customerCode, storeCode } = requireStoreCodes(credentials)
  if (!links.length) throw new Error('At least one ESL or SKU is required to unbind')
  const path = `/proxy/openapi3/store/links?customer-code=${encodeURIComponent(customerCode)}&store-code=${encodeURIComponent(storeCode)}`
  const result = await hanshowRequest(credentials, path, {
    method: 'DELETE',
    body: JSON.stringify(links),
  })
  return { data: result.data, credentials: result.credentials }
}

export async function listHanshowLabelLinks(
  credentials: HanshowCredentials,
  labelIds: string[],
): Promise<{ data: unknown; credentials: HanshowCredentials }> {
  const { customerCode, storeCode } = requireStoreCodes(credentials)
  const cleaned = labelIds.map(id => String(id || '').trim()).filter(Boolean)
  if (!cleaned.length) throw new Error('At least one ESL labelId is required')
  const path = `/proxy/openapi3/store/links/labels/list?customer-code=${encodeURIComponent(customerCode)}&store-code=${encodeURIComponent(storeCode)}`
  const result = await hanshowRequest(credentials, path, {
    method: 'POST',
    body: JSON.stringify({ labelIds: cleaned.map(labelId => ({ labelId })) }),
  })
  return { data: result.data, credentials: result.credentials }
}

export async function flashHanshowByLabel(
  credentials: HanshowCredentials,
  items: Array<{ labelId: string; flash?: HanshowFlashControl; page?: HanshowPageSwitch }>,
): Promise<{ data: unknown; credentials: HanshowCredentials }> {
  const { customerCode, storeCode } = requireStoreCodes(credentials)
  if (!items.length) throw new Error('At least one ESL labelId is required')
  const path = `/proxy/openapi3/store/labels/control?customer-code=${encodeURIComponent(customerCode)}&store-code=${encodeURIComponent(storeCode)}`
  const result = await hanshowRequest(credentials, path, {
    method: 'POST',
    body: JSON.stringify(items.map(item => ({
      labelId: item.labelId,
      controlParam: {
        ...(item.flash ? { flashLight: item.flash } : {}),
        ...(item.page ? { switchPage: item.page } : {}),
      },
    }))),
  })
  return { data: result.data, credentials: result.credentials }
}

export async function flashHanshowBySku(
  credentials: HanshowCredentials,
  items: Array<{ sku: string; flash?: HanshowFlashControl }>,
): Promise<{ data: unknown; credentials: HanshowCredentials }> {
  const { customerCode, storeCode } = requireStoreCodes(credentials)
  if (!items.length) throw new Error('At least one SKU is required')
  // Spec 3.8 uses camelCase query keys, unlike the kebab-case bind/flash-by-id routes.
  const path = `/proxy/openapi3/store/links/articles/control?customerCode=${encodeURIComponent(customerCode)}&storeCode=${encodeURIComponent(storeCode)}`
  const result = await hanshowRequest(credentials, path, {
    method: 'POST',
    body: JSON.stringify(items.map(item => ({
      sku: item.sku,
      controlParam: item.flash ? { flashLight: item.flash } : {},
    }))),
  })
  return { data: result.data, credentials: result.credentials }
}

export function hanshowPushArticlesBlockedMessage(): string {
  return 'Hanshow article create/update is not in HS-ALLSTAR-V220005. Waiting on the article import spec from Hanshow.'
}
