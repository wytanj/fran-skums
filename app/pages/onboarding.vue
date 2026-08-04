<script setup lang="ts">
const router = useRouter()
const user = useSupabaseUser()
const { currentWorkspace, workspaces, fetchWorkspaces, createWorkspace, selectWorkspace } = useWorkspace()
const { fetchMyPendingInvites, acceptInvite } = useTeam()

const name = ref('')
const loading = ref(false)
const checking = ref(true)
const error = ref('')

/**
 * A pending invite is the answer to "you have no workspace" far more often than
 * creating one is. Surfacing it here means an invitee who reaches this page by
 * any route joins the team instead of quietly ending up owning an empty
 * workspace — which also decides which workspace Claude connects them to.
 */
const pendingInvites = ref<any[]>([])
const acceptingToken = ref<string | null>(null)

function getUid(u: any): string | undefined {
  return u?.id || u?.sub
}

async function handleAccept(invite: any) {
  acceptingToken.value = invite.token
  error.value = ''
  try {
    await acceptInvite(invite.token)
    await fetchWorkspaces()
    router.push('/')
  } catch (e: any) {
    error.value = e.message || 'Could not accept the invite'
    acceptingToken.value = null
  }
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

  // Best effort — a failure here should still show the create form.
  try {
    pendingInvites.value = await fetchMyPendingInvites()
  } catch {
    pendingInvites.value = []
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
          <template v-if="pendingInvites.length > 0">You've been invited to a workspace</template>
          <template v-else-if="workspaces.length > 0">Select a workspace or create a new one</template>
          <template v-else>Create your first workspace to get started</template>
        </p>
        <p v-if="user?.email" class="mt-1 text-xs text-gray-500">
          Signed in as {{ user.email }}
        </p>
      </div>

      <!-- Pending invites: joining the team, not starting a new one -->
      <div v-if="pendingInvites.length > 0" class="mb-6 space-y-2">
        <p class="mb-2 text-sm font-medium text-gray-300">Invitations</p>
        <div
          v-for="inv in pendingInvites"
          :key="inv.id"
          class="card flex items-center gap-4 p-4"
        >
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-sm font-bold text-emerald-400">
            {{ (inv.workspace?.name || '?').charAt(0).toUpperCase() }}
          </div>
          <div class="min-w-0">
            <p class="truncate font-medium text-white">{{ inv.workspace?.name || 'Workspace' }}</p>
            <p class="text-xs text-gray-500">invited as {{ inv.role }}</p>
          </div>
          <button
            type="button"
            class="btn-primary ml-auto shrink-0 text-sm"
            :disabled="acceptingToken === inv.token"
            @click="handleAccept(inv)"
          >
            {{ acceptingToken === inv.token ? 'Joining…' : 'Accept' }}
          </button>
        </div>
        <p class="pt-1 text-xs text-gray-500">
          Accept the invitation to join your team. Only create a workspace below if you
          actually need a separate one.
        </p>
      </div>

      <div
        v-if="error && pendingInvites.length > 0"
        class="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400"
      >
        {{ error }}
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
