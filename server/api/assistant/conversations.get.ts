import { serverSupabaseUser } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = (user as any).id || (user as any).sub
  if (!userId) throw createError({ statusCode: 401, statusMessage: 'Could not resolve user ID' })

  const client = getServiceClient()
  const query = getQuery(event)
  const { workspaceId } = query

  if (!workspaceId) throw createError({ statusCode: 400, statusMessage: 'workspaceId required' })

  // Verify user is a member of this workspace
  const { data: membership } = await client
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId as string)
    .eq('user_id', userId)
    .single()

  if (!membership) {
    throw createError({ statusCode: 403, statusMessage: 'Not a member of this workspace' })
  }

  const { data, error } = await client
    .from('assistant_conversations')
    .select('id, title, context_type, context_id, created_at, updated_at')
    .eq('workspace_id', workspaceId as string)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { conversations: data || [] }
})
