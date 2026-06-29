import { serverSupabaseUser } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // serverSupabaseUser may return id at .id or .sub depending on version
  const userId = (user as any).id || (user as any).sub
  if (!userId) throw createError({ statusCode: 401, statusMessage: 'Could not resolve user ID' })

  const client = getServiceClient()
  const config = useRuntimeConfig()
  const xaiApiKey = config.xaiApiKey

  if (!xaiApiKey) throw createError({ statusCode: 500, statusMessage: 'xAI API key not configured' })

  const body = await readBody(event)
  const { workspaceId, conversationId, message, contextType, contextId, contextData } = body

  if (!workspaceId || !message) {
    throw createError({ statusCode: 400, statusMessage: 'workspaceId and message are required' })
  }

  // Verify user is a member of this workspace (critical: service client bypasses RLS)
  const { data: membership, error: membershipErr } = await client
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single()

  if (membershipErr || !membership) {
    throw createError({ statusCode: 403, statusMessage: 'Not a member of this workspace' })
  }

  // Load workspace AI profile
  const { data: profile } = await client
    .from('assistant_context_profiles')
    .select('user_role, system_prompt_additions, slack_webhook_url, preferred_model')
    .eq('workspace_id', workspaceId)
    .single()

  // Load workspace info
  const { data: workspace } = await client
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .single()

  // Load active integrations
  const { data: integrations } = await client
    .from('integration_connections')
    .select('name, node_definition:node_def_id(name)')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .limit(10)

  const integrationNames = (integrations || []).map((i: any) => i.node_definition?.name || i.name)

  const systemPrompt = buildSystemPrompt({
    workspaceName: workspace?.name || workspaceId,
    userRole: profile?.user_role || 'retailer',
    memberRole: membership.role || 'member',
    integrationNames,
    contextType,
    contextData,
    systemPromptAdditions: profile?.system_prompt_additions,
  })

  const model = profile?.preferred_model || 'grok-3-mini'

  setResponseHeader(event, 'Content-Type', 'text/event-stream')
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  setResponseHeader(event, 'Connection', 'keep-alive')

  const stream = createAssistantStream({
    client,
    workspaceId,
    conversationId: conversationId || null,
    userId,
    message,
    systemPrompt,
    model,
    xaiApiKey,
    contextType,
    contextId,
    slackWebhookUrl: profile?.slack_webhook_url,
  })

  return sendStream(event, stream)
})
