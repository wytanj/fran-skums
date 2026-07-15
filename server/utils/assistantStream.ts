import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildToolDefinitions,
  executeTool,
  filterToolDefinitionsByScopes,
  type ToolContext,
} from './assistantTools'
import { resolveEffectiveScopesForSession } from './effectiveScopes'

export interface StreamParams {
  client: SupabaseClient
  workspaceId: string
  conversationId: string | null
  userId: string
  message: string
  systemPrompt: string
  model: string
  xaiApiKey: string
  contextType?: string
  contextId?: string
  slackWebhookUrl?: string | null
}

interface XAIMessage {
  role: string
  content: string | null
  tool_calls?: any[]
  tool_call_id?: string
  name?: string
}

const XAI_BASE = 'https://api.x.ai/v1'

export function createAssistantStream(params: StreamParams): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      function send(obj: object) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
      }

      const {
        client, workspaceId, userId, message, systemPrompt,
        model, xaiApiKey, contextType, contextId, slackWebhookUrl,
      } = params
      let { conversationId } = params

      try {
        console.log('[assistant] Starting stream for user', userId, 'workspace', workspaceId)

        // Ensure conversation exists
        if (!conversationId) {
          console.log('[assistant] Creating new conversation...')
          const { data: conv, error: convErr } = await client
            .from('assistant_conversations')
            .insert({
              workspace_id: workspaceId,
              user_id: userId,
              title: message.slice(0, 80),
              context_type: contextType || null,
              context_id: contextId || null,
            })
            .select()
            .single()
          if (convErr) throw new Error(`Conversation insert failed: ${convErr.message} (code: ${convErr.code}, details: ${convErr.details})`)
          conversationId = conv.id
          console.log('[assistant] Created conversation', conversationId)
        } else {
          // Update updated_at
          await client
            .from('assistant_conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', conversationId)
        }

        send({ type: 'conversation_id', conversationId })
        send({ type: 'thinking' })

        // Persist user message
        await client.from('assistant_messages').insert({
          conversation_id: conversationId,
          role: 'user',
          content: message,
        })

        // Load conversation history (last 20 messages)
        const { data: history } = await client
          .from('assistant_messages')
          .select('role, content, tool_calls, tool_call_id, tool_name')
          .eq('conversation_id', conversationId!)
          .order('created_at', { ascending: true })
          .limit(20)

        const messages: XAIMessage[] = [
          { role: 'system', content: systemPrompt },
          ...(history || []).map((m: any) => {
            const msg: XAIMessage = { role: m.role, content: m.content }
            if (m.tool_calls) msg.tool_calls = m.tool_calls
            if (m.tool_call_id) {
              msg.tool_call_id = m.tool_call_id
              msg.name = m.tool_name
            }
            return msg
          }),
        ]

        const toolCtx: ToolContext = { client, workspaceId, slackWebhookUrl }

        // A2: Catalog AI tools ≤ session web login power
        let assistantTools = buildToolDefinitions()
        try {
          const sessionScopes = await resolveEffectiveScopesForSession(client, workspaceId, userId)
          assistantTools = filterToolDefinitionsByScopes(assistantTools, sessionScopes.scopes)
        } catch (e) {
          console.warn('[assistant] scope filter skipped', (e as Error)?.message)
        }

        console.log('[assistant] Calling xAI API with model:', model, 'messages:', messages.length, 'tools:', assistantTools.length)

        // Tool-call loop (max 5 rounds)
        for (let round = 0; round < 5; round++) {
          console.log('[assistant] xAI round', round + 1)
          const response = await fetch(`${XAI_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${xaiApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages,
              tools: assistantTools,
              tool_choice: 'auto',
              stream: true,
            }),
          })

          if (!response.ok) {
            const err = await response.text()
            console.error('[assistant] xAI API error:', response.status, err)
            throw new Error(`xAI API error (${response.status}): ${err}`)
          }
          console.log('[assistant] xAI response OK, streaming...')

          // Parse SSE stream
          let accContent = ''
          let accReasoning = ''
          let accToolCalls: any[] = []
          let finishReason = ''
          let modelUsed = model
          let tokensUsed = 0

          const reader = response.body!.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const raw = line.slice(6).trim()
              if (raw === '[DONE]') continue
              let chunk: any
              try { chunk = JSON.parse(raw) } catch { continue }

              const choice = chunk.choices?.[0]
              if (!choice) continue
              finishReason = choice.finish_reason || finishReason
              if (chunk.model) modelUsed = chunk.model
              if (chunk.usage?.total_tokens) tokensUsed = chunk.usage.total_tokens

              const delta = choice.delta
              if (!delta) continue

              if (delta.content) {
                accContent += delta.content
                send({ type: 'delta', content: delta.content })
              }

              if (delta.reasoning) {
                accReasoning += delta.reasoning
                send({ type: 'reasoning', content: delta.reasoning })
              }

              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0
                  if (!accToolCalls[idx]) {
                    accToolCalls[idx] = { id: tc.id, type: 'function', function: { name: tc.function?.name || '', arguments: '' } }
                  }
                  if (tc.function?.name) accToolCalls[idx].function.name = tc.function.name
                  if (tc.function?.arguments) accToolCalls[idx].function.arguments += tc.function.arguments
                }
              }
            }
          }

          // Persist assistant turn
          await client.from('assistant_messages').insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: accContent || null,
            tool_calls: accToolCalls.length > 0 ? accToolCalls : null,
            reasoning: accReasoning || null,
            model_used: modelUsed,
            tokens_used: tokensUsed || null,
            finish_reason: finishReason,
          })

          console.log('[assistant] Round done. finish:', finishReason, 'content length:', accContent.length, 'tool_calls:', accToolCalls.length)

          // If no tool calls, we're done
          if (finishReason !== 'tool_calls' || accToolCalls.length === 0) {
            break
          }

          // Execute tools
          messages.push({ role: 'assistant', content: accContent || null, tool_calls: accToolCalls })

          for (const tc of accToolCalls) {
            const toolName = tc.function.name
            let toolArgs: any = {}
            try { toolArgs = JSON.parse(tc.function.arguments || '{}') } catch {}

            send({ type: 'tool_call', name: toolName })

            const result = await executeTool(toolName, toolArgs, toolCtx)

            send({ type: 'tool_result', name: toolName, result })

            // Persist tool result
            await client.from('assistant_messages').insert({
              conversation_id: conversationId,
              role: 'tool',
              content: JSON.stringify(result),
              tool_call_id: tc.id,
              tool_name: toolName,
            })

            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: toolName,
              content: JSON.stringify(result),
            })
          }
        }

        send({ type: 'done', conversationId })
      } catch (err: any) {
        send({ type: 'error', message: err?.message || 'Unknown error' })
      } finally {
        controller.close()
      }
    },
  })
}
