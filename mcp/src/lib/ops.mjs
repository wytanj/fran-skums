/**
 * MCP ops snapshot + capabilities (shared core/ops).
 */
import {
  describeMcpScopes,
  getMcpProfileName,
  getMcpScopes,
  getMcpRequestContext,
  isCloudMcpRequest,
  getDb,
} from '../context.mjs'
import { opsSnapshot, mcpCapabilities } from '../../../core/ops/index.mjs'
import { resolvePermittedTools } from '../toolScopes.mjs'

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} [args]
 */
export async function snapshotOps(workspaceId, args = {}) {
  return opsSnapshot(getDb(), {
    workspace_id: workspaceId,
    include_samples: args.include_samples !== false && args.samples !== false,
  })
}

/**
 * What THIS key can do — one-shot for “what am I allowed to do?”
 * @param {Record<string, any>} [args]
 */
export function capabilitiesOps(args = {}) {
  const desc = describeMcpScopes()
  const cloud = isCloudMcpRequest()
  const scopes = getMcpScopes()
  const req = getMcpRequestContext()
  const permitted = resolvePermittedTools({ scopes, cloud })

  return mcpCapabilities({
    cloud,
    profile: getMcpProfileName(),
    mode: desc.mode,
    scopes,
    surface: args.surface || 'mcp',
    key_id: req?.keyId || null,
    key_name: req?.keyName || null,
    actor_user_id: req?.actorUserId || null,
    permitted,
  })
}
