/**
 * MCP runtime context: env, Supabase service client, workspace scope.
 *
 * Scope profiles (M0):
 *   FRAN_MCP_PROFILE=safe|full   (default: safe)
 *   FRAN_MCP_SCOPES=safe|full|*|all|comma-list
 *     - empty → use FRAN_MCP_PROFILE (default safe)
 *     - safe / full → named profile
 *     - * / all / full → unrestricted (null)
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

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

export function getWorkspaceId() {
  const id =
    process.env.FRAN_MCP_WORKSPACE_ID ||
    process.env.MCP_WORKSPACE_ID ||
    process.env.WORKSPACE_ID ||
    ''
  return id.trim()
}

/**
 * Client label for audit (e.g. cursor, claude-desktop).
 */
export function getMcpClientName() {
  return (process.env.FRAN_MCP_CLIENT || process.env.MCP_CLIENT || 'mcp').trim() || 'mcp'
}

/**
 * Optional human operator profile UUID for attribution.
 */
export function getMcpActorUserId() {
  const id = (process.env.FRAN_MCP_ACTOR_USER_ID || process.env.MCP_ACTOR_USER_ID || '').trim()
  return id || null
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
    const profile = getMcpProfileName()
    throw new Error(
      `MCP scope denied: need "${scope}" (profile=${profile}). ` +
        `Safe profile cannot submit/decide/execute or write crawl seeds. ` +
        `Set FRAN_MCP_PROFILE=full or FRAN_MCP_SCOPES=full for privileged ops.`,
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
