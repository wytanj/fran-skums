<script setup lang="ts">
const { articles, loading, error, fetchArticles } = useHelp()
const { setContext, clearContext } = useAssistant()
const search = ref('')

const categories = computed(() => {
  const set = new Map<string, number>()
  for (const a of articles.value) {
    set.set(a.category, (set.get(a.category) || 0) + 1)
  }
  return [...set.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }))
})

const categoryFilter = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return articles.value.filter((a) => {
    if (categoryFilter.value && a.category !== categoryFilter.value) return false
    if (!q) return true
    const hay = `${a.title} ${a.summary || ''} ${a.intent_tags?.join(' ') || ''} ${a.slug}`.toLowerCase()
    return hay.includes(q)
  })
})

function categoryLabel(c: string) {
  return c.replace(/-/g, ' ')
}

onMounted(async () => {
  await fetchArticles()
  setContext('help', 'index', { count: articles.value.length }, 'Help Center')
})
onUnmounted(() => clearContext())
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <div class="mb-8">
      <h1 class="text-2xl font-bold text-white">Help Center</h1>
      <p class="mt-1 text-sm text-gray-400">
        How-to guides for Fran SKUMS. Catalog AI will point you here for “where do I…?” questions.
        Live data questions still use <strong class="text-gray-300">Catalog AI</strong>.
      </p>
    </div>

    <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <input
        v-model="search"
        type="search"
        class="input-field flex-1"
        placeholder="Search help (edit products, import, approve, POS…)"
      >
      <select v-model="categoryFilter" class="input-field sm:w-48">
        <option value="">All categories</option>
        <option v-for="c in categories" :key="c.name" :value="c.name">
          {{ categoryLabel(c.name) }} ({{ c.count }})
        </option>
      </select>
    </div>

    <div v-if="loading" class="card p-8 text-center text-sm text-gray-500">Loading help…</div>
    <div v-else-if="error" class="card p-6 text-sm text-red-300">
      {{ error }}
      <p class="mt-2 text-xs text-gray-500">
        If the table is missing, run migration <code class="text-gray-400">053_help_articles</code>.
      </p>
    </div>
    <div v-else-if="filtered.length === 0" class="card p-8 text-center text-sm text-gray-500">
      No articles match. Try another search or clear filters.
    </div>
    <div v-else class="space-y-3">
      <NuxtLink
        v-for="a in filtered"
        :key="a.id"
        :to="`/help/${a.slug}`"
        class="card block p-4 transition-colors hover:border-indigo-500/40 hover:bg-gray-900/80"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 class="text-base font-semibold text-white">{{ a.title }}</h2>
            <p v-if="a.summary" class="mt-1 text-sm text-gray-400">{{ a.summary }}</p>
          </div>
          <span class="shrink-0 rounded-full bg-gray-800 px-2.5 py-0.5 text-xs capitalize text-gray-400">
            {{ categoryLabel(a.category) }}
          </span>
        </div>
        <div class="mt-3 flex flex-wrap gap-2 text-xs">
          <span
            v-if="a.primary_path"
            class="rounded bg-indigo-500/10 px-2 py-0.5 font-mono text-indigo-300"
          >{{ a.primary_path }}</span>
          <span class="text-gray-600">Open article →</span>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
