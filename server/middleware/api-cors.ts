export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/v1/') && !path.startsWith('/fran/') && !path.startsWith('/mcp')) return

  setHeader(event, 'Access-Control-Allow-Origin', '*')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  setHeader(event, 'Access-Control-Allow-Headers', 'authorization,content-type,x-api-key,x-mcp-client,x-client-name,mcp-session-id,mcp-protocol-version,last-event-id,accept')
  setHeader(event, 'Access-Control-Max-Age', '86400')

  if (getMethod(event) === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }
})
