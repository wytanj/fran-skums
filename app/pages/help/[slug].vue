<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const { getBySlug, articles, fetchArticles } = useHelp()
const { setContext, clearContext } = useAssistant()

const loading = ref(true)
const error = ref('')
const article = ref<Awaited<ReturnType<typeof getBySlug>>>(null)

function categoryLabel(c: string) {
  return c.replace(/-/g, ' ')
}

function renderMarkdown(text: string): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /```([\s\S]*?)```/g,
      '<pre class="help-pre overflow-x-auto rounded-lg bg-gray-950 p-3 text-xs font-mono my-4 -mx-1 sm:mx-0"><code>$1</code></pre>',
    )
    .replace(
      /`([^`]+)`/g,
      '<code class="rounded bg-gray-800 px-1 py-0.5 text-[0.8em] font-mono text-indigo-200 break-all sm:break-normal">$1</code>',
    )
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="text-indigo-400 underline-offset-2 hover:underline break-words">$1</a>',
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-white">$1</strong>')
    .replace(
      /^### (.+)$/gm,
      '<h3 class="mt-5 mb-2 text-sm font-semibold text-white sm:text-base">$1</h3>',
    )
    .replace(
      /^## (.+)$/gm,
      '<h2 class="mt-7 mb-2 border-b border-gray-800 pb-1.5 text-base font-bold text-white sm:text-lg">$1</h2>',
    )
    .replace(/^\| (.+) \|$/gm, (row) => {
      return `<div class="font-mono text-[11px] sm:text-xs text-gray-300 my-0.5 overflow-x-auto whitespace-pre">${row}</div>`
    })
    .replace(
      /^- (.+)$/gm,
      '<li class="ml-4 list-disc pl-1 text-sm text-gray-300 leading-relaxed my-1">$1</li>',
    )
    .replace(
      /^\d+\. (.+)$/gm,
      '<li class="ml-4 list-decimal pl-1 text-sm text-gray-300 leading-relaxed my-1">$1</li>',
    )
    .replace(
      /\n\n/g,
      '</p><p class="mt-3 text-sm text-gray-300 leading-relaxed sm:text-[15px]">',
    )
    .replace(/\n/g, '<br>')
}

const relatedInCategory = computed(() => {
  if (!article.value) return []
  return articles.value
    .filter((a) => a.category === article.value!.category && a.slug !== article.value!.slug)
    .slice(0, 8)
})

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
        {
          slug: article.value.slug,
          title: article.value.title,
          primary_path: article.value.primary_path,
        },
        article.value.title,
      )
      // Prefetch list for related sidebar (no-op if already loaded)
      if (!articles.value.length) {
        fetchArticles().catch(() => {})
      }
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
  <div class="flex w-full min-w-0 flex-col">
    <!-- Sticky mobile/desktop back bar -->
    <div
      class="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 border-b border-gray-800/80 bg-gray-950/95 px-4 py-2.5 backdrop-blur sm:mx-0 sm:mb-6 sm:rounded-xl sm:border sm:border-gray-800 sm:bg-gray-900/80 sm:px-4"
    >
      <button
        type="button"
        class="btn-ghost -ml-1 flex min-h-10 min-w-10 items-center gap-1.5 px-2 text-sm text-gray-300"
        @click="router.push('/help')"
      >
        <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        <span class="hidden sm:inline">Help Center</span>
        <span class="sm:hidden">Back</span>
      </button>
      <span
        v-if="article"
        class="min-w-0 flex-1 truncate text-xs text-gray-500 sm:text-sm"
      >
        {{ article.title }}
      </span>
    </div>

    <div v-if="loading" class="card p-8 text-center text-sm text-gray-500">Loading…</div>
    <div v-else-if="error || !article" class="card p-6 text-sm text-red-300">
      {{ error || 'Not found' }}
      <NuxtLink to="/help" class="mt-3 block text-indigo-400 hover:underline">← Back to Help Center</NuxtLink>
    </div>

    <div
      v-else
      class="flex w-full flex-col gap-6 lg:flex-row lg:items-start lg:gap-8"
    >
      <!-- Main article (uses available width; readable measure on very wide screens) -->
      <article class="min-w-0 flex-1 lg:max-w-none xl:max-w-4xl 2xl:max-w-5xl">
        <header class="mb-4 sm:mb-6">
          <p class="text-[11px] font-medium uppercase tracking-wide text-gray-500 sm:text-xs">
            {{ categoryLabel(article.category) }}
          </p>
          <h1 class="mt-1 text-xl font-bold leading-tight text-white sm:text-2xl lg:text-3xl">
            {{ article.title }}
          </h1>
          <p v-if="article.summary" class="mt-2 text-sm text-gray-400 sm:text-base">
            {{ article.summary }}
          </p>
          <div class="mt-4 flex flex-wrap gap-2">
            <NuxtLink
              v-if="article.primary_path"
              :to="article.primary_path"
              class="btn-primary min-h-10 px-4 text-sm"
            >
              Open {{ article.primary_path }}
            </NuxtLink>
            <NuxtLink
              v-for="p in (article.related_paths || []).filter((x) => x !== article.primary_path)"
              :key="p"
              :to="p"
              class="btn-secondary min-h-10 px-3 text-sm"
            >
              {{ p }}
            </NuxtLink>
          </div>
        </header>

        <div class="card overflow-hidden p-4 sm:p-6 lg:p-8">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div
            class="help-body text-sm leading-relaxed text-gray-300"
            v-html="`<p class=&quot;text-sm text-gray-300 leading-relaxed sm:text-[15px]&quot;>${renderMarkdown(article.body_md)}</p>`"
          />
        </div>

        <p class="mt-6 text-center text-xs text-gray-600 sm:mt-8">
          Still stuck? Ask <strong class="text-gray-400">Catalog AI</strong> a data question, or
          <NuxtLink to="/help" class="text-indigo-400 hover:underline">browse Help</NuxtLink>.
        </p>
      </article>

      <!-- Related / category rail (desktop); stacks under article on mobile -->
      <aside
        v-if="relatedInCategory.length"
        class="w-full shrink-0 border-t border-gray-800 pt-6 lg:sticky lg:top-[4.5rem] lg:w-64 lg:border-t-0 lg:pt-0 xl:w-72"
      >
        <div class="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <p class="mb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            More in {{ categoryLabel(article.category) }}
          </p>
          <ul class="space-y-1">
            <li v-for="r in relatedInCategory" :key="r.id">
              <NuxtLink
                :to="`/help/${r.slug}`"
                class="block rounded-lg px-2.5 py-2.5 text-sm text-gray-400 transition-colors hover:bg-gray-800/80 hover:text-indigo-300 active:bg-gray-800"
              >
                {{ r.title }}
              </NuxtLink>
            </li>
          </ul>
          <NuxtLink
            to="/help"
            class="mt-3 block rounded-lg px-2.5 py-2 text-xs text-indigo-400 hover:underline"
          >
            All help articles →
          </NuxtLink>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.help-body :deep(pre.help-pre) {
  max-width: 100%;
  -webkit-overflow-scrolling: touch;
}
.help-body :deep(a) {
  word-break: break-word;
}
.help-body :deep(li) {
  word-break: break-word;
}
</style>
