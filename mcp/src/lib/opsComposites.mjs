/**
 * MCP backlog #8 composites (shared core/ops/composites).
 */
import {
  expirySnapshot,
  exceptionsSnapshot,
  integrationsHealth,
  attentionSnapshot,
  lowStockRequestPack,
  posEnableProposal,
} from '../../../core/ops/index.mjs'
import { getDb } from '../context.mjs'

export async function expiry(workspaceId, args = {}) {
  return expirySnapshot(getDb(), { workspace_id: workspaceId, limit: args.limit })
}

export async function exceptions(workspaceId, args = {}) {
  return exceptionsSnapshot(getDb(), { workspace_id: workspaceId, limit: args.limit })
}

export async function integrations(workspaceId, args = {}) {
  return integrationsHealth(getDb(), { workspace_id: workspaceId })
}

export async function attention(workspaceId, args = {}) {
  return attentionSnapshot(getDb(), {
    workspace_id: workspaceId,
    limit: args.limit,
    status: args.status || null,
  })
}

export async function lowStockPack(workspaceId, args = {}) {
  return lowStockRequestPack(getDb(), { workspace_id: workspaceId, limit: args.limit })
}

export async function posEnable(workspaceId, args = {}) {
  return posEnableProposal(getDb(), {
    workspace_id: workspaceId,
    limit: args.limit,
    brand: args.brand || null,
    status: args.status || null,
  })
}
