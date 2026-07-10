#!/usr/bin/env node
/**
 * Fran SKUMS MCP server (stdio).
 *
 * Env (from repo .env or process):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   FRAN_MCP_WORKSPACE_ID   — required workspace UUID
 *   XAI_API_KEY             — optional; enables live Grok briefs
 *   FRAN_MCP_SCOPES         — optional comma list; empty = all
 *
 * Run:
 *   node mcp/src/index.mjs
 *   npm run mcp
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { getWorkspaceId, getXaiApiKey } from './context.mjs'
import { handleTool, toolDefinitions } from './tools.mjs'

const server = new Server(
  {
    name: 'fran-skums',
    version: '0.5.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions,
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name
  const args = request.params.arguments || {}
  return handleTool(name, args)
})

async function main() {
  // Soft warnings to stderr (stdout is MCP protocol)
  const ws = getWorkspaceId()
  if (!ws) {
    console.error(
      '[fran-mcp] WARN: FRAN_MCP_WORKSPACE_ID not set — write tools will fail until configured',
    )
  } else {
    console.error(`[fran-mcp] workspace=${ws}`)
  }
  console.error(
    `[fran-mcp] XAI_API_KEY=${getXaiApiKey() ? 'set' : 'missing (offline briefs only)'}`,
  )
  console.error(`[fran-mcp] tools=${toolDefinitions.length}`)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[fran-mcp] ready (stdio)')
}

main().catch((err) => {
  console.error('[fran-mcp] fatal', err)
  process.exit(1)
})
