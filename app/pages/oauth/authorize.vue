<script setup lang="ts">
/**
 * Consent screen for the Claude MCP connector.
 *
 * Its job is not legal consent — Claude already shows its own Connect card.
 * It exists so the employee sees *which account* they are about to bind and how
 * much power that account carries. Without it, someone signed into a personal
 * Google account authorises silently and then reports "Claude can't see my
 * stock", with nothing on screen to explain why.
 *
 * @see server/api/oauth/approve.post.ts
 */
definePageMeta({ layout: 'auth' })

type PendingInvite = {
  token: string
  role: string
  workspace_name: string | null
}

type AuthorizeInfo = {
  signed_in: boolean
  email?: string | null
  workspace_id?: string | null
  workspace_name?: string | null
  workspace_ambiguous?: boolean
  role?: string | null
  scopes?: string[]
  tool_count?: number
  tool_names?: string[]
  can_authorize?: boolean
  pending_invites?: PendingInvite[]
  reason?: string | null
  scope?: string
}

const route = useRoute()
const client = useSupabaseClient()

const info = ref<AuthorizeInfo | null>(null)
const loading = ref(true)
const approving = ref(false)
const accepting = ref<string | null>(null)
const error = ref('')
const showTools = ref(false)

/** Where to come back to after signing in — the full request, query intact. */
function returnPath(): string {
  return route.fullPath
}

function loginUrl(): string {
  return `/auth/login?redirect=${encodeURIComponent(returnPath())}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch<AuthorizeInfo>('/api/oauth/authorize-info', {
      query: route.query,
    })
    if (!data.signed_in) {
      await navigateTo(loginUrl())
      return
    }
    info.value = data
  } catch (e: any) {
    error.value =
      e?.data?.statusMessage || e?.statusMessage || e?.message || 'Could not read the request.'
  } finally {
    loading.value = false
  }
}

async function approve() {
  approving.value = true
  error.value = ''
  try {
    const res = await $fetch<{ redirect_url: string }>('/api/oauth/approve', {
      method: 'POST',
      body: { ...route.query },
    })
    // Full page navigation: the target is claude.ai, not an app route.
    window.location.href = res.redirect_url
  } catch (e: any) {
    error.value =
      e?.data?.statusMessage || e?.statusMessage || e?.message || 'Could not authorize.'
    approving.value = false
  }
}

/**
 * Accept a pending invitation without leaving the flow.
 *
 * Uses the accept_invite RPC through the *user's* client, not a server route:
 * the function keys off auth.uid() and verifies the signed-in address matches
 * the invited one, so the identity check stays where it belongs. Reloads rather
 * than authorising straight away — the tool count is the thing worth seeing
 * before granting, and it only exists after membership does.
 */
async function acceptAndReload(invite: PendingInvite) {
  accepting.value = invite.token
  error.value = ''
  try {
    const { error: rpcError } = await (client as any).rpc('accept_invite', {
      p_token: invite.token,
    })
    if (rpcError) throw rpcError
    await load()
  } catch (e: any) {
    error.value =
      e?.message || e?.data?.statusMessage || 'Could not accept the invitation.'
  } finally {
    accepting.value = null
  }
}

async function switchAccount() {
  try {
    await client.auth.signOut()
  } catch {
    /* signing out is best effort — the login page can still take over */
  }
  await navigateTo(loginUrl())
}

onMounted(load)
</script>

<template>
  <div class="card p-8">
    <h2 class="text-xl font-semibold text-ink">Connect Claude to Fran</h2>
    <p class="mt-1 text-sm text-muted">
      Claude will act with your Fran permissions — nothing more.
    </p>

    <div v-if="loading" class="mt-6 text-sm text-muted">Checking your account…</div>

    <div
      v-else-if="error"
      class="mt-6 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger"
    >
      {{ error }}
    </div>

    <template v-else-if="info">
      <dl class="mt-6 space-y-3 rounded-lg border border-white/10 bg-surface-sunken p-4 text-sm">
        <div class="flex items-baseline justify-between gap-4">
          <dt class="text-muted">Signed in as</dt>
          <dd class="text-right font-medium text-ink">{{ info.email || 'unknown' }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-4">
          <dt class="text-muted">Workspace</dt>
          <dd class="text-right text-ink">{{ info.workspace_name || '—' }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-4">
          <dt class="text-muted">Your role</dt>
          <dd class="text-right text-ink">{{ info.role || '—' }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-4">
          <dt class="text-muted">Tools Claude will get</dt>
          <dd class="text-right text-ink">
            {{ info.tool_count }}
            <button
              v-if="info.tool_names?.length"
              type="button"
              class="ml-2 text-xs text-success hover:underline"
              @click="showTools = !showTools"
            >
              {{ showTools ? 'hide' : 'show' }}
            </button>
          </dd>
        </div>
      </dl>

      <p
        v-if="showTools"
        class="mt-3 max-h-40 overflow-y-auto rounded-lg bg-black/30 p-3 font-mono text-xs text-muted"
      >
        {{ info.tool_names?.join(', ') }}
      </p>

      <p
        v-if="info.workspace_ambiguous"
        class="mt-4 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning"
      >
        You belong to more than one workspace. Connecting to
        <strong>{{ info.workspace_name }}</strong>.
      </p>

      <p
        v-if="!info.can_authorize"
        class="mt-4 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning"
      >
        {{ info.reason }}
      </p>

      <!-- Pending invitation: finish joining without leaving the flow -->
      <div v-if="!info.can_authorize && info.pending_invites?.length" class="mt-4 space-y-2">
        <div
          v-for="inv in info.pending_invites"
          :key="inv.token"
          class="flex items-center gap-3 rounded-lg border border-success/30 bg-success-soft p-3"
        >
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-ink">
              {{ inv.workspace_name || 'Workspace' }}
            </p>
            <p class="text-xs text-success/80">invited as {{ inv.role }}</p>
          </div>
          <button
            type="button"
            class="btn-primary ml-auto shrink-0 text-sm"
            :disabled="accepting === inv.token"
            @click="acceptAndReload(inv)"
          >
            {{ accepting === inv.token ? 'Joining…' : 'Accept invitation' }}
          </button>
        </div>
      </div>

      <div class="mt-6 flex flex-col gap-3">
        <button
          type="button"
          class="btn-primary w-full justify-center"
          :disabled="approving || !info.can_authorize"
          @click="approve"
        >
          {{ approving ? 'Authorizing…' : 'Authorize Claude' }}
        </button>
        <button type="button" class="btn-ghost w-full justify-center" @click="switchAccount">
          Use a different account
        </button>
      </div>

      <p class="mt-6 text-xs text-muted">
        Your permissions are re-checked on every request, so a role change in Fran
        takes effect immediately. Revoke access any time from Settings.
      </p>
    </template>
  </div>
</template>
