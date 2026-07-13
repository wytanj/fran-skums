/**
 * MCP runtime context: env, Supabase service client, workspace scope.
 *
 * Scope profiles (M0):
 *   FRAN_MCP_PROFILE=safe|full   (default: safe)
 *   FRAN_MCP_SCOPES=safe|full|*|all|comma-list
 *     - empty → use FRAN_MCP_PROFILE (default safe)
 *     - safe / full → named profile
 *     - * / all / full → unrestricted (null)
 *
 * Phase R1: HTTP cloud MCP uses AsyncLocalStorage request context so
 * workspace/scopes come from API key, not process env.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

/**
 * @typedef {{
 *   workspaceId: string,
 *   scopes: string[] | null,
 *   clientName?: string,
 *   actorUserId?: string | null,
 *   cloud?: boolean,
 *   keyId?: string | null,
 *   keyName?: string | null,
 * }} McpRequestContext
 */

/** @type {AsyncLocalStorage<McpRequestContext>} */
export const mcpRequestContext = new AsyncLocalStorage()

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function loadDotEnv() {
  const envPath = resolve(ROOT, '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]] !== undefined) continue
    let v = m[2].trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    process.env[m[1]] = v
  }
}

loadDotEnv()

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let _db = null

/**
 * Named scope profiles for agent safety.
 * safe = draft/propose/read only (no submit/decide/execute/seed-write)
 * full = unrestricted (getMcpScopes returns null)
 */
export const MCP_SCOPE_PROFILES = {
  safe: [
    'intel:read',
    'study:write',
    'pipeline:propose',
    'po:draft',
    'projection:run',
  ],
  /** Explicit list for docs/tests; runtime "full" means unrestricted null */
  full: [
    'intel:read',
    'intel:write',
    'study:write',
    'pipeline:propose',
    'pipeline:decide',
    'pipeline:execute',
    'po:draft',
    'po:submit',
    'po:decide',
    'projection:run',
  ],
}

/** Scopes that mutate live / approve / execute (blocked under safe profile) */
export const MCP_PRIVILEGED_SCOPES = [
  'intel:write',
  'pipeline:decide',
  'pipeline:execute',
  'po:submit',
  'po:decide',
]

export function getRoot() {
  return ROOT
}

export function getXaiApiKey() {
  return process.env.XAI_API_KEY || process.env.xaiApiKey || ''
}

/**
 * @returns {McpRequestContext | null}
 */
export function getMcpRequestContext() {
  return mcpRequestContext.getStore() || null
}

/**
 * Run fn with per-request MCP context (HTTP cloud path).
 * @template T
 * @param {McpRequestContext} ctx
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function runWithMcpRequestContext(ctx, fn) {
  return mcpRequestContext.run(ctx, fn)
}

export function getWorkspaceId() {
  const req = getMcpRequestContext()
  if (req?.workspaceId) return String(req.workspaceId).trim()
  const id =
    process.env.FRAN_MCP_WORKSPACE_ID ||
    process.env.MCP_WORKSPACE_ID ||
    process.env.WORKSPACE_ID ||
    ''
  return id.trim()
}

/**
 * Client label for audit (e.g. cursor, claude-desktop, claude-cloud).
 */
export function getMcpClientName() {
  const req = getMcpRequestContext()
  if (req?.clientName) return String(req.clientName).trim() || 'mcp'
  return (process.env.FRAN_MCP_CLIENT || process.env.MCP_CLIENT || 'mcp').trim() || 'mcp'
}

/**
 * Optional human operator profile UUID for attribution.
 */
export function getMcpActorUserId() {
  const req = getMcpRequestContext()
  if (req && 'actorUserId' in req) return req.actorUserId || null
  const id = (process.env.FRAN_MCP_ACTOR_USER_ID || process.env.MCP_ACTOR_USER_ID || '').trim()
  return id || null
}

export function isCloudMcpRequest() {
  return getMcpRequestContext()?.cloud === true
}

/**
 * Map workspace API key scopes → MCP scopes for cloud.
 * Cloud never grants privileged scopes.
 * @param {string[] | null | undefined} apiKeyScopes
 * @returns {string[]}
 */
export function resolveCloudMcpScopes(apiKeyScopes) {
  const safe = [...MCP_SCOPE_PROFILES.safe]
  const list = Array.isArray(apiKeyScopes) ? apiKeyScopes.map(String) : []

  // Empty = historical full API key → still cloud-safe only
  if (list.length === 0) return safe
  if (list.includes('mcp:safe') || list.includes('mcp:cloud')) return safe

  /** @type {Set<string>} */
  const mapped = new Set()
  for (const s of list) {
    if (safe.includes(s)) mapped.add(s)
    // Map common product API scopes to catalog read
    if (s === 'products:read' || s === 'pos:read') mapped.add('intel:read')
  }

  if (mapped.size === 0) {
    throw new Error(
      'API key has no MCP-compatible scopes. In SKUMS Settings create a "Claude / MCP connector" key (mcp:safe).',
    )
  }

  return [...mapped].filter((s) => !MCP_PRIVILEGED_SCOPES.includes(s))
}

/**
 * @returns {'safe' | 'full' | 'custom'}
 */
export function getMcpProfileName() {
  const scopesRaw = (process.env.FRAN_MCP_SCOPES || process.env.MCP_SCOPES || '').trim().toLowerCase()
  if (scopesRaw === '*' || scopesRaw === 'all' || scopesRaw === 'full') return 'full'
  if (scopesRaw === 'safe') return 'safe'
  if (scopesRaw) return 'custom'
  const profile = (process.env.FRAN_MCP_PROFILE || process.env.MCP_PROFILE || 'safe')
    .trim()
    .toLowerCase()
  if (profile === 'full' || profile === '*' || profile === 'all') return 'full'
  return 'safe'
}

/**
 * Resolved scopes for requireScope.
 * @returns {string[] | null} null means unrestricted (full)
 */
export function getMcpScopes() {
  const req = getMcpRequestContext()
  if (req && 'scopes' in req && req.scopes !== undefined) {
    // Request context always wins (cloud never passes null/full)
    return req.scopes
  }

  const raw = (process.env.FRAN_MCP_SCOPES || process.env.MCP_SCOPES || '').trim()
  const lower = raw.toLowerCase()

  if (lower === '*' || lower === 'all' || lower === 'full') return null
  if (lower === 'safe') return [...MCP_SCOPE_PROFILES.safe]

  if (raw) {
    return raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  // Empty SCOPES → profile (default safe)
  const profile = (process.env.FRAN_MCP_PROFILE || process.env.MCP_PROFILE || 'safe')
    .trim()
    .toLowerCase()
  if (profile === 'full' || profile === '*' || profile === 'all') return null
  if (profile === 'safe' || !profile) return [...MCP_SCOPE_PROFILES.safe]
  // Unknown profile name → treat as safe
  return [...MCP_SCOPE_PROFILES.safe]
}

/**
 * Human-readable scope summary for startup logs.
 */
export function describeMcpScopes() {
  const profile = getMcpProfileName()
  const scopes = getMcpScopes()
  if (scopes == null) {
    return { profile: profile === 'custom' ? 'full' : profile, mode: 'unrestricted', scopes: null }
  }
  return {
    profile,
    mode: profile === 'safe' || scopes.every((s) => MCP_SCOPE_PROFILES.safe.includes(s))
      ? 'safe'
      : 'custom',
    scopes,
  }
}

export function requireScope(scope) {
  // R1: cloud HTTP path never allows privileged ops
  if (isCloudMcpRequest() && MCP_PRIVILEGED_SCOPES.includes(scope)) {
    throw new Error(
      `Cloud MCP blocks privileged scope "${scope}". ` +
        `Submit/decide/execute only in SKUMS Actions UI or local full-profile MCP.`,
    )
  }

  // M2: FRAN_MCP_MODE=safe hard-blocks privileged scopes even if SCOPES misconfigured
  const mode = (process.env.FRAN_MCP_MODE || process.env.MCP_MODE || '').trim().toLowerCase()
  if (mode === 'safe' && MCP_PRIVILEGED_SCOPES.includes(scope)) {
    throw new Error(
      `MCP mode=safe blocks privileged scope "${scope}". ` +
        `Set FRAN_MCP_MODE=full (and full scopes) for submit/decide/execute/seed writes.`,
    )
  }

  const scopes = getMcpScopes()
  if (scopes == null) return
  if (!scopes.includes(scope)) {
    const profile = isCloudMcpRequest() ? 'cloud-safe' : getMcpProfileName()
    throw new Error(
      `MCP scope denied: need "${scope}" (profile=${profile}). ` +
        `Safe profile cannot submit/decide/execute or write crawl seeds. ` +
        (isCloudMcpRequest()
          ? 'Use SKUMS Actions for privileged steps.'
          : 'Set FRAN_MCP_PROFILE=full or FRAN_MCP_SCOPES=full for privileged ops.'),
    )
  }
}

/**
 * M2 dual gate: mode + scopes. Prefer calling requireScope which already checks mode.
 * @returns {'safe'|'full'}
 */
export function getMcpMode() {
  const mode = (process.env.FRAN_MCP_MODE || process.env.MCP_MODE || '').trim().toLowerCase()
  if (mode === 'full') return 'full'
  if (mode === 'safe') return 'safe'
  // Align with profile when MODE unset
  return getMcpProfileName() === 'full' ? 'full' : 'safe'
}

export function requireWorkspaceId() {
  const id = getWorkspaceId()
  if (!id) {
    throw new Error(
      'Set FRAN_MCP_WORKSPACE_ID (or MCP_WORKSPACE_ID) to the Fran workspace UUID',
    )
  }
  return id
}

export function getDb() {
  if (_db) return _db
  const url = process.env.SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Fran MCP')
  }
  _db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _db
}

export function jsonResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  }
}

export function textResult(text) {
  return {
    content: [{ type: 'text', text: String(text) }],
  }
}

export function errorResult(err) {
  const message = err?.message || String(err)
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  }
}
