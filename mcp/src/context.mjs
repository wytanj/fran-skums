/**
 * MCP runtime context: env, Supabase service client, workspace scope.
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
 * Comma-separated scopes. Empty / * / all = full access.
 * @returns {string[] | null} null means all scopes
 */
export function getMcpScopes() {
  const raw = process.env.FRAN_MCP_SCOPES || process.env.MCP_SCOPES || ''
  if (!raw.trim() || raw.trim() === '*' || raw.trim() === 'all') return null
  return raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
}

export function requireScope(scope) {
  const scopes = getMcpScopes()
  if (scopes == null) return
  if (!scopes.includes(scope)) {
    throw new Error(`MCP key/scopes lack required scope: ${scope}`)
  }
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
