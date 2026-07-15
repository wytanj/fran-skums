/**
 * Canonical scope catalog + package expansion for Loft / store-ops / POS.
 * See docs/ORG_PERMISSION_SCOPES.md and TODO-LOFT.md Phase P.
 */

export type ScopeString = string

/**
 * Default MCP connector package baseline (draft/read).
 * Owner/admin packages add approve/execute; A2 intersects with web login scopes.
 */
export const MCP_CLOUD_SAFE_SCOPES: string[] = [
  'intel:read',
  'inventory:read',
  'store_ops:read',
  'store_ops:write',
  'study:write',
  'pipeline:propose',
  'po:draft',
  'projection:run',
]

/**
 * Scopes never granted via cloud MCP keys (secrets), regardless of role.
 * Store-ops approve / execute_3pl / PO decide ARE allowed when the bound user has them on web.
 */
export const MCP_CLOUD_FORBIDDEN_SCOPES: string[] = [
  'credentials:read',
  'credentials:write',
]

/** Owner/admin MCP package extras (still capped by bound-user web scopes). */
export const MCP_OPS_ELEVATED_SCOPES: string[] = [
  'store_ops:approve',
  'store_ops:verify',
  'store_ops:execute_3pl',
  'store_ops:inbound',
  'inventory:write',
  'inventory:override_expiry',
  'actions:approve',
  'po:submit',
  'po:decide',
  'pipeline:decide',
  'intel:write',
]

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
  /** MCP templates (A2) — role-aligned connector packages */
  'mcp:viewer': [
    'intel:read',
    'inventory:read',
    'store_ops:read',
    'products:read',
    'brands:read',
    'categories:read',
    'actions:read',
  ],
  'mcp:member': [
    ...MCP_CLOUD_SAFE_SCOPES,
    'products:read',
    'products:write',
    'brands:read',
    'categories:read',
    'actions:read',
    'actions:write',
    'actions:submit',
  ],
  'mcp:ops_safe': [
    ...MCP_CLOUD_SAFE_SCOPES,
    ...MCP_OPS_ELEVATED_SCOPES,
    'products:read',
    'products:write',
    'brands:read',
    'categories:read',
    'actions:read',
    'actions:write',
    'actions:submit',
    'api:read',
  ],
  'mcp:store': [
    'products:read',
    'inventory:read',
    'store_ops:read',
    'store_ops:write',
    'pos:read',
    'pos:write',
    'intel:read',
  ],
  'mcp:buyer': [
    'products:read',
    'intel:read',
    'actions:read',
    'actions:write',
    'actions:submit',
    'pipeline:propose',
    'po:draft',
    'projection:run',
    'study:write',
  ],
  'mcp:finance': [
    'products:read',
    'inventory:read',
    'actions:read',
    'actions:approve',
    'projection:run',
    'intel:read',
  ],
  /** Alias used by Settings Claude key button */
  'mcp:safe': [...MCP_CLOUD_SAFE_SCOPES, 'products:read', 'actions:read', 'actions:write', 'actions:submit'],
  mcp_safe: [...MCP_CLOUD_SAFE_SCOPES, 'products:read', 'actions:read', 'actions:write', 'actions:submit'],
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
 * Expand key.scopes array (packages + raw scopes) into a flat unique list.
 * Empty array → [] (does NOT mean full — call sites apply defaults for legacy keys).
 */
export function expandKeyScopes(scopes: string[] | null | undefined): string[] {
  const list = normalizeGrantedScopes(scopes)
  if (!list.length) return []
  if (list.includes('*') || list.includes('full')) return ['*']
  return [...new Set(list.flatMap((s) => expandScopePackage(s)))]
}

/**
 * Bridge web/permission_schema scopes → MCP tool scopes so keys can be capped by login power.
 */
export function bridgeWebScopesToMcp(webScopes: string[]): string[] {
  const out = new Set<string>()
  for (const s of normalizeGrantedScopes(webScopes)) {
    out.add(s)
    if (s === 'products:read' || s === 'brands:read' || s === 'categories:read' || s === 'products:export') {
      out.add('intel:read')
    }
    if (s === 'inventory:read') {
      out.add('inventory:read')
      out.add('intel:read')
    }
    if (s === 'actions:write' || s === 'actions:submit') {
      out.add('po:draft')
      out.add('pipeline:propose')
      out.add('study:write')
    }
    if (s === 'actions:approve') {
      out.add('po:submit')
      out.add('po:decide')
      out.add('pipeline:decide')
    }
    if (s === 'forecasting:read' || s === 'forecasting:write') {
      out.add('projection:run')
    }
    if (s === 'intel:read') out.add('intel:read')
    if (s === 'intel:write') out.add('intel:write')
  }
  return [...out]
}

/**
 * Intersect two scope lists. '*' in either side means that side is unrestricted.
 */
export function intersectScopes(a: string[], b: string[]): string[] {
  const aa = normalizeGrantedScopes(a)
  const bb = normalizeGrantedScopes(b)
  if (aa.includes('*') || aa.includes('full')) return bb.filter((s) => s !== '*' && s !== 'full')
  if (bb.includes('*') || bb.includes('full')) return aa.filter((s) => s !== '*' && s !== 'full')
  const setB = new Set(bb)
  return aa.filter((s) => setB.has(s))
}

/**
 * Cloud MCP ceiling: strip secrets only.
 * Approve / execute_3pl / PO decide pass through when present (permission-based A2 model).
 */
export function applyCloudMcpCeiling(scopes: string[]): string[] {
  const list = normalizeGrantedScopes(scopes)
  if (list.includes('*') || list.includes('full')) {
    // Unrestricted key on cloud still never gets raw credentials scopes
    return [
      ...MCP_CLOUD_SAFE_SCOPES,
      ...MCP_OPS_ELEVATED_SCOPES,
      'products:read',
      'products:write',
      'brands:read',
      'categories:read',
      'actions:read',
      'actions:write',
      'actions:submit',
      'pos:read',
      'pos:write',
      'api:read',
    ]
  }
  return list.filter((s) => !MCP_CLOUD_FORBIDDEN_SCOPES.includes(s))
}

/**
 * Pure effective-scope computation (A2).
 * effective = expand(key) ∩ bridge(user) ∩ optional cloud ceiling
 */
export function computeEffectiveScopes(opts: {
  keyScopes: string[]
  maxPackage?: string | null
  userWebScopes: string[]
  cloud?: boolean
  /** If key scopes empty: use maxPackage, else mcp:safe for mcp keys, else [] */
  keyKind?: string | null
}): string[] {
  let keyExpanded = expandKeyScopes(opts.keyScopes)
  if (!keyExpanded.length) {
    const fallback =
      opts.maxPackage ||
      (opts.keyKind === 'mcp_connector' || opts.keyKind === 'mcp' ? 'mcp:safe' : null)
    keyExpanded = fallback ? expandScopePackage(fallback) : []
  }
  if (opts.maxPackage) {
    const pkg = expandScopePackage(opts.maxPackage)
    keyExpanded = intersectScopes(keyExpanded, pkg.length ? pkg : keyExpanded)
  }

  const userMcp = bridgeWebScopesToMcp(opts.userWebScopes)
  // If user has no scopes resolved (empty membership), deny everything
  if (!opts.userWebScopes?.length && !userMcp.length) {
    return []
  }
  // Unrestricted user (owner elevated often has many scopes) — if user list empty after bridge only
  let effective = userMcp.length
    ? intersectScopes(keyExpanded, userMcp)
    : keyExpanded

  // Owner/admin often have elevated scopes that include store_ops:approve — keep key power only if key had it
  if (opts.cloud) {
    effective = applyCloudMcpCeiling(effective)
  }
  return effective
}

/** Default MCP package by workspace role (owner + admin share ops_safe cloud package) */
export function defaultMcpPackageForRole(role: string | null | undefined): string {
  const r = String(role || 'member').toLowerCase()
  if (r === 'owner' || r === 'admin') return 'mcp:ops_safe'
  if (r === 'viewer') return 'mcp:viewer'
  if (r === 'store_associate' || r === 'store') return 'mcp:store'
  if (r === 'buyer') return 'mcp:buyer'
  if (r === 'finance') return 'mcp:finance'
  return 'mcp:member'
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
