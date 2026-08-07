<script setup lang="ts">
const { articles, loading, error, fetchArticles } = useHelp()
const { setContext, clearContext } = useAssistant()
const search = ref('')
const categoryFilter = ref('')
const mobileFiltersOpen = ref(false)

const categories = computed(() => {
  const set = new Map<string, number>()
  for (const a of articles.value) {
    set.set(a.category, (set.get(a.category) || 0) + 1)
  }
  return [...set.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }))
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return articles.value.filter((a) => {
    if (categoryFilter.value && a.category !== categoryFilter.value) return false
    if (!q) return true
    const hay = `${a.title} ${a.summary || ''} ${a.intent_tags?.join(' ') || ''} ${a.slug}`.toLowerCase()
    return hay.includes(q)
  })
})

const grouped = computed(() => {
  if (categoryFilter.value) {
    return [{ name: categoryFilter.value, items: filtered.value }]
  }
  const map = new Map<string, typeof filtered.value>()
  for (const a of filtered.value) {
    const list = map.get(a.category) || []
    list.push(a)
    map.set(a.category, list)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, items]) => ({ name, items }))
})

function categoryLabel(c: string) {
  return c.replace(/-/g, ' ')
}

function selectCategory(name: string) {
  categoryFilter.value = categoryFilter.value === name ? '' : name
  mobileFiltersOpen.value = false
}

function clearFilters() {
  search.value = ''
  categoryFilter.value = ''
}

onMounted(async () => {
  await fetchArticles()
  setContext('help', 'index', { count: articles.value.length }, 'Help Center')
})
onUnmounted(() => clearContext())
</script>

<template>
  <div class="flex min-h-0 w-full flex-col">
    <!-- Header -->
    <div class="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <h1 class="text-xl font-bold text-ink sm:text-2xl">Help Center</h1>
        <p class="mt-1 text-sm text-muted">
          How-to guides for Fran SKUMS.
          <span class="hidden sm:inline">
            Catalog AI will point you here for “where do I…?” questions.
            Live data still uses <strong class="text-ink-soft">Catalog AI</strong>.
          </span>
        </p>
      </div>
      <p
        v-if="!loading && !error"
        class="shrink-0 text-xs text-muted sm:text-sm"
      >
        <span class="font-medium text-ink-soft">{{ filtered.length }}</span>
        of {{ articles.length }} article{{ articles.length === 1 ? '' : 's' }}
      </p>
    </div>

    <!-- Sticky search + filters (mobile-friendly) -->
    <div
      class="sticky top-0 z-10 -mx-4 mb-4 border-b border-line bg-cream/95 px-4 py-3 backdrop-blur sm:mx-0 sm:mb-6 sm:rounded-xl sm:border sm:border-line sm:bg-surface-sunken sm:px-4 sm:py-3"
    >
      <div class="flex flex-col gap-3">
        <div class="flex gap-2">
          <div class="relative min-w-0 flex-1">
            <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
              </svg>
            </span>
            <input
              v-model="search"
              type="search"
              enterkeyhint="search"
              autocomplete="off"
              class="input-field w-full py-2.5 pl-9 text-base sm:text-sm"
              placeholder="Search help…"
              aria-label="Search help articles"
            >
          </div>
          <button
            type="button"
            class="btn-secondary flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm lg:hidden"
            :class="categoryFilter || mobileFiltersOpen ? 'border-yellow-deep text-brown' : ''"
            :aria-expanded="mobileFiltersOpen"
            @click="mobileFiltersOpen = !mobileFiltersOpen"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 4h18M6 12h12M10 20h4" />
            </svg>
            <span class="hidden xs:inline">Filter</span>
          </button>
          <button
            v-if="search || categoryFilter"
            type="button"
            class="btn-ghost shrink-0 px-2 text-xs text-muted"
            @click="clearFilters"
          >
            Clear
          </button>
        </div>

        <!-- Mobile category chips (always visible when open or has filter) -->
        <div
          v-show="mobileFiltersOpen || categoryFilter"
          class="lg:hidden"
        >
          <div class="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-thin">
            <button
              type="button"
              class="shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors"
              :class="!categoryFilter
                ? 'border-indigo-500 bg-yellow-deep/20 text-brown-soft'
                : 'border-line bg-white text-muted active:bg-surface-sunken'"
              @click="categoryFilter = ''"
            >
              All ({{ articles.length }})
            </button>
            <button
              v-for="c in categories"
              :key="c.name"
              type="button"
              class="shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors"
              :class="categoryFilter === c.name
                ? 'border-indigo-500 bg-yellow-deep/20 text-brown-soft'
                : 'border-line bg-white text-muted active:bg-surface-sunken'"
              @click="selectCategory(c.name)"
            >
              {{ categoryLabel(c.name) }} ({{ c.count }})
            </button>
          </div>
        </div>

        <!-- Desktop category chips under search (compact when many) -->
        <div class="hidden lg:block">
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors"
              :class="!categoryFilter
                ? 'border-indigo-500 bg-yellow-deep/20 text-brown-soft'
                : 'border-line bg-white text-muted hover:border-line-strong hover:text-ink-soft'"
              @click="categoryFilter = ''"
            >
              All
            </button>
            <button
              v-for="c in categories"
              :key="c.name"
              type="button"
              class="rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors"
              :class="categoryFilter === c.name
                ? 'border-indigo-500 bg-yellow-deep/20 text-brown-soft'
                : 'border-line bg-white text-muted hover:border-line-strong hover:text-ink-soft'"
              @click="selectCategory(c.name)"
            >
              {{ categoryLabel(c.name) }}
              <span class="ml-1 text-muted">{{ c.count }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Body: sidebar + list (full width) -->
    <div class="flex w-full flex-col gap-6 lg:flex-row lg:items-start">
      <!-- Desktop category sidebar -->
      <aside class="hidden w-52 shrink-0 lg:block xl:w-56">
        <div class="sticky top-[4.5rem] rounded-xl border border-line bg-surface-sunken/80 p-3">
          <p class="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Categories
          </p>
          <nav class="space-y-0.5" aria-label="Help categories">
            <button
              type="button"
              class="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors"
              :class="!categoryFilter
                ? 'bg-yellow-deep/15 text-brown-soft'
                : 'text-muted hover:bg-surface-sunken/80 hover:text-ink-soft'"
              @click="categoryFilter = ''"
            >
              <span>All articles</span>
              <span class="text-xs tabular-nums text-muted">{{ articles.length }}</span>
            </button>
            <button
              v-for="c in categories"
              :key="c.name"
              type="button"
              class="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm capitalize transition-colors"
              :class="categoryFilter === c.name
                ? 'bg-yellow-deep/15 text-brown-soft'
                : 'text-muted hover:bg-surface-sunken/80 hover:text-ink-soft'"
              @click="selectCategory(c.name)"
            >
              <span class="truncate pr-2">{{ categoryLabel(c.name) }}</span>
              <span class="shrink-0 text-xs tabular-nums text-muted">{{ c.count }}</span>
            </button>
          </nav>
        </div>
      </aside>

      <!-- Article list / grid -->
      <div class="min-w-0 flex-1">
        <div v-if="loading" class="card p-8 text-center text-sm text-muted">
          Loading help…
        </div>
        <div v-else-if="error" class="card p-6 text-sm text-danger">
          {{ error }}
          <p class="mt-2 text-xs text-muted">
            If the table is missing, run migration
            <code class="text-muted">053_help_articles</code>.
          </p>
        </div>
        <div v-else-if="filtered.length === 0" class="card p-8 text-center text-sm text-muted">
          No articles match.
          <button type="button" class="mt-3 block w-full text-brown hover:underline" @click="clearFilters">
            Clear filters
          </button>
        </div>

        <div v-else class="space-y-8">
          <section v-for="group in grouped" :key="group.name">
            <h2
              v-if="!categoryFilter || grouped.length > 1"
              class="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted"
            >
              <span class="capitalize">{{ categoryLabel(group.name) }}</span>
              <span class="rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] tabular-nums text-muted">
                {{ group.items.length }}
              </span>
            </h2>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              <NuxtLink
                v-for="a in group.items"
                :key="a.id"
                :to="`/help/${a.slug}`"
                class="card group flex flex-col p-4 transition-colors active:bg-white hover:border-line hover:bg-surface-sunken"
              >
                <div class="flex items-start justify-between gap-2">
                  <h3 class="text-sm font-semibold leading-snug text-ink group-hover:text-brown sm:text-base">
                    {{ a.title }}
                  </h3>
                  <span
                    class="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] capitalize text-muted sm:text-xs"
                  >
                    {{ categoryLabel(a.category) }}
                  </span>
                </div>
                <p
                  v-if="a.summary"
                  class="mt-2 line-clamp-2 flex-1 text-xs leading-relaxed text-muted sm:text-sm"
                >
                  {{ a.summary }}
                </p>
                <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    v-if="a.primary_path"
                    class="max-w-full truncate rounded bg-yellow-deep/10 px-2 py-0.5 font-mono text-[11px] text-brown"
                  >{{ a.primary_path }}</span>
                  <span class="ml-auto text-muted group-hover:text-brown">Open →</span>
                </div>
              </NuxtLink>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
