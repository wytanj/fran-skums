<script setup lang="ts">
const {
  isOpen,
  conversations,
  currentConversationId,
  messages,
  streaming,
  streamingContent,
  thinking,
  thinkingLabel,
  showHistory,
  contextLabel,
  open,
  close,
  newConversation,
  loadConversations,
  loadConversation,
  sendMessage,
  backToHistory,
  backToChat,
  currentChatTitle,
} = useAssistant()

const { currentWorkspace } = useWorkspace()

const catalogPrompts = [
  'How many products are in this catalog?',
  'Where should I go to edit products?',
  'How do I approve a store replenishment request?',
  'How do POS receive exceptions get verified?',
  'How do floor damage reports update stock?',
  'What is in my Actions queue?',
]

const input = ref('')
const messagesEl = ref<HTMLElement>()

/** Chat has been started (messages or in-flight stream) */
const hasActiveChat = computed(
  () => messages.value.some(m => m.role === 'user' || m.role === 'assistant')
    || Boolean(currentConversationId.value)
    || streaming.value
    || Boolean(streamingContent.value),
)

/** Show back control: leave chat → history (or empty home if no history) */
const showBackButton = computed(() => {
  if (showHistory.value) return false
  return hasActiveChat.value
})

function handleKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (showHistory.value) {
      backToChat()
      return
    }
    if (hasActiveChat.value && !streaming.value) {
      goBackFromChat()
      return
    }
    close()
  }
  if (e.key === 'Enter' && !e.shiftKey && isOpen.value && !showHistory.value) {
    // handled by textarea
  }
}

async function submit() {
  const text = input.value.trim()
  if (!text || streaming.value) return
  input.value = ''
  await sendMessage(text)
}

async function openHistory() {
  await loadConversations()
  backToHistory()
}

function goBackFromChat() {
  void loadConversations()
  if (conversations.value.length > 0) {
    backToHistory()
  } else {
    newConversation()
  }
}

async function selectConversation(id: string) {
  await loadConversation(id)
}

function startNewFromHistory() {
  newConversation()
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `Today · ${formatTime(iso)}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday · ${formatTime(iso)}`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Simple markdown: bold, inline code, headers
function renderMarkdown(text: string): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, '<pre class="bg-gray-900 rounded p-2 text-xs font-mono overflow-x-auto my-1"><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="bg-gray-800 rounded px-1 text-xs font-mono">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-white mt-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-sm font-bold text-white mt-2">$1</h2>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/\n/g, '<br>')
}

// Auto-scroll to bottom on new messages
watch([messages, streamingContent], async () => {
  await nextTick()
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  }
})

// Load conversations when opened
watch(isOpen, (val) => {
  if (val && currentWorkspace.value) loadConversations()
})

onMounted(() => { window.addEventListener('keydown', handleKey) })
onUnmounted(() => { window.removeEventListener('keydown', handleKey) })

const visibleMessages = computed(() =>
  messages.value.filter(m => m.role === 'user' || m.role === 'assistant'),
)

const headerSubtitle = computed(() => {
  if (showHistory.value) return 'Chat history'
  if (hasActiveChat.value) return currentChatTitle()
  return `${currentWorkspace.value?.name || 'Workspace'} · in-app Q&A`
})
</script>

<template>
  <Teleport to="body">
    <!-- Floating trigger button -->
    <button
      v-if="!isOpen"
      class="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition-all hover:bg-indigo-500 hover:scale-105"
      title="Open AI Assistant"
      @click="open"
    >
      <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
      </svg>
    </button>

    <!-- Backdrop -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-150"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="isOpen" class="fixed inset-0 z-40 bg-black/40" @click="close" />
    </Transition>

    <!-- Drawer -->
    <Transition
      enter-active-class="transition-transform duration-300"
      enter-from-class="translate-x-full"
      enter-to-class="translate-x-0"
      leave-active-class="transition-transform duration-200"
      leave-from-class="translate-x-0"
      leave-to-class="translate-x-full"
    >
      <div
        v-if="isOpen"
        class="fixed right-0 top-0 z-50 flex h-full w-[420px] flex-col border-l border-gray-800 bg-gray-950 shadow-2xl"
      >
        <!-- Header -->
        <div class="flex shrink-0 items-center justify-between border-b border-gray-800 px-3 py-3">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <!-- Back: from history → chat home; from active chat → history -->
            <button
              v-if="showHistory"
              class="shrink-0 rounded-md p-1.5 text-gray-300 hover:bg-gray-800 hover:text-white"
              title="Back to chat"
              @click="backToChat"
            >
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
            </button>
            <button
              v-else-if="showBackButton"
              class="shrink-0 rounded-md p-1.5 text-gray-300 hover:bg-gray-800 hover:text-white"
              title="Back to chat history"
              @click="goBackFromChat"
            >
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
            </button>
            <div
              v-else
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-400"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
              </svg>
            </div>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-white">Catalog Assistant</p>
              <p class="truncate text-xs text-gray-500">{{ headerSubtitle }}</p>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-0.5">
            <button
              class="rounded-md p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
              title="New chat"
              @click="startNewFromHistory"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
            <button
              class="rounded-md p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
              :class="showHistory ? 'bg-gray-800 text-white' : ''"
              title="Chat history"
              @click="openHistory"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </button>
            <button
              class="rounded-md p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
              title="Close"
              @click="close"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Context chip -->
        <div v-if="contextLabel && !showHistory" class="shrink-0 border-b border-gray-800 px-4 py-2">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-indigo-600/10 px-2.5 py-0.5 text-xs text-indigo-400">
            Context: {{ contextLabel }}
          </span>
        </div>

        <!-- History panel -->
        <div v-if="showHistory" class="flex flex-1 flex-col overflow-hidden">
          <div class="flex items-center justify-between border-b border-gray-800 px-4 py-2.5">
            <div>
              <p class="text-xs font-medium uppercase tracking-wide text-gray-400">Chat history</p>
              <p class="text-xs text-gray-600">{{ conversations.length }} conversation{{ conversations.length === 1 ? '' : 's' }}</p>
            </div>
            <button
              class="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
              @click="startNewFromHistory"
            >
              New chat
            </button>
          </div>
          <div class="flex-1 overflow-y-auto">
            <div v-if="conversations.length === 0" class="flex flex-col items-center gap-3 p-8 text-center">
              <p class="text-sm text-gray-400">No past chats yet</p>
              <p class="text-xs text-gray-600">Start a conversation — it will show up here when you finish.</p>
              <button
                class="mt-1 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:border-indigo-500/50 hover:text-white"
                @click="startNewFromHistory"
              >
                Start a chat
              </button>
            </div>
            <button
              v-for="conv in conversations"
              :key="conv.id"
              class="w-full border-b border-gray-800/50 px-4 py-3 text-left transition-colors hover:bg-gray-900"
              :class="conv.id === currentConversationId ? 'bg-gray-900/80 border-l-2 border-l-indigo-500' : ''"
              @click="selectConversation(conv.id)"
            >
              <p class="truncate text-sm text-white">{{ conv.title || 'Untitled chat' }}</p>
              <p class="mt-0.5 text-xs text-gray-500">{{ formatDate(conv.updated_at) }}</p>
            </button>
          </div>
        </div>

        <!-- Chat area -->
        <div v-else class="flex flex-1 flex-col overflow-hidden">
          <!-- Messages -->
          <div ref="messagesEl" class="flex-1 space-y-4 overflow-y-auto p-4">
            <!-- Empty state -->
            <div v-if="visibleMessages.length === 0 && !streaming" class="flex h-full flex-col items-center justify-center gap-3 px-2 py-8 text-center">
              <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600/10 text-indigo-400">
                <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                </svg>
              </div>
              <div>
                <p class="text-sm font-medium text-white">Ask about your catalog</p>
                <p class="mt-1 max-w-xs mx-auto text-xs text-gray-500">
                  Live catalog data (counts, search). For “where do I click?”, we use
                  <NuxtLink to="/help" class="text-indigo-400 hover:underline" @click="close">Help</NuxtLink>.
                </p>
              </div>
              <div v-if="conversations.length > 0" class="w-full max-w-xs">
                <button
                  class="w-full rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-300 hover:border-indigo-500/50 hover:text-white"
                  @click="openHistory"
                >
                  Open chat history ({{ conversations.length }})
                </button>
              </div>
              <div class="mt-1 flex w-full max-w-xs flex-col gap-2">
                <button
                  v-for="prompt in catalogPrompts"
                  :key="prompt"
                  class="rounded-lg border border-gray-800 px-3 py-2 text-left text-xs text-gray-400 transition-colors hover:border-indigo-500/50 hover:text-white"
                  @click="input = prompt; submit()"
                >
                  {{ prompt }}
                </button>
              </div>
            </div>

            <!-- Message list -->
            <div
              v-for="msg in visibleMessages"
              :key="msg.id"
              :class="['flex', msg.role === 'user' ? 'justify-end' : 'justify-start']"
            >
              <div
                :class="[
                  'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm',
                  msg.role === 'user'
                    ? 'rounded-br-sm bg-indigo-600 text-white'
                    : 'rounded-bl-sm bg-gray-800 text-gray-100',
                ]"
              >
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div v-if="msg.role === 'assistant'" class="prose-sm" v-html="renderMarkdown(msg.content || '')" />
                <div v-else class="whitespace-pre-wrap">{{ msg.content }}</div>
                <div class="mt-1 text-right text-xs opacity-50">{{ formatTime(msg.created_at) }}</div>
              </div>
            </div>

            <!-- Streaming bubble -->
            <div v-if="streaming || streamingContent" class="flex justify-start">
              <div class="max-w-[85%] rounded-2xl rounded-bl-sm bg-gray-800 px-3.5 py-2.5 text-sm text-gray-100">
                <div v-if="thinking" class="flex items-center gap-2 text-xs text-amber-400">
                  <svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {{ thinkingLabel }}
                </div>
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div v-if="streamingContent" class="prose-sm" v-html="renderMarkdown(streamingContent)" />
                <span v-if="!streamingContent && !thinking" class="inline-flex gap-0.5">
                  <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500" style="animation-delay: 0ms" />
                  <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500" style="animation-delay: 150ms" />
                  <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500" style="animation-delay: 300ms" />
                </span>
              </div>
            </div>
          </div>

          <!-- Post-chat actions (after completed exchange) -->
          <div
            v-if="hasActiveChat && !streaming && visibleMessages.length > 0"
            class="flex shrink-0 items-center justify-between gap-2 border-t border-gray-800/80 bg-gray-900/50 px-3 py-2"
          >
            <button
              class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 hover:text-white"
              @click="goBackFromChat"
            >
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              History
            </button>
            <button
              class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-600/20 hover:text-indigo-200"
              @click="startNewFromHistory"
            >
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New chat
            </button>
          </div>

          <!-- Input -->
          <div class="shrink-0 border-t border-gray-800 p-3">
            <div class="flex items-end gap-2 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 focus-within:border-indigo-500/50">
              <textarea
                v-model="input"
                rows="1"
                class="flex-1 resize-none bg-transparent text-sm text-white placeholder-gray-500 outline-none"
                placeholder="e.g. How many draft products? Search brand Anua…"
                style="max-height: 120px; overflow-y: auto;"
                :disabled="streaming"
                @keydown.enter.exact.prevent="submit"
                @input="($event.target as HTMLTextAreaElement).style.height = 'auto'; ($event.target as HTMLTextAreaElement).style.height = ($event.target as HTMLTextAreaElement).scrollHeight + 'px'"
              />
              <button
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition-all hover:bg-indigo-500 disabled:opacity-40"
                :disabled="streaming || !input.trim()"
                @click="submit"
              >
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                </svg>
              </button>
            </div>
            <p class="mt-1.5 text-center text-xs text-gray-600">
              Enter to send · Esc back · History icon for past chats
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
