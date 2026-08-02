<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const {
  loading,
  error,
  session,
  artifacts,
  pipeline,
  canWrite,
  statusClass,
  artifactBadge,
  relativeTime,
  metaOf,
  subjectLabel,
  titleOf,
  descriptionOf,
  crawlIntent,
  loadNotebook,
  addNote,
  updateNotebook,
} = useResearch()
const { setContext, clearContext } = useAssistant()
const { notify } = useActionFeedback()

const busy = ref(false)
const noteBody = ref('')
const noteTitle = ref('')
const noteUrl = ref('')
const showRaw = ref(false)
const editingCover = ref(false)
const coverForm = reactive({ title: '', description: '' })

const id = computed(() => String(route.params.id || ''))

async function reload() {
  const pack = await loadNotebook(id.value)
  if (pack?.session) {
    coverForm.title = titleOf(pack.session)
    coverForm.description = descriptionOf(pack.session)
    editingCover.value = false
    setContext(
      'research',
      id.value,
      {
        status: pack.session.status,
        brand_key: metaOf(pack.session).brand_key,
        crawl_intent: crawlIntent(pack.session),
      },
      titleOf(pack.session).slice(0, 80),
    )
  }
}

watch(id, () => {
  void reload()
}, { immediate: true })

onUnmounted(() => clearContext())

function artifactBody(a: any) {
  const p = a?.payload || {}
  if (typeof p.body === 'string') return p.body
  if (a.artifact_type === 'brief' && p.grounded) {
    const g = p.grounded
    const claims = Array.isArray(g.claims) ? g.claims.map((c: any) => `• ${c.text}`).join('\n') : ''
    const unknowns = Array.isArray(g.unknowns) && g.unknowns.length
      ? `\nUnknowns: ${g.unknowns.join('; ')}`
      : ''
    const rec = g.recommendation?.action
      ? `\nRecommendation: ${g.recommendation.action} (${g.recommendation.confidence ?? '—'})`
      : ''
    return [claims, unknowns, rec].filter(Boolean).join('\n') || JSON.stringify(p, null, 2)
  }
  if (a.artifact_type === 'match' && p.rule_matches) {
    return (p.rule_matches as any[])
      .slice(0, 8)
      .map((m) => `• ${m.title} (${m.confidence}) via ${m.match_type}`)
      .join('\n')
  }
  if (p.discovery) {
    return (p.discovery as any[])
      .map((d) => `${d.channel ? `[${d.channel}] ` : ''}${d.url || ''}${d.note ? ` — ${d.note}` : ''}`)
      .join('\n')
  }
  try {
    return JSON.stringify(p, null, 2)
  } catch {
    return '—'
  }
}

async function onAddNote() {
  if (!canWrite.value || !session.value) return
  busy.value = true
  try {
    await addNote(session.value.id, {
      body: noteBody.value,
      title: noteTitle.value || undefined,
      url: noteUrl.value || undefined,
    })
    noteBody.value = ''
    noteTitle.value = ''
    noteUrl.value = ''
    notify.success('Note added')
    await reload()
  } catch (e: any) {
    notify.error(e)
  } finally {
    busy.value = false
  }
}

async function onStatus(status: string) {
  if (!session.value || !canWrite.value) return
  if (!confirm(`Set status to ${status}?`)) return
  busy.value = true
  try {
    await updateNotebook(session.value.id, { status })
    notify.success(`Status → ${status}`)
    await reload()
  } catch (e: any) {
    notify.error(e)
  } finally {
    busy.value = false
  }
}

async function onCrawlIntent(intent: 'none' | 'later' | 'active') {
  if (!session.value || !canWrite.value) return
  busy.value = true
  try {
    await updateNotebook(session.value.id, { crawl_intent: intent })
    notify.success(`Crawl intent → ${intent}`)
    await reload()
  } catch (e: any) {
    notify.error(e)
  } finally {
    busy.value = false
  }
}

function startEditCover() {
  if (!session.value) return
  coverForm.title = titleOf(session.value)
  coverForm.description = descriptionOf(session.value)
  editingCover.value = true
}

async function saveCover() {
  if (!session.value || !canWrite.value) return
  if (!coverForm.title.trim()) {
    notify.error(new Error('Title is required'))
    return
  }
  busy.value = true
  try {
    await updateNotebook(session.value.id, {
      title: coverForm.title.trim(),
      description: coverForm.description.trim() || null,
    })
    notify.success('Cover updated')
    await reload()
  } catch (e: any) {
    notify.error(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <button type="button" class="btn-ghost mb-4 text-xs text-gray-400" @click="router.push('/research')">
      ← Research
    </button>

    <div v-if="loading && !session" class="card p-8 text-center text-sm text-gray-500">Loading…</div>
    <div v-else-if="error && !session" class="card p-6 text-red-300">{{ error }}</div>

    <template v-else-if="session">
      <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <p class="text-xs uppercase tracking-wide text-gray-500">
            {{ subjectLabel(session) }} research
            <span v-if="metaOf(session).brand_key"> · {{ metaOf(session).brand_key }}</span>
          </p>
          <template v-if="!editingCover">
            <h1 class="mt-1 text-xl font-bold text-white">{{ titleOf(session) }}</h1>
            <p
              v-if="descriptionOf(session)"
              class="mt-2 text-sm text-gray-300 whitespace-pre-wrap"
            >
              {{ descriptionOf(session) }}
            </p>
            <p v-else-if="canWrite" class="mt-2 text-xs text-gray-600">
              No description yet —
              <button type="button" class="text-indigo-400 hover:underline" @click="startEditCover">
                add one
              </button>
            </p>
          </template>
          <div v-else class="mt-3 space-y-3">
            <div>
              <label class="label-field">Title (product / brand name)</label>
              <input v-model="coverForm.title" class="input-field" placeholder="e.g. Olaplex Volumizing Blow Dry Mist 150ml" />
            </div>
            <div>
              <label class="label-field">Description</label>
              <textarea
                v-model="coverForm.description"
                rows="3"
                class="input-field"
                placeholder="Why we care, popularity signal, what to benchmark…"
              />
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn-primary text-sm" :disabled="busy" @click="saveCover">
                Save
              </button>
              <button type="button" class="btn-ghost text-sm" :disabled="busy" @click="editingCover = false">
                Cancel
              </button>
            </div>
          </div>
          <p v-if="session.query" class="mt-2 text-sm text-gray-400">
            Shopee query (optional): <span class="text-gray-300">{{ session.query }}</span>
          </p>
          <p class="mt-1 text-xs text-gray-600">
            Opened {{ relativeTime(session.created_at) }}
            · {{ session.marketplace }}/{{ session.country }}
            <button
              v-if="canWrite && !editingCover"
              type="button"
              class="ml-2 text-indigo-400 hover:underline"
              @click="startEditCover"
            >
              Edit title / description
            </button>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span :class="['rounded-full px-2.5 py-1 text-xs font-medium ring-1', statusClass(session.status)]">
            {{ session.status }}
          </span>
          <span class="rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-gray-700 text-gray-400">
            crawl: {{ crawlIntent(session) }}
          </span>
        </div>
      </div>

      <div
        class="mb-6 rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3 text-xs text-gray-400"
      >
        This is a <strong class="text-gray-300">notebook</strong>, not a harvest job.
        MCP: <code class="text-violet-300">study_add_note</code>,
        <code class="text-violet-300">study_match_catalog</code>,
        <code class="text-violet-300">study_brief</code>.
        To watch Shopee: propose <code class="text-violet-300">watchlist_seed</code> →
        <NuxtLink to="/actions" class="text-indigo-400 hover:underline">Actions</NuxtLink>.
      </div>

      <!-- Discovery strip -->
      <div
        v-if="metaOf(session).discovery?.length || metaOf(session).discovery_url"
        class="card mb-6 p-4"
      >
        <h2 class="mb-2 text-xs font-medium uppercase text-gray-500">Discovery</h2>
        <ul class="space-y-2 text-sm">
          <li
            v-for="(d, i) in metaOf(session).discovery?.length
              ? metaOf(session).discovery
              : [{ url: metaOf(session).discovery_url, channel: metaOf(session).discovery_channel }]"
            :key="i"
          >
            <span v-if="d.channel" class="text-gray-500">[{{ d.channel }}] </span>
            <a
              v-if="d.url"
              :href="d.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-sky-400 hover:underline break-all"
            >{{ d.url }}</a>
            <span v-if="d.note" class="text-gray-400"> — {{ d.note }}</span>
          </li>
        </ul>
      </div>

      <!-- Actions -->
      <div v-if="canWrite" class="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          class="btn-secondary text-xs"
          :disabled="busy || crawlIntent(session) === 'later'"
          @click="onCrawlIntent('later')"
        >
          Mark crawl: later
        </button>
        <button
          type="button"
          class="btn-secondary text-xs"
          :disabled="busy || crawlIntent(session) === 'none'"
          @click="onCrawlIntent('none')"
        >
          Mark crawl: none
        </button>
        <button
          v-if="session.status !== 'closed'"
          type="button"
          class="btn-ghost text-xs"
          :disabled="busy"
          @click="onStatus('closed')"
        >
          Close notebook
        </button>
        <button
          v-if="session.status === 'closed' || session.status === 'cancelled'"
          type="button"
          class="btn-ghost text-xs"
          :disabled="busy"
          @click="onStatus('open')"
        >
          Reopen
        </button>
      </div>

      <!-- Add note -->
      <div v-if="canWrite" class="card mb-6 p-4">
        <h2 class="mb-3 text-xs font-medium uppercase text-gray-500">Add note</h2>
        <div class="space-y-3">
          <input v-model="noteTitle" class="input-field text-sm" placeholder="Title (optional)" />
          <input v-model="noteUrl" class="input-field text-sm" placeholder="URL (optional)" />
          <textarea
            v-model="noteBody"
            rows="3"
            class="input-field text-sm"
            placeholder="Buyer notes, price seen, why popular…"
          />
          <button
            type="button"
            class="btn-primary text-sm"
            :disabled="busy || !noteBody.trim()"
            @click="onAddNote"
          >
            {{ busy ? 'Saving…' : 'Add note' }}
          </button>
        </div>
      </div>

      <!-- Pipeline links -->
      <div v-if="pipeline.length" class="card mb-6 p-4">
        <h2 class="mb-3 text-xs font-medium uppercase text-gray-500">Pipeline from this notebook</h2>
        <ul class="space-y-2">
          <li v-for="c in pipeline" :key="c.id">
            <NuxtLink
              :to="`/actions/pipeline/${c.id}`"
              class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-950/60 px-3 py-2 text-sm hover:bg-gray-950"
            >
              <span class="text-white">{{ c.title }}</span>
              <span class="text-xs text-gray-500">{{ c.kind }} · {{ c.status }}</span>
            </NuxtLink>
          </li>
        </ul>
      </div>

      <!-- Artifact timeline -->
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-xs font-medium uppercase tracking-wide text-gray-500">
          Pages ({{ artifacts.length }})
        </h2>
        <button type="button" class="btn-ghost !px-2 !py-1 text-xs" @click="showRaw = !showRaw">
          {{ showRaw ? 'Hide raw' : 'Show raw JSON' }}
        </button>
      </div>

      <div v-if="artifacts.length === 0" class="card p-8 text-center text-sm text-gray-500">
        No pages yet. Add a note or run study_brief / study_match_catalog via MCP.
      </div>

      <div class="space-y-3">
        <article
          v-for="a in artifacts"
          :key="a.id"
          class="card p-4"
        >
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <span :class="['rounded-full px-2 py-0.5 text-xs font-medium ring-1', artifactBadge(a.artifact_type)]">
                {{ a.artifact_type }}
              </span>
              <span class="text-sm font-medium text-white">{{ a.title || a.artifact_type }}</span>
            </div>
            <span class="text-xs text-gray-600">{{ relativeTime(a.created_at) }}</span>
          </div>
          <pre
            v-if="!showRaw"
            class="whitespace-pre-wrap break-words text-sm text-gray-300"
          >{{ artifactBody(a) }}</pre>
          <pre
            v-else
            class="max-h-64 overflow-auto rounded bg-gray-950 p-3 text-xs text-gray-400"
          >{{ JSON.stringify(a.payload, null, 2) }}</pre>
          <p v-if="a.payload?.url" class="mt-2 text-xs">
            <a
              :href="a.payload.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-sky-400 hover:underline break-all"
            >{{ a.payload.url }}</a>
          </p>
          <p v-if="a.grok_model" class="mt-1 text-[10px] text-gray-600">model: {{ a.grok_model }}</p>
        </article>
      </div>
    </template>
  </div>
</template>
