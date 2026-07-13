<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const { getBySlug } = useHelp()
const { setContext, clearContext } = useAssistant()

const loading = ref(true)
const error = ref('')
const article = ref<Awaited<ReturnType<typeof getBySlug>>>(null)

function renderMarkdown(text: string): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, '<pre class="overflow-x-auto rounded-lg bg-gray-950 p-3 text-xs font-mono my-3"><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-gray-800 px-1 text-xs font-mono text-indigo-200">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-indigo-400 hover:underline">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white">$1</strong>')
    .replace(/^### (.+)$/gm, '<h3 class="mt-4 text-sm font-semibold text-white">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="mt-6 text-base font-bold text-white">$1</h2>')
    .replace(/^\| (.+) \|$/gm, (row) => {
      // leave tables as preformatted-ish lines
      return `<div class="font-mono text-xs text-gray-300 my-0.5">${row}</div>`
    })
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-gray-300">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-gray-300">$1</li>')
    .replace(/\n\n/g, '</p><p class="mt-3 text-sm text-gray-300 leading-relaxed">')
    .replace(/\n/g, '<br>')
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const slug = String(route.params.slug || '')
    article.value = await getBySlug(slug)
    if (!article.value) {
      error.value = 'Article not found'
      clearContext()
    } else {
      setContext(
        'help',
        article.value.slug,
        { slug: article.value.slug, title: article.value.title, primary_path: article.value.primary_path },
        article.value.title,
      )
    }
  } catch (e: any) {
    error.value = e?.message || 'Failed to load'
    article.value = null
  } finally {
    loading.value = false
  }
}

watch(() => route.params.slug, load, { immediate: true })
onUnmounted(() => clearContext())
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <button type="button" class="btn-ghost mb-4 text-xs text-gray-400" @click="router.push('/help')">
      ← Help Center
    </button>

    <div v-if="loading" class="card p-8 text-center text-sm text-gray-500">Loading…</div>
    <div v-else-if="error || !article" class="card p-6 text-sm text-red-300">
      {{ error || 'Not found' }}
    </div>

    <article v-else class="space-y-4">
      <header class="mb-2">
        <p class="text-xs uppercase tracking-wide text-gray-500">{{ article.category }}</p>
        <h1 class="mt-1 text-2xl font-bold text-white">{{ article.title }}</h1>
        <p v-if="article.summary" class="mt-2 text-sm text-gray-400">{{ article.summary }}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <NuxtLink
            v-if="article.primary_path"
            :to="article.primary_path"
            class="btn-primary text-sm"
          >
            Open {{ article.primary_path }}
          </NuxtLink>
          <NuxtLink
            v-for="p in (article.related_paths || []).filter((x) => x !== article.primary_path)"
            :key="p"
            :to="p"
            class="btn-secondary text-sm"
          >
            {{ p }}
          </NuxtLink>
        </div>
      </header>

      <div class="card p-6">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div
          class="help-body text-sm leading-relaxed text-gray-300"
          v-html="`<p class=&quot;text-sm text-gray-300 leading-relaxed&quot;>${renderMarkdown(article.body_md)}</p>`"
        />
      </div>

      <p class="text-center text-xs text-gray-600">
        Still stuck? Ask <strong class="text-gray-400">Catalog AI</strong> a data question, or search
        <NuxtLink to="/help" class="text-indigo-400 hover:underline">Help</NuxtLink>.
      </p>
    </article>
  </div>
</template>
