/**
 * Local state for mall-brand-cycle.mjs (resume / skip done brands).
 * File: .mall-cycle-state.json at repo root (gitignored optional).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * @param {string} statePath
 * @returns {{ version: number, workspace_id: string | null, updated_at: string | null, brands: Record<string, any> }}
 */
export function loadCycleState(statePath) {
  if (!existsSync(statePath)) {
    return { version: 1, workspace_id: null, updated_at: null, brands: {} }
  }
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'))
    return {
      version: 1,
      workspace_id: raw.workspace_id || null,
      updated_at: raw.updated_at || null,
      brands: raw.brands && typeof raw.brands === 'object' ? raw.brands : {},
    }
  } catch {
    return { version: 1, workspace_id: null, updated_at: null, brands: {} }
  }
}

/**
 * @param {string} statePath
 * @param {object} state
 */
export function saveCycleState(statePath, state) {
  const dir = dirname(statePath)
  if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  const out = {
    version: 1,
    workspace_id: state.workspace_id || null,
    updated_at: new Date().toISOString(),
    brands: state.brands || {},
  }
  writeFileSync(statePath, JSON.stringify(out, null, 2), 'utf8')
}

/**
 * @param {object} state
 * @param {string} brandKey
 * @param {object} patch
 */
export function patchBrandState(state, brandKey, patch) {
  const key = String(brandKey).toLowerCase()
  const prev = state.brands[key] || {}
  state.brands[key] = {
    ...prev,
    ...patch,
    updated_at: new Date().toISOString(),
  }
  return state.brands[key]
}

/**
 * Default state path under project root.
 * @param {string} root
 */
export function defaultCycleStatePath(root) {
  return resolve(root, '.mall-cycle-state.json')
}
