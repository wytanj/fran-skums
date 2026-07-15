/**
 * Remote MCP endpoint.
 * Claude personal custom connector: only Name + URL (+ optional OAuth).
 * Put API key in URL: /mcp?api_key=sk_live_…  or  /mcp/c/sk_live_…
 */
import { handleMcpHttpRequest } from '../../utils/mcpHttpHandler'

export default defineEventHandler((event) => handleMcpHttpRequest(event))
