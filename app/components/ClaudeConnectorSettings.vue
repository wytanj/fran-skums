<script setup lang="ts">
/**
 * Settings → Claude connector.
 *
 * Replaces "edit two Vercel env vars and redeploy" with a button, because
 * rotating a leaked client secret is the operation most likely to be needed in a
 * hurry. Secret is shown once at creation, same contract as an API key.
 *
 * @see server/api/v1/mcp-oauth/client.post.ts
 * @see docs/MCP_OAUTH_DESIGN.md
 */
type Connection = {
  user_id: string
  full_name: string | null
  email: string | null
  created_at: string | null
  last_used_at: string | null
}

type ConnectorStatus = {
  configured: boolean
  source: 'database' | 'env' | null
  client_id: string | null
  secret_prefix: string | null
  has_secret: boolean
  label: string | null
  created_at: string | null
  rotated_at: string | null
  last_used_at: string | null
  connector_url: string
  connections: Connection[]
  connection_count: number
}

const props = defineProps<{ workspaceId: string | null }>()

const { notify } = useActionFeedback()

const status = ref<ConnectorStatus | null>(null)
const loading = ref(false)
const working = ref(false)
/** Present only immediately after create/rotate — never re-fetchable. */
const freshSecret = ref<string | null>(null)
const freshRotated = ref(false)

async function load() {
  if (!props.workspaceId) return
  loading.value = true
  try {
    status.value = await $fetch<ConnectorStatus>('/api/v1/mcp-oauth/client', {
      query: { workspace_id: props.workspaceId },
    })
  } catch (e) {
    notify.error(e, 'Could not load connector settings.')
  } finally {
    loading.value = false
  }
}

async function issue() {
  if (!props.workspaceId) return
  const rotating = Boolean(status.value?.configured && status.value.source === 'database')
  if (
    rotating
    && !confirm(
      'Rotate the client secret?\n\nYou must paste the new secret into Claude afterwards. Existing sessions keep working until their next refresh, then stop until Claude is updated.',
    )
  ) return

  working.value = true
  try {
    const res = await $fetch<{ client_secret: string; rotated: boolean; message: string }>(
      '/api/v1/mcp-oauth/client',
      { method: 'POST', body: { workspace_id: props.workspaceId } },
    )
    freshSecret.value = res.client_secret
    freshRotated.value = res.rotated
    notify.success(res.message)
    await load()
  } catch (e) {
    notify.error(e, 'Could not issue credentials.')
  } finally {
    working.value = false
  }
}

async function disable() {
  if (!props.workspaceId) return
  if (
    !confirm(
      'Disable the Claude connector?\n\nNobody will be able to connect, and all existing connections will be dropped.',
    )
  ) return

  working.value = true
  try {
    const res = await $fetch<{ message: string }>('/api/v1/mcp-oauth/client', {
      method: 'DELETE',
      body: { workspace_id: props.workspaceId, revoke_tokens: true },
    })
    freshSecret.value = null
    notify.success(res.message)
    await load()
  } catch (e) {
    notify.error(e, 'Could not disable the connector.')
  } finally {
    working.value = false
  }
}

async function disconnect(userId: string | null) {
  if (!props.workspaceId) return
  const label = userId ? 'this person' : 'everyone'
  if (!confirm(`Disconnect ${label} from Claude?\n\nThey can reconnect at any time.`)) return

  working.value = true
  try {
    const res = await $fetch<{ message: string }>('/api/v1/mcp-oauth/disconnect', {
      method: 'POST',
      body: { workspace_id: props.workspaceId, user_id: userId },
    })
    notify.success(res.message)
    await load()
  } catch (e) {
    notify.error(e, 'Could not disconnect.')
  } finally {
    working.value = false
  }
}

async function copy(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value)
    notify.success(`${what} copied.`)
  } catch {
    notify.error(new Error(`Could not copy — select and copy the ${what} manually.`))
  }
}

function when(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

watch(() => props.workspaceId, load, { immediate: true })
</script>

<template>
  <div class="space-y-6">
    <div class="card p-6">
      <h3 class="text-lg font-semibold text-ink">Claude connector</h3>
      <p class="mt-1 text-sm text-muted">
        One connector for the whole Claude organisation. Each teammate signs in with their
        own account, so Claude gets exactly their Fran permissions — no keys to hand out.
      </p>

      <div v-if="loading" class="mt-6 text-sm text-muted">Loading…</div>

      <template v-else-if="status">
        <!-- Shown once, right after create/rotate -->
        <div
          v-if="freshSecret"
          class="mt-6 rounded-lg border border-success/30 bg-success-soft p-4"
        >
          <p class="text-sm font-medium text-success">
            {{ freshRotated ? 'New secret — copy it now' : 'Credentials created — copy them now' }}
          </p>
          <p class="mt-1 text-xs text-success/80">
            The secret is not shown again. Paste it into Claude before leaving this page.
          </p>
          <div class="mt-3 space-y-2">
            <div class="flex items-center gap-2">
              <span class="w-28 shrink-0 text-xs text-muted">Client Secret</span>
              <code class="flex-1 truncate rounded bg-white border border-line px-2 py-1 font-mono text-xs text-ink">{{ freshSecret }}</code>
              <button type="button" class="btn-secondary shrink-0 text-xs" @click="copy(freshSecret!, 'Client Secret')">Copy</button>
            </div>
          </div>
        </div>

        <div
          v-if="status.source === 'env'"
          class="mt-6 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          Currently using the <code class="font-mono text-xs">MCP_OAUTH_CLIENT_ID</code> /
          <code class="font-mono text-xs">MCP_OAUTH_CLIENT_SECRET</code> environment
          variables. Generate credentials here to manage them without a redeploy — the new
          pair takes over immediately.
        </div>

        <!-- Paste-into-Claude block -->
        <dl class="mt-6 space-y-3 rounded-lg border border-line bg-surface-sunken p-4 text-sm">
          <div class="flex items-center gap-2">
            <dt class="w-28 shrink-0 text-muted">URL</dt>
            <dd class="flex flex-1 items-center gap-2 overflow-hidden">
              <code class="flex-1 truncate font-mono text-xs text-ink">{{ status.connector_url }}</code>
              <button type="button" class="btn-secondary shrink-0 text-xs" @click="copy(status.connector_url, 'URL')">Copy</button>
            </dd>
          </div>
          <div class="flex items-center gap-2">
            <dt class="w-28 shrink-0 text-muted">Client ID</dt>
            <dd class="flex flex-1 items-center gap-2 overflow-hidden">
              <code v-if="status.client_id" class="flex-1 truncate font-mono text-xs text-ink">{{ status.client_id }}</code>
              <span v-else class="flex-1 text-xs text-muted">not generated yet</span>
              <button
                v-if="status.client_id"
                type="button"
                class="btn-secondary shrink-0 text-xs"
                @click="copy(status.client_id!, 'Client ID')"
              >Copy</button>
            </dd>
          </div>
          <div class="flex items-center gap-2">
            <dt class="w-28 shrink-0 text-muted">Client Secret</dt>
            <dd class="flex-1 text-xs text-muted">
              <template v-if="status.has_secret">
                <code class="font-mono">{{ status.secret_prefix ? status.secret_prefix + '••••••••' : '••••••••' }}</code>
                <span class="ml-2">shown only at creation — rotate to get a new one</span>
              </template>
              <span v-else>none (public client)</span>
            </dd>
          </div>
        </dl>

        <p class="mt-3 text-xs text-muted">
          In Claude: Admin settings → Connectors → Add custom connector → paste the URL, then
          open Advanced settings for the Client ID and Secret. Leave Request headers empty.
          Do not put an API key in the URL — that disables per-person permissions.
        </p>

        <div v-if="status.configured" class="mt-4 grid gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-2">
          <p>Created <span class="text-muted">{{ when(status.created_at) }}</span></p>
          <p>Last rotated <span class="text-muted">{{ when(status.rotated_at) }}</span></p>
          <p>Last used by Claude <span class="text-muted">{{ when(status.last_used_at) }}</span></p>
        </div>

        <div class="mt-6 flex flex-wrap gap-3">
          <button type="button" class="btn-primary" :disabled="working" @click="issue">
            {{ status.configured && status.source === 'database' ? 'Rotate secret' : 'Generate credentials' }}
          </button>
          <button
            v-if="status.configured && status.source === 'database'"
            type="button"
            class="btn-danger"
            :disabled="working"
            @click="disable"
          >
            Disable connector
          </button>
        </div>
      </template>
    </div>

    <!-- Who is connected -->
    <div v-if="status?.configured" class="card p-6">
      <div class="flex items-baseline justify-between gap-4">
        <div>
          <h3 class="text-lg font-semibold text-ink">Connected teammates</h3>
          <p class="mt-1 text-sm text-muted">
            Each person connects themselves from Claude. Permissions come from their Fran
            role and are re-checked on every request.
          </p>
        </div>
        <button
          v-if="status.connection_count"
          type="button"
          class="btn-ghost shrink-0 text-xs"
          :disabled="working"
          @click="disconnect(null)"
        >
          Disconnect all
        </button>
      </div>

      <p v-if="!status.connection_count" class="mt-4 text-sm text-muted">
        Nobody has connected yet. Tell the team: Claude → Settings → Connectors → Fran → Connect.
      </p>

      <ul v-else class="mt-4 divide-y divide-white/5">
        <li
          v-for="c in status.connections"
          :key="c.user_id"
          class="flex items-center justify-between gap-4 py-3"
        >
          <div class="min-w-0">
            <p class="truncate text-sm text-ink">{{ c.email || c.full_name || c.user_id }}</p>
            <p class="text-xs text-muted">
              connected {{ when(c.created_at) }} · last used {{ when(c.last_used_at) }}
            </p>
          </div>
          <button
            type="button"
            class="btn-ghost shrink-0 text-xs"
            :disabled="working"
            @click="disconnect(c.user_id)"
          >
            Disconnect
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
