<script setup lang="ts">
const router = useRouter()
const user = useSupabaseUser()
const { currentWorkspace, workspaces, fetchWorkspaces, createWorkspace, selectWorkspace } = useWorkspace()

const name = ref('')
const loading = ref(false)
const checking = ref(true)
const error = ref('')

function getUid(u: any): string | undefined {
  return u?.id || u?.sub
}

onMounted(async () => {
  // Wait for user to fully hydrate before fetching workspaces
  if (!getUid(user.value)) {
    await new Promise<void>((resolve) => {
      const unwatch = watch(user, (val) => {
        if (getUid(val)) { unwatch(); resolve() }
      }, { immediate: true })
      setTimeout(() => { unwatch(); resolve() }, 3000)
    })
  }

  if (!getUid(user.value)) {
    checking.value = false
    return
  }

  await fetchWorkspaces()
  if (currentWorkspace.value) {
    router.push('/')
    return
  }
  checking.value = false
})

async function handleCreate() {
  if (!name.value.trim()) return
  loading.value = true
  error.value = ''

  try {
    await createWorkspace(name.value.trim())
    router.push('/')
  } catch (e: any) {
    error.value = e.message || 'Failed to create workspace'
  } finally {
    loading.value = false
  }
}

function handleSelect(ws: any) {
  selectWorkspace(ws)
  router.push('/')
}
</script>

<template>
  <div class="flex min-h-[80vh] items-center justify-center">
    <div v-if="checking" class="text-center">
      <svg class="mx-auto h-8 w-8 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <p class="mt-3 text-sm text-gray-400">Loading workspaces...</p>
    </div>

    <div v-else class="w-full max-w-md">
      <div class="mb-8 text-center">
        <h1 class="text-2xl font-bold text-white">Welcome to SKUMS</h1>
        <p class="mt-2 text-sm text-gray-400">
          {{ workspaces.length > 0 ? 'Select a workspace or create a new one' : 'Create your first workspace to get started' }}
        </p>
      </div>

      <!-- Existing workspaces -->
      <div v-if="workspaces.length > 0" class="mb-6 space-y-2">
        <p class="text-sm font-medium text-gray-300 mb-2">Your workspaces</p>
        <button
          v-for="ws in workspaces"
          :key="ws.id"
          class="card flex w-full items-center gap-4 p-4 text-left transition-all hover:border-indigo-500/30 hover:bg-indigo-600/5"
          @click="handleSelect(ws)"
        >
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600/10 text-sm font-bold text-indigo-400">
            {{ ws.name.charAt(0).toUpperCase() }}
          </div>
          <div>
            <p class="font-medium text-white">{{ ws.name }}</p>
            <p class="text-xs text-gray-500">{{ ws.slug }}</p>
          </div>
          <svg class="ml-auto h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      <!-- Create new workspace -->
      <div class="card p-6">
        <h3 class="mb-4 text-base font-semibold text-white">
          {{ workspaces.length > 0 ? 'Or create a new workspace' : 'Create a workspace' }}
        </h3>

        <div v-if="error" class="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {{ error }}
        </div>

        <form @submit.prevent="handleCreate">
          <div class="mb-4">
            <label class="label-field">Workspace name</label>
            <input
              v-model="name"
              type="text"
              required
              placeholder="e.g. My Store, Acme Corp"
              class="input-field"
            />
            <p class="mt-1.5 text-xs text-gray-500">This is your team or company name.</p>
          </div>

          <button type="submit" class="btn-primary w-full" :disabled="loading || !name.trim()">
            {{ loading ? 'Creating...' : 'Create workspace' }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
