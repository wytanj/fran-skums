import type { AssistantConversation, AssistantMessage } from '~/types'

// Module-level shared state (persists across component instances)
const isOpen = ref(false)
const conversations = ref<AssistantConversation[]>([])
const currentConversationId = ref<string | null>(null)
const messages = ref<AssistantMessage[]>([])
const streaming = ref(false)
const streamingContent = ref('')
const thinking = ref(false)
const thinkingLabel = ref('')
const showHistory = ref(false)

// Context set by pages/components
const contextType = ref<string | undefined>()
const contextId = ref<string | undefined>()
const contextData = ref<any>(undefined)
const contextLabel = ref<string | undefined>()

export function useAssistant() {
  const { currentWorkspace } = useWorkspace()

  async function open() {
    isOpen.value = true
    if (currentWorkspace.value) await loadConversations()
    // Prefer history when past chats exist and we're not mid-thread
    if (
      conversations.value.length > 0
      && !currentConversationId.value
      && messages.value.length === 0
      && !streaming.value
    ) {
      showHistory.value = true
    } else {
      showHistory.value = false
    }
  }
  function close() { isOpen.value = false }
  function toggle() {
    if (isOpen.value) close()
    else open()
  }

  /** Leave active chat → history list */
  function backToHistory() {
    showHistory.value = true
    // Keep currentConversationId so history can highlight it; clear messages only when starting new
  }

  /** Leave history → empty new chat (or stay on current if resuming) */
  function backToChat() {
    showHistory.value = false
  }

  function setContext(type: string, id: string, data: any, label?: string) {
    contextType.value = type
    contextId.value = id
    contextData.value = data
    contextLabel.value = label
  }

  function clearContext() {
    contextType.value = undefined
    contextId.value = undefined
    contextData.value = undefined
    contextLabel.value = undefined
  }

  async function loadConversations() {
    if (!currentWorkspace.value) return
    try {
      const { conversations: data } = await $fetch<{ conversations: AssistantConversation[] }>(
        `/api/assistant/conversations?workspaceId=${currentWorkspace.value.id}`,
      )
      conversations.value = data || []
    } catch (e) {
      console.warn('[assistant] loadConversations failed', e)
    }
  }

  async function loadConversation(id: string) {
    try {
      const { conversation, messages: msgs } = await $fetch<{
        conversation: AssistantConversation
        messages: AssistantMessage[]
      }>(`/api/assistant/conversations/${id}`)
      currentConversationId.value = conversation.id
      messages.value = (msgs || []).filter(
        (m) => m.role === 'user' || m.role === 'assistant',
      )
      showHistory.value = false
    } catch (e) {
      console.warn('[assistant] loadConversation failed', e)
    }
  }

  function newConversation() {
    currentConversationId.value = null
    messages.value = []
    streamingContent.value = ''
    thinking.value = false
    thinkingLabel.value = ''
    showHistory.value = false
  }

  /** Active chat title for header */
  function currentChatTitle(): string {
    if (!currentConversationId.value) return 'New chat'
    const found = conversations.value.find((c) => c.id === currentConversationId.value)
    if (found?.title) return found.title
    const firstUser = messages.value.find((m) => m.role === 'user' && m.content)
    if (firstUser?.content) return firstUser.content.slice(0, 48)
    return 'Chat'
  }

  async function sendMessage(text: string) {
    if (!currentWorkspace.value || !text.trim() || streaming.value) return

    // Optimistically add user message
    const userMsg: AssistantMessage = {
      id: crypto.randomUUID(),
      conversation_id: currentConversationId.value || '',
      role: 'user',
      content: text,
      tool_calls: null,
      tool_call_id: null,
      tool_name: null,
      reasoning: null,
      model_used: null,
      tokens_used: null,
      finish_reason: null,
      created_at: new Date().toISOString(),
    }
    messages.value.push(userMsg)
    streaming.value = true
    streamingContent.value = ''
    thinking.value = false
    thinkingLabel.value = ''

    try {
      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: currentWorkspace.value.id,
          conversationId: currentConversationId.value,
          message: text,
          contextType: contextType.value,
          contextId: contextId.value,
          contextData: contextData.value,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        console.error('[assistant] HTTP error', response.status, errText)
        throw new Error(`Server error ${response.status}: ${errText}`)
      }

      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      let gotDone = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw) continue
          let event: any
          try { event = JSON.parse(raw) } catch (e) { console.warn('[assistant] bad SSE json:', raw); continue }

          console.debug('[assistant] SSE event:', event.type, event)

          switch (event.type) {
            case 'conversation_id':
              currentConversationId.value = event.conversationId
              userMsg.conversation_id = event.conversationId
              break
            case 'thinking':
              thinking.value = true
              thinkingLabel.value = 'Thinking...'
              break
            case 'delta':
              thinking.value = false
              thinkingLabel.value = ''
              streamingContent.value += event.content
              break
            case 'reasoning':
              thinking.value = true
              thinkingLabel.value = 'Thinking...'
              break
            case 'tool_call':
              thinking.value = true
              thinkingLabel.value = formatToolLabel(event.name)
              break
            case 'tool_result':
              thinking.value = false
              thinkingLabel.value = ''
              break
            case 'done':
              gotDone = true
              if (streamingContent.value) {
                messages.value.push({
                  id: crypto.randomUUID(),
                  conversation_id: event.conversationId,
                  role: 'assistant',
                  content: streamingContent.value,
                  tool_calls: null,
                  tool_call_id: null,
                  tool_name: null,
                  reasoning: null,
                  model_used: null,
                  tokens_used: null,
                  finish_reason: 'stop',
                  created_at: new Date().toISOString(),
                })
              }
              streamingContent.value = ''
              streaming.value = false
              thinking.value = false
              thinkingLabel.value = ''
              await loadConversations()
              break
            case 'error':
              gotDone = true
              console.error('[assistant] Stream error:', event.message)
              messages.value.push({
                id: crypto.randomUUID(),
                conversation_id: currentConversationId.value || '',
                role: 'assistant',
                content: `Error: ${event.message}`,
                tool_calls: null,
                tool_call_id: null,
                tool_name: null,
                reasoning: null,
                model_used: null,
                tokens_used: null,
                finish_reason: null,
                created_at: new Date().toISOString(),
              })
              streaming.value = false
              thinking.value = false
              break
          }
        }
      }

      // Stream ended without a done/error event
      if (!gotDone) {
        console.warn('[assistant] Stream ended without done event. Content so far:', streamingContent.value)
        if (streamingContent.value) {
          messages.value.push({
            id: crypto.randomUUID(),
            conversation_id: currentConversationId.value || '',
            role: 'assistant',
            content: streamingContent.value,
            tool_calls: null, tool_call_id: null, tool_name: null,
            reasoning: null, model_used: null, tokens_used: null,
            finish_reason: null,
            created_at: new Date().toISOString(),
          })
        }
        streamingContent.value = ''
        streaming.value = false
        thinking.value = false
      }
    } catch (err: any) {
      streaming.value = false
      thinking.value = false
      messages.value.push({
        id: crypto.randomUUID(),
        conversation_id: currentConversationId.value || '',
        role: 'assistant',
        content: `Connection error: ${err?.message || 'Unknown error'}`,
        tool_calls: null,
        tool_call_id: null,
        tool_name: null,
        reasoning: null,
        model_used: null,
        tokens_used: null,
        finish_reason: null,
        created_at: new Date().toISOString(),
      })
    }
  }

  function formatToolLabel(toolName: string): string {
    const labels: Record<string, string> = {
      resolve_help: 'Looking up Help…',
      get_help_article: 'Loading Help article…',
      list_help_articles: 'Browsing Help…',
      get_catalog_health: 'Checking catalog health...',
      sample_products: 'Sampling products...',
      search_products_summary: 'Summarizing search...',
      export_catalog_csv: 'Exporting catalog CSV...',
      get_catalog_data_ops: 'Checking data ops / retail-POS readiness...',
      get_catalog_stats: 'Counting catalog...',
      search_products: 'Searching catalog...',
      get_product: 'Loading product...',
      get_ops_snapshot: 'Checking ops queues...',
      get_capabilities: 'Checking what Fran can do...',
      get_inventory_ats: 'Checking ATS by location...',
      get_product_inventory_status: 'Checking product logistics status...',
      get_inventory_summary: 'Checking inventory...',
      get_low_stock_alerts: 'Checking low stock...',
      get_expiry_summary: 'Checking expiry...',
      get_top_products_by_value: 'Calculating top products...',
      get_recent_activity: 'Loading activity...',
      get_actions_queue: 'Loading Actions queue...',
      send_slack_notification: 'Sending to Slack...',
    }
    return labels[toolName] || `Running ${toolName}...`
  }

  return {
    isOpen,
    conversations,
    currentConversationId,
    messages,
    streaming,
    streamingContent,
    thinking,
    thinkingLabel,
    showHistory,
    contextType,
    contextId,
    contextLabel,
    open,
    close,
    toggle,
    backToHistory,
    backToChat,
    setContext,
    clearContext,
    loadConversations,
    loadConversation,
    newConversation,
    currentChatTitle,
    sendMessage,
  }
}
