/**
 * Path-embedded API key for Claude personal connectors
 * (no Authorization header field in the UI).
 *
 * URL: https://fran-skums.vercel.app/mcp/c/sk_live_YOUR_KEY
 * Leave OAuth client id / secret empty.
 */
import { handleMcpHttpRequest } from '../../../utils/mcpHttpHandler'

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  // decodeURIComponent in case Claude or user encoded the key
  let pathToken = token || ''
  try {
    pathToken = decodeURIComponent(pathToken)
  } catch {
    /* keep raw */
  }
  return handleMcpHttpRequest(event, { pathToken })
})
