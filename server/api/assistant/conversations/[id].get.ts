import { serverSupabaseUser } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = (user as any).id || (user as any).sub
  if (!userId) throw createError({ statusCode: 401, statusMessage: 'Could not resolve user ID' })

  const client = getServiceClient()
  const id = getRouterParam(event, 'id')

  if (!id) throw createError({ statusCode: 400, statusMessage: 'Conversation ID required' })

  const { data: conversation, error: convErr } = await client
    .from('assistant_conversations')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (convErr || !conversation) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }

  const { data: messages, error: msgErr } = await client
    .from('assistant_messages')
    .select('id, role, content, tool_calls, tool_call_id, tool_name, reasoning, model_used, tokens_used, finish_reason, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })

  if (msgErr) throw createError({ statusCode: 500, statusMessage: msgErr.message })

  return { conversation, messages: messages || [] }
})
