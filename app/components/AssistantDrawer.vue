<script setup lang="ts">
const {
  isOpen, conversations, currentConversationId, messages, streaming, streamingContent,
  thinking, thinkingLabel, showHistory, contextLabel,
  open, close, newConversation, loadConversations, loadConversation, sendMessage,
} = useAssistant()

const { currentWorkspace } = useWorkspace()

const catalogPrompts = [
  'How many products are in this catalog?',
  'Break down products by status (draft vs active)',
  'Which brands have the most products?',
  'Search for products missing a SKU',
  'Show me low stock products',
  'What is in my Actions queue?',
]

const input = ref('')
const messagesEl = ref<HTMLElement>()

function handleKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
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
  showHistory.value = true
}

async function selectConversation(id: string) {
  await loadConversation(id)
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString()
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

// Keyboard listener
onMounted(() => { window.addEventListener('keydown', handleKey) })
onUnmounted(() => { window.removeEventListener('keydown', handleKey) })

const visibleMessages = computed(() =>
  messages.value.filter(m => m.role === 'user' || m.role === 'assistant')
)
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
        <div class="flex shrink-0 items-center justify-between border-b border-gray-800 px-4 py-3">
          <div class="flex items-center gap-2">
            <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-400">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
              </svg>
            </div>
            <div>
              <p class="text-sm font-semibold text-white">Catalog Assistant</p>
              <p class="text-xs text-gray-500">{{ currentWorkspace?.name }} · in-app Q&amp;A</p>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button
              class="rounded-md p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
              title="New conversation"
              @click="newConversation"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
            <button
              class="rounded-md p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
              title="Conversation history"
              @click="openHistory"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </button>
            <button
              class="rounded-md p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
              @click="close"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Context chip -->
        <div v-if="contextLabel" class="shrink-0 border-b border-gray-800 px-4 py-2">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-indigo-600/10 px-2.5 py-0.5 text-xs text-indigo-400">
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 15l-6-6m0 0l6-6m-6 6h12" />
            </svg>
            Context: {{ contextLabel }}
          </span>
        </div>

        <!-- History panel -->
        <div v-if="showHistory" class="flex flex-col overflow-hidden flex-1">
          <div class="flex items-center justify-between px-4 py-2 border-b border-gray-800">
            <p class="text-xs font-medium text-gray-400 uppercase tracking-wide">Recent Conversations</p>
            <button class="text-xs text-gray-500 hover:text-white" @click="showHistory = false">Back</button>
          </div>
          <div class="flex-1 overflow-y-auto">
            <div v-if="conversations.length === 0" class="p-4 text-center text-sm text-gray-500">
              No conversations yet
            </div>
            <button
              v-for="conv in conversations"
              :key="conv.id"
              class="w-full px-4 py-3 text-left hover:bg-gray-900 border-b border-gray-800/50 transition-colors"
              @click="selectConversation(conv.id)"
            >
              <p class="text-sm text-white truncate">{{ conv.title }}</p>
              <p class="text-xs text-gray-500 mt-0.5">{{ formatDate(conv.updated_at) }}</p>
            </button>
          </div>
        </div>

        <!-- Chat area -->
        <div v-else class="flex flex-1 flex-col overflow-hidden">
          <!-- Messages -->
          <div ref="messagesEl" class="flex-1 overflow-y-auto p-4 space-y-4">
            <!-- Empty state -->
            <div v-if="visibleMessages.length === 0 && !streaming" class="flex flex-col items-center justify-center h-full text-center py-8 gap-3 px-2">
              <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600/10 text-indigo-400">
                <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                </svg>
              </div>
              <div>
                <p class="text-sm font-medium text-white">Ask about your catalog</p>
                <p class="text-xs text-gray-500 mt-1 max-w-xs mx-auto">
                  Live counts &amp; search over imported products (10k+ OK).
                  Marketplace study / draft POs from an IDE use <strong class="text-gray-400">MCP</strong>; approve in <strong class="text-gray-400">Actions</strong>.
                </p>
              </div>
              <div class="mt-1 flex flex-col gap-2 w-full max-w-xs">
                <button
                  v-for="prompt in catalogPrompts"
                  :key="prompt"
                  class="rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-400 hover:border-indigo-500/50 hover:text-white text-left transition-colors"
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
                    ? 'bg-indigo-600 text-white rounded-br-sm'
                    : 'bg-gray-800 text-gray-100 rounded-bl-sm',
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
                <div v-if="thinking" class="flex items-center gap-2 text-amber-400 text-xs">
                  <svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {{ thinkingLabel }}
                </div>
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div v-if="streamingContent" class="prose-sm" v-html="renderMarkdown(streamingContent)" />
                <span v-if="!streamingContent && !thinking" class="inline-flex gap-0.5">
                  <span class="h-1.5 w-1.5 rounded-full bg-gray-500 animate-bounce" style="animation-delay: 0ms" />
                  <span class="h-1.5 w-1.5 rounded-full bg-gray-500 animate-bounce" style="animation-delay: 150ms" />
                  <span class="h-1.5 w-1.5 rounded-full bg-gray-500 animate-bounce" style="animation-delay: 300ms" />
                </span>
              </div>
            </div>
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
                class="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white transition-all hover:bg-indigo-500 disabled:opacity-40"
                :disabled="streaming || !input.trim()"
                @click="submit"
              >
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                </svg>
              </button>
            </div>
            <p class="mt-1.5 text-center text-xs text-gray-600">
              Enter to send · In-app only (not MCP)
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
