/**
 * MCP ops snapshot + capabilities (shared core/ops).
 */
import {
  describeMcpScopes,
  getMcpProfileName,
  getMcpScopes,
  isCloudMcpRequest,
  getDb,
} from '../context.mjs'
import { opsSnapshot, mcpCapabilities } from '../../../core/ops/index.mjs'

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
 * @param {Record<string, any>} [args]
 */
export function capabilitiesOps(args = {}) {
  const desc = describeMcpScopes()
  return mcpCapabilities({
    cloud: isCloudMcpRequest(),
    profile: getMcpProfileName(),
    mode: desc.mode,
    scopes: getMcpScopes(),
    surface: args.surface || 'mcp',
  })
}
