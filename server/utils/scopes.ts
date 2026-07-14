/**
 * Canonical scope catalog + package expansion for Loft / store-ops / POS.
 * See docs/ORG_PERMISSION_SCOPES.md and TODO-LOFT.md Phase P.
 */

export type ScopeString = string

/** App / role packages used for API keys and install grants. */
export const SCOPE_PACKAGES: Record<string, string[]> = {
  pos_connector: [
    'pos:read',
    'pos:write',
    'store_ops:read',
    'store_ops:write',
    'products:read',
  ],
  worldsyntech_ofs: [
    'inventory:read',
    'inventory:write',
    'store_ops:read',
    'store_ops:write',
    'store_ops:execute_3pl',
    'store_ops:inbound',
    'integrations:execute',
    'locations:read',
    'products:read',
  ],
  store: [
    'pos:read',
    'pos:write',
    'inventory:read',
    'store_ops:read',
    'store_ops:write',
    'products:read',
  ],
  inventory_ops: [
    'products:read',
    'products:write',
    'inventory:read',
    'inventory:write',
    'inventory:po',
    'inventory:override_expiry',
    'locations:read',
    'locations:write',
    'expiry:read',
    'expiry:write',
    'store_ops:read',
    'store_ops:write',
    'store_ops:approve',
    'store_ops:verify',
    'store_ops:inbound',
    'pos:read',
    'pos:write',
    'forecasting:read',
    'forecasting:write',
    'intel:read',
    'actions:read',
    'actions:submit',
  ],
  viewer: [
    'products:read',
    'brands:read',
    'categories:read',
    'inventory:read',
    'locations:read',
    'expiry:read',
    'store_ops:read',
    'pos:read',
    'integrations:read',
    'activity:read',
    'intel:read',
    'forecasting:read',
    'actions:read',
    'apps:read',
  ],
}

/** Privileged scopes that machine POS keys must never hold. */
export const POS_FORBIDDEN_SCOPES = [
  'store_ops:approve',
  'store_ops:verify',
  'store_ops:execute_3pl',
  'store_ops:inbound',
  'credentials:read',
  'credentials:write',
  'integrations:execute',
  'inventory:override_expiry',
] as const

export function expandScopePackage(nameOrList: string | string[]): string[] {
  if (Array.isArray(nameOrList)) {
    return [...new Set(nameOrList.flatMap(expandScopePackage))]
  }
  const key = String(nameOrList || '').trim()
  if (!key) return []
  if (key === 'full' || key === '*') return ['*']
  const pkg = SCOPE_PACKAGES[key] || SCOPE_PACKAGES[key.replace(/-/g, '_')]
  if (pkg) return [...pkg]
  if (key.includes(',')) {
    return expandScopePackage(key.split(',').map(s => s.trim()).filter(Boolean))
  }
  return [key]
}

/**
 * Map get_my_permissions() JSON area map → colon scopes.
 */
export function permissionsMapToScopes(permissions: Record<string, any> | null | undefined): Set<string> {
  const scopes = new Set<string>()
  if (!permissions || typeof permissions !== 'object') return scopes

  const areaToResource: Record<string, string> = {
    products: 'products',
    brands: 'brands',
    categories: 'categories',
    integrations: 'integrations',
    credentials: 'credentials',
    schemas: 'schemas',
    custom_fields: 'custom_fields',
    team: 'team',
    workspace: 'workspace',
    activity: 'activity',
    api: 'api',
    inventory: 'inventory',
    locations: 'locations',
    expiry: 'expiry',
    store_ops: 'store_ops',
    pos: 'pos',
    forecasting: 'forecasting',
    actions: 'actions',
    intel: 'intel',
    apps: 'apps',
    images: 'images',
    assistant: 'assistant',
    organization: 'organization',
  }

  for (const [area, flags] of Object.entries(permissions)) {
    if (!flags || typeof flags !== 'object') continue
    const resource = areaToResource[area] || area
    for (const [action, allowed] of Object.entries(flags as Record<string, unknown>)) {
      if (allowed === true) scopes.add(`${resource}:${action}`)
    }
  }
  return scopes
}

export interface ScopeCheckOptions {
  /**
   * Legacy API keys with empty scopes[] were treated as full access.
   * Default true for backward compatibility. New keys should use explicit packages.
   */
  emptyMeansFull?: boolean
}

export function normalizeGrantedScopes(scopes: string[] | null | undefined): string[] {
  if (!scopes || !Array.isArray(scopes)) return []
  return [...new Set(scopes.map(s => String(s).trim()).filter(Boolean))]
}

export function hasScope(
  granted: string[] | null | undefined,
  required: string | string[],
  options: ScopeCheckOptions = {},
): boolean {
  const emptyMeansFull = options.emptyMeansFull !== false
  const list = normalizeGrantedScopes(granted)
  if (list.length === 0) return emptyMeansFull
  if (list.includes('*') || list.includes('full')) return true

  const needed = Array.isArray(required) ? required : [required]
  return needed.every(scope => list.includes(scope))
}

export function hasAllScopes(
  granted: string[] | null | undefined,
  required: string[],
  options?: ScopeCheckOptions,
): boolean {
  return hasScope(granted, required, options)
}

export function assertNoForbiddenScopes(
  granted: string[],
  forbidden: readonly string[] = POS_FORBIDDEN_SCOPES,
): string[] {
  return granted.filter(s => forbidden.includes(s as any))
}

export function resolveScopesFromPermissions(
  permissions: Record<string, any> | null | undefined,
): string[] {
  return [...permissionsMapToScopes(permissions)].sort()
}
