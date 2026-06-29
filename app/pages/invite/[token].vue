<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
const router = useRouter()
const user = useSupabaseUser()
const { acceptInvite } = useTeam()
const { fetchWorkspaces, selectWorkspace } = useWorkspace()

const token = route.params.token as string
const status = ref<'loading' | 'success' | 'error' | 'login_required'>('loading')
const errorMsg = ref('')
const workspaceId = ref('')

function getUid(u: any): string | undefined {
  return u?.id || u?.sub
}

async function tryAccept() {
  status.value = 'loading'
  try {
    const result = await acceptInvite(token)
    workspaceId.value = result.workspace_id
    status.value = 'success'

    await fetchWorkspaces()
    setTimeout(() => router.push('/'), 2000)
  } catch (e: any) {
    errorMsg.value = e.message || 'Failed to accept invite'
    status.value = 'error'
  }
}

onMounted(async () => {
  if (!getUid(user.value)) {
    await new Promise<void>((resolve) => {
      const unwatch = watch(user, (val) => {
        if (getUid(val)) { unwatch(); resolve() }
      }, { immediate: true })
      setTimeout(() => { unwatch(); resolve() }, 3000)
    })
  }

  if (!getUid(user.value)) {
    status.value = 'login_required'
    return
  }

  await tryAccept()
})
</script>

<template>
  <div class="card p-8 text-center">
    <!-- Loading -->
    <template v-if="status === 'loading'">
      <svg class="mx-auto h-10 w-10 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <h2 class="mt-4 text-lg font-semibold text-white">Accepting invite...</h2>
      <p class="mt-1 text-sm text-gray-400">Please wait.</p>
    </template>

    <!-- Success -->
    <template v-else-if="status === 'success'">
      <svg class="mx-auto h-12 w-12 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
      <h2 class="mt-4 text-lg font-semibold text-white">You're in!</h2>
      <p class="mt-1 text-sm text-gray-400">Invite accepted. Redirecting to workspace...</p>
    </template>

    <!-- Login required -->
    <template v-else-if="status === 'login_required'">
      <svg class="mx-auto h-12 w-12 text-amber-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
      </svg>
      <h2 class="mt-4 text-lg font-semibold text-white">Sign in to accept</h2>
      <p class="mt-2 text-sm text-gray-400">
        You need to sign in or create an account with the email this invite was sent to.
      </p>
      <NuxtLink
        :to="`/auth/login?redirect=/invite/${token}`"
        class="btn-primary mt-4 inline-flex"
      >
        Sign in
      </NuxtLink>
    </template>

    <!-- Error -->
    <template v-else>
      <svg class="mx-auto h-12 w-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
      </svg>
      <h2 class="mt-4 text-lg font-semibold text-white">Unable to accept invite</h2>
      <p class="mt-2 text-sm text-red-400">{{ errorMsg }}</p>
      <NuxtLink to="/" class="btn-secondary mt-4 inline-flex">Go to dashboard</NuxtLink>
    </template>
  </div>
</template>
