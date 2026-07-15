<script setup lang="ts">
const client = useSupabaseClient()
const user = useSupabaseUser()
const { currentWorkspace, workspaces } = useWorkspace()
const {
  members, invites, permissionSchemas, myPermissions,
  loading: teamLoading,
  loadAll: loadTeam,
  sendInvite, revokeInvite, updateMemberRole, removeMember,
  can,
} = useTeam()

const activeTab = ref<'profile' | 'workspace' | 'team' | 'organization' | 'api-keys' | 'custom-fields' | 'assistant'>('profile')

// Organization
const {
  currentOrganization,
  organizations,
  orgMembers,
  orgInvites,
  orgWorkspaces,
  isOrgAdmin,
  isOrgOwner,
  fetchOrganizations,
  createOrganization,
  updateOrganization,
  fetchOrgMembers,
  updateOrgMemberRole,
  removeOrgMember,
  fetchOrgInvites,
  sendOrgInvite,
  revokeOrgInvite,
  fetchOrgWorkspaces,
  moveWorkspaceToOrg,
  loadAll: loadOrg,
} = useOrganization()

const orgForm = reactive({ name: '' })
const orgSaving = ref(false)
const showCreateOrgForm = ref(false)
const newOrgName = ref('')
const creatingOrg = ref(false)
const showOrgInviteForm = ref(false)
const orgInviteEmail = ref('')
const orgInviteRole = ref<'admin' | 'member' | 'billing'>('member')
const orgInviteSending = ref(false)
const orgLoaded = ref(false)
const showMoveWorkspaceForm = ref(false)

async function loadOrgData() {
  if (orgLoaded.value) return
  await fetchOrganizations()
  if (currentOrganization.value) {
    orgForm.name = currentOrganization.value.name
    await loadOrg()
  }
  orgLoaded.value = true
}

async function handleCreateOrg() {
  if (!newOrgName.value.trim()) return
  creatingOrg.value = true
  try {
    await createOrganization(newOrgName.value)
    showSuccess('Organization created!')
    newOrgName.value = ''
    showCreateOrgForm.value = false
    orgForm.name = currentOrganization.value?.name || ''
    await loadOrg()
  } catch (e: any) {
    showError(e.message || 'Failed to create organization')
  } finally {
    creatingOrg.value = false
  }
}

async function handleSaveOrg() {
  if (!currentOrganization.value || !orgForm.name.trim()) return
  orgSaving.value = true
  try {
    await updateOrganization({ name: orgForm.name })
    showSuccess('Organization saved!')
  } catch (e: any) {
    showError(e.message || 'Failed to save organization')
  } finally {
    orgSaving.value = false
  }
}

async function handleSendOrgInvite() {
  if (!orgInviteEmail.value.trim()) return
  orgInviteSending.value = true
  try {
    await sendOrgInvite(orgInviteEmail.value, orgInviteRole.value)
    showSuccess(`Invite sent to ${orgInviteEmail.value}`)
    orgInviteEmail.value = ''
    orgInviteRole.value = 'member'
    showOrgInviteForm.value = false
  } catch (e: any) {
    showError(e.message || 'Failed to send invite')
  } finally {
    orgInviteSending.value = false
  }
}

async function handleRevokeOrgInvite(id: string) {
  if (!confirm('Revoke this invite?')) return
  try {
    await revokeOrgInvite(id)
    showSuccess('Invite revoked')
  } catch (e: any) {
    showError(e.message)
  }
}

async function handleOrgRoleChange(userId: string, newRole: string) {
  try {
    await updateOrgMemberRole(userId, newRole as any)
    showSuccess('Role updated')
  } catch (e: any) {
    showError(e.message)
  }
}

async function handleRemoveOrgMember(userId: string, name: string) {
  if (!confirm(`Remove ${name || 'this member'} from the organization?`)) return
  try {
    await removeOrgMember(userId)
    showSuccess('Member removed')
  } catch (e: any) {
    showError(e.message)
  }
}

async function handleMoveWorkspace(wsId: string) {
  try {
    await moveWorkspaceToOrg(wsId)
    showSuccess('Workspace moved to organization')
    showMoveWorkspaceForm.value = false
  } catch (e: any) {
    showError(e.message || 'Failed to move workspace')
  }
}

// Workspaces not in current org (for move dropdown)
const unlinkedWorkspaces = computed(() => {
  if (!currentOrganization.value) return workspaces.value
  return workspaces.value.filter((ws: any) => ws.organization_id !== currentOrganization.value!.id)
})

const profile = reactive({ full_name: '', company: '' })
const workspace = reactive({ name: '' })
const profileSaving = ref(false)
const workspaceSaving = ref(false)
const message = ref('')
const errorMsg = ref('')

// Custom fields
const customFields = ref<any[]>([])
const showFieldForm = ref(false)
const fieldForm = reactive({
  field_name: '',
  field_key: '',
  field_type: 'text',
  description: '',
  is_required: false,
})
const fieldSaving = ref(false)

// API keys
const apiKeys = ref<any[]>([])
const showKeyForm = ref(false)
const newKeyName = ref('')
const newKeyScopes = ref<string[]>([])
const keySaving = ref(false)
const posKeySaving = ref(false)
const newlyCreatedKey = ref('')
const newlyCreatedKeyUse = ref<'general' | 'pos' | 'mcp'>('general')
const POS_SCOPES = ['pos:read', 'pos:write']
/**
 * Claude / MCP connector key template.
 * mcp:ops_safe includes approve/execute scopes; A2 still caps by bound user's web role
 * (viewer-bound keys lose approve; owner/admin keep them).
 */
const MCP_CONNECTOR_SCOPES = ['mcp:ops_safe']
const mcpKeySaving = ref(false)
const skumsApiUrl = computed(() => {
  if (import.meta.client) return window.location.origin
  return 'https://fran-skums.vercel.app'
})
const mcpEndpointUrl = computed(() => `${skumsApiUrl.value}/mcp`)
const posConnectorSnippet = computed(() => [
  `SKUMS API URL: ${skumsApiUrl.value}`,
  `SKUMS account key: ${newlyCreatedKey.value || 'sk_live_...'}`,
].join('\n'))
const mcpConnectorSnippet = computed(() => [
  `Fran SKUMS remote MCP (Claude / custom integration)`,
  `URL: ${mcpEndpointUrl.value}`,
  `Auth header: Authorization: Bearer ${newlyCreatedKey.value || 'sk_live_...'}`,
  `Profile: permission-based (A2) — owner/admin may approve store ops when scoped`,
  `Help: ${skumsApiUrl.value}/help/connect-claude`,
].join('\n'))

async function loadApiKeys() {
  if (!currentWorkspace.value) return
  const supaClient = useSupabaseClient()
  const { data } = await supaClient
    .from('api_keys')
    .select('id, name, description, key_prefix, scopes, rate_limit_rpm, is_active, last_used_at, total_requests, created_at, expires_at, bound_user_id, key_kind, max_package, revoked_at, created_by')
    .eq('workspace_id', currentWorkspace.value.id)
    .order('created_at', { ascending: false })
  apiKeys.value = data || []
}

async function handleCreateKey() {
  if (!newKeyName.value.trim() || !currentWorkspace.value) return
  keySaving.value = true
  try {
    const result = await $fetch('/api/v1/keys/create', {
      method: 'POST',
      body: {
        workspace_id: currentWorkspace.value.id,
        name: newKeyName.value,
        scopes: newKeyScopes.value.length > 0 ? newKeyScopes.value : [],
        created_by: getUserId(),
      },
    })
    newlyCreatedKey.value = (result as any).key
    newlyCreatedKeyUse.value = 'general'
    newKeyName.value = ''
    newKeyScopes.value = []
    showKeyForm.value = false
    await loadApiKeys()
  } catch (e: any) {
    showError(e.data?.statusMessage || e.message || 'Failed to create API key')
  } finally {
    keySaving.value = false
  }
}

async function handleCreatePosKey() {
  if (!currentWorkspace.value) return
  posKeySaving.value = true
  try {
    const result = await $fetch('/api/v1/keys/create', {
      method: 'POST',
      body: {
        workspace_id: currentWorkspace.value.id,
        name: `POS connector - ${currentWorkspace.value.name}`,
        scopes: POS_SCOPES,
      },
    })
    newlyCreatedKey.value = (result as any).key
    newlyCreatedKeyUse.value = 'pos'
    await loadApiKeys()
  } catch (e: any) {
    showError(e.data?.statusMessage || e.message || 'Failed to create POS connector key')
  } finally {
    posKeySaving.value = false
  }
}

async function handleCreateMcpKey() {
  if (!currentWorkspace.value) return
  mcpKeySaving.value = true
  try {
    const result = await $fetch('/api/v1/keys/create', {
      method: 'POST',
      body: {
        workspace_id: currentWorkspace.value.id,
        name: `Claude / MCP connector - ${currentWorkspace.value.name}`,
        description:
          'Remote MCP; power = key package ∩ your web role (A2). Owner/admin may approve store ops; approve ≠ send Loft.',
        scopes: MCP_CONNECTOR_SCOPES,
        created_by: getUserId(),
        bound_user_id: getUserId(),
        key_kind: 'mcp_connector',
        max_package: 'mcp:ops_safe',
      },
    })
    newlyCreatedKey.value = (result as any).key
    newlyCreatedKeyUse.value = 'mcp'
    await loadApiKeys()
  } catch (e: any) {
    showError(e.data?.statusMessage || e.message || 'Failed to create MCP connector key')
  } finally {
    mcpKeySaving.value = false
  }
}

async function handleDeleteKey(id: string) {
  if (!confirm('Revoke this API key? Any systems using it will lose access immediately.')) return
  try {
    await $fetch(`/api/v1/keys/${id}/revoke`, {
      method: 'POST',
      body: { workspace_id: currentWorkspace.value?.id },
    })
    showSuccess('API key revoked')
  } catch (e: any) {
    // Fallback: hard delete if revoke route/migration missing
    const supaClient = useSupabaseClient()
    const { error } = await supaClient.from('api_keys').delete().eq('id', id)
    if (error) showError(e.data?.statusMessage || error.message)
    else showSuccess('API key deleted')
  }
  await loadApiKeys()
}

async function handleToggleKey(id: string, active: boolean) {
  const supaClient = useSupabaseClient()
  const patch: Record<string, unknown> = { is_active: !active }
  if (active) {
    // disabling → soft revoke markers when columns exist
    patch.revoked_at = new Date().toISOString()
  } else {
    patch.revoked_at = null
  }
  const { error } = await supaClient.from('api_keys').update(patch).eq('id', id)
  if (error && /revoked_at|column/i.test(error.message)) {
    const retry = await supaClient.from('api_keys').update({ is_active: !active }).eq('id', id)
    if (retry.error) showError(retry.error.message)
  } else if (error) {
    showError(error.message)
  }
  await loadApiKeys()
}

const AVAILABLE_SCOPES = [
  { key: 'mcp:ops_safe', label: 'MCP ops (owner/admin — approve when scoped)' },
  { key: 'mcp:safe', label: 'MCP draft/read baseline' },
  { key: 'store_ops:approve', label: 'Store ops approve' },
  { key: 'intel:read', label: 'MCP intel:read' },
  { key: 'products:read', label: 'Read Products' },
  { key: 'products:write', label: 'Write Products' },
  { key: 'products:delete', label: 'Delete Products' },
  { key: 'brands:read', label: 'Read Brands' },
  { key: 'categories:read', label: 'Read Categories' },
  { key: 'schemas:read', label: 'Read Schemas' },
  { key: 'pos:read', label: 'Read POS Catalog' },
  { key: 'pos:write', label: 'Write POS Sales' },
  { key: 'api:read', label: 'Read API Keys' },
  { key: 'api:write', label: 'Manage API Keys' },
]

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  showSuccess('Copied to clipboard')
}

// Team invite form
const showInviteForm = ref(false)
const inviteEmail = ref('')
const inviteRole = ref<'admin' | 'member' | 'viewer'>('member')
const inviteSending = ref(false)

function showSuccess(msg: string) {
  errorMsg.value = ''
  message.value = msg
  setTimeout(() => message.value = '', 3000)
}

function showError(msg: string) {
  message.value = ''
  errorMsg.value = msg
}

function getUserId(): string | undefined {
  return user.value?.id || (user.value as any)?.sub
}

async function waitForUser(): Promise<boolean> {
  if (getUserId()) return true
  await new Promise<void>((resolve) => {
    const unwatch = watch(user, (val) => {
      if (val?.id || (val as any)?.sub) { unwatch(); resolve() }
    }, { immediate: true })
    setTimeout(() => { unwatch(); resolve() }, 3000)
  })
  const uid = getUserId()
  if (!uid) {
    console.error('[SKUMS] User still not hydrated after 3s. user.value:', JSON.stringify(user.value))
  }
  return !!uid
}

async function loadProfile() {
  if (!(await waitForUser())) return
  const uid = getUserId()!
  const { data, error } = await client.from('profiles').select('*').eq('id', uid).single()
  if (error) {
    console.error('[SKUMS] loadProfile:', error.message)
    return
  }
  if (data) {
    profile.full_name = data.full_name || ''
    profile.company = data.company || ''
  }
}

async function saveProfile() {
  if (!(await waitForUser())) {
    showError('User session not ready — please refresh.')
    return
  }
  const uid = getUserId()!
  profileSaving.value = true
  const { error } = await client.from('profiles').update({
    full_name: profile.full_name,
    company: profile.company,
  }).eq('id', uid)
  profileSaving.value = false

  if (error) {
    showError(`Failed to save profile: ${error.message}`)
    console.error('[SKUMS] saveProfile:', error)
  } else {
    showSuccess('Profile saved!')
  }
}

async function loadWorkspace() {
  if (currentWorkspace.value) {
    workspace.name = currentWorkspace.value.name
  }
}

async function saveWorkspace() {
  if (!currentWorkspace.value) {
    showError('No workspace selected.')
    return
  }
  workspaceSaving.value = true
  const { error } = await client.from('workspaces').update({
    name: workspace.name,
  }).eq('id', currentWorkspace.value.id)
  workspaceSaving.value = false

  if (error) {
    showError(`Failed to save workspace: ${error.message}`)
    console.error('[SKUMS] saveWorkspace:', error)
  } else {
    showSuccess('Workspace saved!')
  }
}

async function loadCustomFields() {
  if (!currentWorkspace.value) return
  const { data, error } = await client
    .from('custom_field_definitions')
    .select('*')
    .eq('workspace_id', currentWorkspace.value.id)
    .order('sort_order')
  if (error) console.error('[SKUMS] loadCustomFields:', error.message)
  customFields.value = data || []
}

function autoGenerateKey() {
  fieldForm.field_key = fieldForm.field_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '')
}

async function saveField() {
  if (!currentWorkspace.value || !fieldForm.field_name.trim()) return
  fieldSaving.value = true

  const { error } = await client.from('custom_field_definitions').insert({
    workspace_id: currentWorkspace.value.id,
    field_name: fieldForm.field_name,
    field_key: fieldForm.field_key,
    field_type: fieldForm.field_type,
    description: fieldForm.description || null,
    is_required: fieldForm.is_required,
  })

  if (error) {
    showError(`Failed to create field: ${error.message}`)
    fieldSaving.value = false
    return
  }

  showFieldForm.value = false
  fieldForm.field_name = ''
  fieldForm.field_key = ''
  fieldForm.field_type = 'text'
  fieldForm.description = ''
  fieldForm.is_required = false
  fieldSaving.value = false
  await loadCustomFields()
}

async function deleteField(id: string) {
  if (!confirm('Delete this custom field? All associated values will be removed.')) return
  const { error } = await client.from('custom_field_definitions').delete().eq('id', id)
  if (error) showError(`Failed to delete: ${error.message}`)
  await loadCustomFields()
}

// ── Team actions ──

async function handleSendInvite() {
  if (!inviteEmail.value.trim()) return
  if (inviteRole.value === 'admin' && !isOwner.value) {
    showError('Only the workspace owner can invite Admins')
    return
  }
  inviteSending.value = true
  try {
    await sendInvite(inviteEmail.value, inviteRole.value)
    showSuccess(`Invite sent to ${inviteEmail.value}`)
    inviteEmail.value = ''
    inviteRole.value = 'member'
    showInviteForm.value = false
  } catch (e: any) {
    showError(e.message || 'Failed to send invite')
  } finally {
    inviteSending.value = false
  }
}

async function handleRevokeInvite(id: string) {
  if (!confirm('Revoke this invite?')) return
  try {
    await revokeInvite(id)
    showSuccess('Invite revoked')
  } catch (e: any) {
    showError(e.message)
  }
}

async function handleRoleChange(userId: string, newRole: string) {
  const target = members.value.find((m) => m.user_id === userId)
  // Owner seat: only workspace owner may appoint or demote admins
  if ((newRole === 'admin' || target?.role === 'admin') && !isOwner.value) {
    showError('Only the workspace owner can appoint or change admins. Admins manage members/viewers and permissions within their role.')
    await fetchMembers()
    return
  }
  try {
    const result = await updateMemberRole(userId, newRole as any)
    showSuccess((result as any)?.message || 'Role updated')
  } catch (e: any) {
    showError(e.data?.statusMessage || e.message)
  }
}

async function handleRemoveMember(userId: string, name: string) {
  if (
    !confirm(
      `Remove ${name || 'this member'} from the workspace?\n\nTheir bound API / MCP keys will be revoked immediately.`,
    )
  ) {
    return
  }
  try {
    const result = await removeMember(userId)
    showSuccess((result as any)?.message || 'Member removed')
  } catch (e: any) {
    showError(e.data?.statusMessage || e.message)
  }
}

function getRoleColor(role: string) {
  const map: Record<string, string> = {
    owner: 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
    admin: 'bg-indigo-500/10 text-indigo-400 ring-indigo-500/20',
    member: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
    viewer: 'bg-gray-500/10 text-gray-400 ring-gray-500/20',
    billing: 'bg-purple-500/10 text-purple-400 ring-purple-500/20',
  }
  return map[role] || map.viewer
}

/** Workspace owner seat (typically CEO / founder / technical principal — Jeremy). Can appoint admins. */
const isOwner = computed(() => {
  const uid = getUserId()
  if (!uid) return false
  if (currentWorkspace.value?.owner_id === uid) return true
  return members.value.some((m) => m.user_id === uid && m.role === 'owner')
})

/** Multiple admins OK for day-to-day permissions; they cannot appoint other admins. */
const isWorkspaceAdminRole = computed(() => {
  const uid = getUserId()
  if (!uid) return false
  if (isOwner.value) return true
  return members.value.some((m) => m.user_id === uid && (m.role === 'admin' || m.role === 'owner'))
})

const tabs = [
  { key: 'profile', label: 'Profile' },
  { key: 'organization', label: 'Organization' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'team', label: 'Team' },
  { key: 'api-keys', label: 'API Keys' },
  { key: 'custom-fields', label: 'Custom Fields' },
  { key: 'assistant', label: 'AI Assistant' },
]

// AI Assistant config
const assistantProfile = reactive({
  user_role: 'retailer' as 'manufacturer' | 'retailer' | 'marketer' | 'distributor' | 'custom',
  preferred_model: 'grok-3-mini' as 'grok-3' | 'grok-3-mini',
  slack_webhook_url: '',
  system_prompt_additions: '',
})
const assistantSaving = ref(false)
const assistantLoaded = ref(false)

async function loadAssistantProfile() {
  if (!currentWorkspace.value) return
  const { data } = await client
    .from('assistant_context_profiles')
    .select('*')
    .eq('workspace_id', currentWorkspace.value.id)
    .single()
  if (data) {
    assistantProfile.user_role = data.user_role
    assistantProfile.preferred_model = data.preferred_model
    assistantProfile.slack_webhook_url = data.slack_webhook_url || ''
    assistantProfile.system_prompt_additions = data.system_prompt_additions || ''
  }
  assistantLoaded.value = true
}

async function saveAssistantProfile() {
  if (!currentWorkspace.value) return
  assistantSaving.value = true
  errorMsg.value = ''
  const payload = {
    workspace_id: currentWorkspace.value.id,
    user_role: assistantProfile.user_role,
    preferred_model: assistantProfile.preferred_model,
    slack_webhook_url: assistantProfile.slack_webhook_url || null,
    system_prompt_additions: assistantProfile.system_prompt_additions || null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await client
    .from('assistant_context_profiles')
    .upsert(payload, { onConflict: 'workspace_id' })
  assistantSaving.value = false
  if (error) { errorMsg.value = error.message } else { message.value = 'AI Assistant settings saved.' }
}

watch(activeTab, (tab) => {
  if (tab === 'assistant' && !assistantLoaded.value) loadAssistantProfile()
  if (tab === 'organization' && !orgLoaded.value) loadOrgData()
})

onMounted(async () => {
  await Promise.all([loadProfile(), loadWorkspace(), loadCustomFields(), loadTeam(), loadApiKeys()])
})
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-white">Settings</h1>
    </div>

    <!-- Error message -->
    <div v-if="errorMsg" class="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
      {{ errorMsg }}
    </div>

    <!-- Success message -->
    <Transition
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-150"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="message" class="mb-4 rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
        {{ message }}
      </div>
    </Transition>

    <!-- Tabs -->
    <div class="mb-6 flex gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="[
          'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all',
          activeTab === tab.key ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white',
        ]"
        @click="activeTab = tab.key as any"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Profile -->
    <div v-show="activeTab === 'profile'" class="card p-6 space-y-4">
      <h2 class="text-lg font-semibold text-white">Profile</h2>
      <div>
        <label class="label-field">Email</label>
        <input :value="user?.email" type="email" disabled class="input-field opacity-60" />
      </div>
      <div>
        <label class="label-field">Full Name</label>
        <input v-model="profile.full_name" type="text" class="input-field" placeholder="Your name" />
      </div>
      <div>
        <label class="label-field">Company</label>
        <input v-model="profile.company" type="text" class="input-field" placeholder="Company name" />
      </div>
      <button class="btn-primary" :disabled="profileSaving" @click="saveProfile">
        {{ profileSaving ? 'Saving...' : 'Save profile' }}
      </button>
    </div>

    <!-- Workspace -->
    <div v-show="activeTab === 'workspace'" class="card p-6 space-y-4">
      <h2 class="text-lg font-semibold text-white">Workspace Settings</h2>
      <div>
        <label class="label-field">Workspace Name</label>
        <input v-model="workspace.name" type="text" class="input-field" />
      </div>
      <div>
        <label class="label-field">Workspace ID</label>
        <input :value="currentWorkspace?.id" type="text" disabled class="input-field font-mono text-xs opacity-60" />
      </div>
      <button class="btn-primary" :disabled="workspaceSaving" @click="saveWorkspace">
        {{ workspaceSaving ? 'Saving...' : 'Save workspace' }}
      </button>
    </div>

    <!-- Organization -->
    <div v-show="activeTab === 'organization'" class="space-y-6">
      <!-- No org yet -->
      <div v-if="!currentOrganization" class="card p-6 space-y-4">
        <div>
          <h2 class="text-lg font-semibold text-white">Organization</h2>
          <p class="mt-1 text-sm text-gray-400">
            Organizations group multiple workspaces under one umbrella. Org admins get implicit access to all workspaces.
          </p>
        </div>

        <div v-if="!showCreateOrgForm" class="text-center py-6">
          <p class="text-sm text-gray-500 mb-4">You don't belong to any organization yet.</p>
          <button class="btn-primary" @click="showCreateOrgForm = true">Create Organization</button>
        </div>

        <div v-else class="space-y-3">
          <div>
            <label class="label-field">Organization Name</label>
            <input v-model="newOrgName" type="text" class="input-field" placeholder="e.g. Acme Corp" />
          </div>
          <div class="flex gap-2">
            <button class="btn-secondary" @click="showCreateOrgForm = false">Cancel</button>
            <button class="btn-primary" :disabled="!newOrgName.trim() || creatingOrg" @click="handleCreateOrg">
              {{ creatingOrg ? 'Creating...' : 'Create' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Org exists -->
      <template v-else>
        <!-- Org details -->
        <div class="card p-6 space-y-4">
          <h2 class="text-lg font-semibold text-white">Organization Settings</h2>
          <div>
            <label class="label-field">Name</label>
            <input v-model="orgForm.name" type="text" class="input-field" />
          </div>
          <div>
            <label class="label-field">Organization ID</label>
            <input :value="currentOrganization.id" type="text" disabled class="input-field font-mono text-xs opacity-60" />
          </div>
          <button class="btn-primary" :disabled="orgSaving" @click="handleSaveOrg">
            {{ orgSaving ? 'Saving...' : 'Save organization' }}
          </button>
        </div>

        <!-- Org Members -->
        <div class="card p-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-lg font-semibold text-white">Organization Members</h2>
              <p class="mt-0.5 text-sm text-gray-400">{{ orgMembers.length }} member{{ orgMembers.length !== 1 ? 's' : '' }}</p>
            </div>
            <button v-if="isOrgAdmin" class="btn-primary" @click="showOrgInviteForm = !showOrgInviteForm">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
              </svg>
              Invite
            </button>
          </div>

          <!-- Org invite form -->
          <div v-if="showOrgInviteForm" class="mb-6 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
            <h3 class="mb-3 text-sm font-medium text-white">Invite to organization</h3>
            <form class="flex gap-3" @submit.prevent="handleSendOrgInvite">
              <input
                v-model="orgInviteEmail"
                type="email"
                required
                placeholder="colleague@company.com"
                class="input-field flex-1"
              />
              <select v-model="orgInviteRole" class="input-field w-32">
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="billing">Billing</option>
              </select>
              <button type="submit" class="btn-primary shrink-0" :disabled="orgInviteSending || !orgInviteEmail.trim()">
                {{ orgInviteSending ? 'Sending...' : 'Send' }}
              </button>
            </form>
            <p class="mt-2 text-xs text-gray-500">Org admins have implicit access to all workspaces in this organization.</p>
          </div>

          <!-- Org member list -->
          <div class="divide-y divide-gray-800">
            <div v-for="m in orgMembers" :key="m.user_id" class="flex items-center justify-between py-3">
              <div class="flex items-center gap-3">
                <div class="flex h-9 w-9 items-center justify-center rounded-full bg-gray-800 text-sm font-semibold text-gray-300">
                  {{ (m.profile?.full_name || m.profile?.email || '?').charAt(0).toUpperCase() }}
                </div>
                <div>
                  <p class="text-sm font-medium text-white">
                    {{ m.profile?.full_name || 'Unnamed' }}
                    <span v-if="m.user_id === getUserId()" class="text-xs text-gray-500">(you)</span>
                  </p>
                  <p class="text-xs text-gray-500">{{ m.profile?.email || m.user_id }}</p>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <span v-if="m.role === 'owner'" :class="['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset capitalize', getRoleColor(m.role)]">
                  {{ m.role }}
                </span>
                <select
                  v-else-if="isOrgAdmin && m.user_id !== getUserId()"
                  :value="m.role"
                  class="input-field !py-1 text-xs w-28"
                  @change="handleOrgRoleChange(m.user_id, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="billing">Billing</option>
                </select>
                <span v-else :class="['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset capitalize', getRoleColor(m.role)]">
                  {{ m.role }}
                </span>
                <button
                  v-if="isOrgAdmin && m.role !== 'owner' && m.user_id !== getUserId()"
                  class="btn-ghost !p-1.5 text-red-400 hover:text-red-300"
                  title="Remove member"
                  @click="handleRemoveOrgMember(m.user_id, m.profile?.full_name)"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Pending Org Invites -->
        <div v-if="orgInvites.length > 0" class="card p-6">
          <h2 class="mb-4 text-lg font-semibold text-white">Pending Organization Invites</h2>
          <div class="divide-y divide-gray-800">
            <div v-for="inv in orgInvites" :key="inv.id" class="flex items-center justify-between py-3">
              <div>
                <p class="text-sm font-medium text-white">{{ inv.email }}</p>
                <p class="text-xs text-gray-500">
                  Invited as <span class="capitalize">{{ inv.role }}</span>
                  &middot; Expires {{ new Date(inv.expires_at).toLocaleDateString() }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <span class="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400 ring-1 ring-inset ring-amber-500/20">Pending</span>
                <button
                  class="btn-ghost !p-1.5 text-red-400 hover:text-red-300"
                  title="Revoke invite"
                  @click="handleRevokeOrgInvite(inv.id)"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Org Workspaces -->
        <div class="card p-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-lg font-semibold text-white">Workspaces in Organization</h2>
              <p class="mt-0.5 text-sm text-gray-400">{{ orgWorkspaces.length }} workspace{{ orgWorkspaces.length !== 1 ? 's' : '' }}</p>
            </div>
            <button v-if="isOrgAdmin && unlinkedWorkspaces.length > 0" class="btn-secondary text-xs" @click="showMoveWorkspaceForm = !showMoveWorkspaceForm">
              {{ showMoveWorkspaceForm ? 'Cancel' : 'Move workspace here' }}
            </button>
          </div>

          <!-- Move workspace form -->
          <div v-if="showMoveWorkspaceForm && unlinkedWorkspaces.length > 0" class="mb-4 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
            <p class="text-sm text-gray-300 mb-2">Select a workspace to move into this organization:</p>
            <div class="space-y-2">
              <button
                v-for="ws in unlinkedWorkspaces"
                :key="ws.id"
                class="w-full flex items-center justify-between rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:border-indigo-500 hover:bg-indigo-500/5 transition-colors"
                @click="handleMoveWorkspace(ws.id)"
              >
                <span>{{ ws.name }}</span>
                <span class="text-xs text-gray-500">{{ ws.slug }}</span>
              </button>
            </div>
          </div>

          <!-- Workspace list -->
          <div v-if="orgWorkspaces.length === 0" class="py-6 text-center text-sm text-gray-500">
            No workspaces linked to this organization yet.
          </div>
          <div v-else class="divide-y divide-gray-800">
            <div v-for="ws in orgWorkspaces" :key="ws.id" class="flex items-center justify-between py-3">
              <div>
                <p class="text-sm font-medium text-white">{{ ws.name }}</p>
                <p class="text-xs text-gray-500">{{ ws.slug }}</p>
              </div>
              <span
                :class="[
                  'rounded-full px-2 py-0.5 text-xs',
                  ws.id === currentWorkspace?.id ? 'bg-indigo-500/10 text-indigo-400' : 'bg-gray-700/50 text-gray-400',
                ]"
              >
                {{ ws.id === currentWorkspace?.id ? 'Current' : 'Workspace' }}
              </span>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Team -->
    <div v-show="activeTab === 'team'" class="space-y-6">
      <!-- Members -->
      <div class="card p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold text-white">Team Members</h2>
            <p class="mt-0.5 text-sm text-gray-400">
              {{ members.length }} member{{ members.length !== 1 ? 's' : '' }}
              · Owner appoints Admins · Admins manage ops & keys within their scopes
            </p>
          </div>
          <button v-if="isOwner || can('team', 'invite')" class="btn-primary" @click="showInviteForm = !showInviteForm">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
            </svg>
            Invite
          </button>
        </div>

        <!-- Invite form -->
        <div v-if="showInviteForm" class="mb-6 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
          <h3 class="mb-3 text-sm font-medium text-white">Invite by email</h3>
          <form class="flex gap-3" @submit.prevent="handleSendInvite">
            <input
              v-model="inviteEmail"
              type="email"
              required
              placeholder="colleague@company.com"
              class="input-field flex-1"
            />
            <select v-model="inviteRole" class="input-field w-32">
              <option v-if="isOwner" value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
            <button type="submit" class="btn-primary shrink-0" :disabled="inviteSending || !inviteEmail.trim()">
              {{ inviteSending ? 'Sending...' : 'Send' }}
            </button>
          </form>
          <p class="mt-2 text-xs text-gray-500">
            Invite valid 7 days. <span v-if="isOwner">As owner you can appoint Admins (ops leads). </span>
            <span v-else>Only the workspace owner can invite Admins.</span>
          </p>
        </div>

        <!-- Member list -->
        <div class="divide-y divide-gray-800">
          <div v-for="m in members" :key="m.user_id" class="flex items-center justify-between py-3">
            <div class="flex items-center gap-3">
              <div class="flex h-9 w-9 items-center justify-center rounded-full bg-gray-800 text-sm font-semibold text-gray-300">
                {{ (m.profile?.full_name || m.profile?.email || '?').charAt(0).toUpperCase() }}
              </div>
              <div>
                <p class="text-sm font-medium text-white">
                  {{ m.profile?.full_name || 'Unnamed' }}
                  <span v-if="m.user_id === getUserId()" class="text-xs text-gray-500">(you)</span>
                </p>
                <p class="text-xs text-gray-500">{{ m.profile?.email || m.user_id }}</p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span v-if="m.role === 'owner'" :class="['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset capitalize', getRoleColor(m.role)]">
                {{ m.role }}
              </span>
              <select
                v-else-if="(isOwner || can('team', 'change_role')) && m.user_id !== getUserId() && m.role !== 'owner'"
                :value="m.role"
                class="input-field !py-1 text-xs w-28"
                @change="handleRoleChange(m.user_id, ($event.target as HTMLSelectElement).value)"
              >
                <option v-if="isOwner" value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
              <span v-else :class="['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset capitalize', getRoleColor(m.role)]">
                {{ m.role }}
              </span>
              <button
                v-if="(isOwner || can('team', 'remove')) && m.role !== 'owner' && m.user_id !== getUserId()"
                class="btn-ghost !p-1.5 text-red-400 hover:text-red-300"
                title="Remove member"
                @click="handleRemoveMember(m.user_id, m.profile?.full_name)"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Pending Invites -->
      <div v-if="invites.length > 0" class="card p-6">
        <h2 class="mb-4 text-lg font-semibold text-white">Pending Invites</h2>
        <div class="divide-y divide-gray-800">
          <div v-for="inv in invites" :key="inv.id" class="flex items-center justify-between py-3">
            <div>
              <p class="text-sm font-medium text-white">{{ inv.email }}</p>
              <p class="text-xs text-gray-500">
                Invited as <span class="capitalize">{{ inv.role }}</span>
                &middot; Expires {{ new Date(inv.expires_at).toLocaleDateString() }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <span class="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400 ring-1 ring-inset ring-amber-500/20">
                Pending
              </span>
              <button
                class="btn-ghost !p-1.5 text-red-400 hover:text-red-300"
                title="Revoke invite"
                @click="handleRevokeInvite(inv.id)"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Permissions Overview -->
      <div class="card p-6">
        <h2 class="mb-2 text-lg font-semibold text-white">Permission Roles</h2>
        <p class="mb-4 text-sm text-gray-400">
          Standard permission levels applied to all organizations. Custom permission schemas can be created per workspace in the future.
        </p>
        <div class="overflow-x-auto rounded-lg border border-gray-800">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-800 bg-gray-900/50">
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-400">Area</th>
                <th class="px-3 py-3 text-center text-xs font-medium text-amber-400">Owner</th>
                <th class="px-3 py-3 text-center text-xs font-medium text-indigo-400">Admin</th>
                <th class="px-3 py-3 text-center text-xs font-medium text-emerald-400">Member</th>
                <th class="px-3 py-3 text-center text-xs font-medium text-gray-400">Viewer</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-800/50">
              <tr v-for="area in ['products', 'brands', 'categories', 'integrations', 'schemas', 'team', 'workspace', 'api']" :key="area" class="hover:bg-gray-800/20">
                <td class="px-4 py-2.5 text-gray-300 capitalize">{{ area }}</td>
                <td class="px-3 py-2.5 text-center text-emerald-400">Full</td>
                <td class="px-3 py-2.5 text-center text-emerald-400">{{ area === 'workspace' ? 'R/W' : 'Full' }}</td>
                <td class="px-3 py-2.5 text-center">
                  <span v-if="['products', 'brands', 'categories'].includes(area)" class="text-emerald-400">R/W</span>
                  <span v-else-if="['integrations', 'schemas', 'team', 'workspace'].includes(area)" class="text-gray-500">Read</span>
                  <span v-else-if="area === 'api'" class="text-gray-500">Read</span>
                  <span v-else class="text-gray-500">Read</span>
                </td>
                <td class="px-3 py-2.5 text-center text-gray-600">Read</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- API Keys -->
    <div v-show="activeTab === 'api-keys'" class="space-y-6">
      <!-- Newly created key banner -->
      <div v-if="newlyCreatedKey" class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
        <p class="text-sm font-semibold text-emerald-400 mb-1">API key created successfully</p>
        <p class="text-xs text-gray-400 mb-2">Copy this key now — it will not be shown again.</p>
        <div class="flex items-center gap-2">
          <code class="flex-1 rounded bg-gray-900 px-3 py-2 font-mono text-sm text-white break-all select-all">{{ newlyCreatedKey }}</code>
          <button class="btn-primary shrink-0 text-xs" @click="copyToClipboard(newlyCreatedKey)">Copy</button>
          <button class="btn-secondary shrink-0 text-xs" @click="newlyCreatedKey = ''">Dismiss</button>
        </div>
        <div v-if="newlyCreatedKeyUse === 'pos'" class="mt-4 rounded-lg border border-emerald-500/20 bg-gray-950/70 p-3">
          <div class="mb-2 flex items-center justify-between gap-3">
            <p class="text-xs font-medium text-emerald-300">POS connector values</p>
            <button class="btn-secondary shrink-0 text-xs" @click="copyToClipboard(posConnectorSnippet)">
              Copy POS values
            </button>
          </div>
          <pre class="overflow-x-auto whitespace-pre-wrap break-all rounded bg-gray-950 p-3 font-mono text-xs text-gray-200">{{ posConnectorSnippet }}</pre>
        </div>
        <div v-if="newlyCreatedKeyUse === 'mcp'" class="mt-4 rounded-lg border border-violet-500/20 bg-gray-950/70 p-3">
          <div class="mb-2 flex items-center justify-between gap-3">
            <p class="text-xs font-medium text-violet-300">Claude / remote MCP values</p>
            <button class="btn-secondary shrink-0 text-xs" @click="copyToClipboard(mcpConnectorSnippet)">
              Copy MCP values
            </button>
          </div>
          <pre class="overflow-x-auto whitespace-pre-wrap break-all rounded bg-gray-950 p-3 font-mono text-xs text-gray-200">{{ mcpConnectorSnippet }}</pre>
        </div>
      </div>

      <!-- Claude / Remote MCP connector -->
      <div class="card p-6">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div class="max-w-2xl">
            <p class="text-xs font-medium uppercase tracking-wider text-violet-400">Remote MCP (Phase R1)</p>
            <h2 class="mt-1 text-lg font-semibold text-white">Connect Claude to this workspace</h2>
            <p class="mt-1 text-sm text-gray-400">
              Non-technical staff can add this HTTPS endpoint as a custom MCP integration in Claude.
              Keys are <strong class="text-gray-300">cloud-safe</strong>: catalog Q&amp;A, help, drafts — not submit/execute.
              Humans still approve in <NuxtLink to="/actions" class="text-indigo-400 hover:underline">Actions</NuxtLink>.
            </p>
            <p class="mt-2 font-mono text-xs text-violet-300/90">{{ mcpEndpointUrl }}</p>
            <p class="mt-2 text-xs text-gray-500">
              Full guide: <NuxtLink to="/help/connect-claude" class="text-indigo-400 hover:underline">/help/connect-claude</NuxtLink>
            </p>
          </div>
          <button class="btn-primary shrink-0" :disabled="mcpKeySaving || !currentWorkspace" @click="handleCreateMcpKey">
            {{ mcpKeySaving ? 'Creating…' : 'Create Claude / MCP key' }}
          </button>
        </div>
      </div>

      <div class="card p-6">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div class="max-w-2xl">
            <p class="text-xs font-medium uppercase tracking-wider text-indigo-400">POS integration</p>
            <h2 class="mt-1 text-lg font-semibold text-white">Connect POS to this workspace</h2>
            <p class="mt-1 text-sm text-gray-400">
              Create a connector key with POS catalog read and POS sale write access. Paste this URL and key into the
              POS app's SKUMS Connector settings.
            </p>
          </div>
          <button class="btn-primary shrink-0" :disabled="posKeySaving || !currentWorkspace" @click="handleCreatePosKey">
            {{ posKeySaving ? 'Creating...' : 'Create POS connector' }}
          </button>
        </div>

        <div class="mt-5 grid gap-3 sm:grid-cols-3">
          <div class="rounded-lg bg-gray-900/70 p-3">
            <p class="text-xs text-gray-500">Catalog</p>
            <p class="mt-1 font-mono text-xs text-gray-300">GET /api/v1/pos/catalog</p>
          </div>
          <div class="rounded-lg bg-gray-900/70 p-3">
            <p class="text-xs text-gray-500">Scan</p>
            <p class="mt-1 font-mono text-xs text-gray-300">POST /api/v1/pos/scan</p>
          </div>
          <div class="rounded-lg bg-gray-900/70 p-3">
            <p class="text-xs text-gray-500">Sales</p>
            <p class="mt-1 font-mono text-xs text-gray-300">POST /api/v1/pos/sales</p>
          </div>
        </div>

        <div class="mt-4 rounded-lg border border-gray-800 bg-gray-900/40 p-3 text-sm text-gray-400">
          <p>
            Google SSO should be set up in SKUMS first because SKUMS owns workspace, team, and API-key administration.
            POS can use this connector key for the demo and later move to register/device or shared IAM login when staff roles are ready.
          </p>
        </div>
      </div>

      <div class="card p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold text-white">API Keys</h2>
            <p class="mt-1 text-sm text-gray-400">Manage keys for external access — n8n, CLI, agents, and other integrations.</p>
          </div>
          <button class="btn-primary" @click="showKeyForm = !showKeyForm">
            {{ showKeyForm ? 'Cancel' : '+ New API Key' }}
          </button>
        </div>

        <!-- Create form -->
        <div v-if="showKeyForm" class="mb-6 rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
          <div>
            <label class="label-field">Name *</label>
            <input v-model="newKeyName" class="input-field" placeholder="e.g. n8n Production, CLI Dev" />
          </div>
          <div>
            <label class="label-field">Scopes (leave empty for full access)</label>
            <div class="flex flex-wrap gap-2 mt-1">
              <label
                v-for="scope in AVAILABLE_SCOPES"
                :key="scope.key"
                class="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs cursor-pointer transition-colors"
                :class="newKeyScopes.includes(scope.key) ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-gray-700 text-gray-400 hover:border-gray-600'"
              >
                <input
                  v-model="newKeyScopes"
                  type="checkbox"
                  :value="scope.key"
                  class="sr-only"
                />
                {{ scope.label }}
              </label>
            </div>
          </div>
          <button class="btn-primary" :disabled="!newKeyName.trim() || keySaving" @click="handleCreateKey">
            {{ keySaving ? 'Creating…' : 'Create Key' }}
          </button>
        </div>

        <!-- Endpoint hint -->
        <div class="mb-4 rounded-lg bg-gray-800/50 border border-gray-700 p-4 text-sm">
          <p class="text-white font-medium mb-2">Quick Start</p>
          <div class="space-y-1 text-gray-400">
            <p>Base URL: <code class="text-indigo-400">{your-app-url}/api/v1</code></p>
            <p>Auth: <code class="text-indigo-400">Authorization: Bearer sk_live_…</code> or <code class="text-indigo-400">X-API-Key: sk_live_…</code></p>
            <p class="mt-2">Endpoints: <code class="text-indigo-400">/products</code> · <code class="text-indigo-400">/brands</code> · <code class="text-indigo-400">/categories</code> · <code class="text-indigo-400">/schemas</code></p>
          </div>
        </div>

        <!-- Keys table -->
        <div v-if="apiKeys.length > 0" class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-700 text-left text-gray-400">
                <th class="pb-2 pr-4">Name</th>
                <th class="pb-2 pr-4">Kind</th>
                <th class="pb-2 pr-4">Prefix</th>
                <th class="pb-2 pr-4">Scopes</th>
                <th class="pb-2 pr-4">Last Used</th>
                <th class="pb-2 pr-4">Requests</th>
                <th class="pb-2 pr-4">Status</th>
                <th class="pb-2"></th>
              </tr>
            </thead>
            <tbody class="text-gray-300">
              <tr v-for="key in apiKeys" :key="key.id" class="border-b border-gray-800">
                <td class="py-2.5 pr-4 font-medium text-white">
                  {{ key.name }}
                  <span v-if="key.max_package" class="mt-0.5 block text-[10px] font-normal text-gray-500">{{ key.max_package }}</span>
                </td>
                <td class="py-2.5 pr-4 text-xs text-gray-400">{{ key.key_kind || 'general' }}</td>
                <td class="py-2.5 pr-4 font-mono text-xs text-gray-400">{{ key.key_prefix }}…</td>
                <td class="py-2.5 pr-4">
                  <span v-if="!key.scopes || key.scopes.length === 0" class="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-400">Legacy empty</span>
                  <span v-else class="text-xs text-gray-400">{{ key.scopes.length }} scopes</span>
                </td>
                <td class="py-2.5 pr-4 text-xs text-gray-500">
                  {{ key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never' }}
                </td>
                <td class="py-2.5 pr-4 text-xs text-gray-500">{{ key.total_requests.toLocaleString() }}</td>
                <td class="py-2.5 pr-4">
                  <span
                    class="rounded-full px-2 py-0.5 text-xs"
                    :class="key.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'"
                  >
                    {{ key.revoked_at ? 'Revoked' : key.is_active ? 'Active' : 'Disabled' }}
                  </span>
                </td>
                <td class="py-2.5 text-right space-x-2">
                  <button
                    v-if="!key.revoked_at"
                    class="text-xs text-gray-400 hover:text-white"
                    @click="handleToggleKey(key.id, key.is_active)"
                  >
                    {{ key.is_active ? 'Disable' : 'Enable' }}
                  </button>
                  <button
                    v-if="!key.revoked_at"
                    class="text-xs text-red-400 hover:text-red-300"
                    @click="handleDeleteKey(key.id)"
                  >
                    Revoke
                  </button>
                  <span v-else class="text-xs text-gray-600">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="text-center py-8 text-sm text-gray-500">
          No API keys yet. Create one to connect n8n, CLI tools, or agents.
        </div>
      </div>
    </div>

    <!-- Custom Fields -->
    <div v-show="activeTab === 'custom-fields'" class="space-y-4">
      <div class="card p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold text-white">Custom Fields</h2>
            <p class="mt-1 text-sm text-gray-400">Define additional fields for your products</p>
          </div>
          <button class="btn-primary" @click="showFieldForm = true">
            Add field
          </button>
        </div>

        <!-- New field form -->
        <div v-if="showFieldForm" class="mb-6 rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label-field">Field Name</label>
              <input
                v-model="fieldForm.field_name"
                type="text"
                class="input-field"
                placeholder="e.g. Warranty Period"
                @input="autoGenerateKey"
              />
            </div>
            <div>
              <label class="label-field">Field Key</label>
              <input v-model="fieldForm.field_key" type="text" class="input-field font-mono text-xs" placeholder="warranty_period" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label-field">Type</label>
              <select v-model="fieldForm.field_type" class="input-field">
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean (Yes/No)</option>
                <option value="date">Date</option>
                <option value="url">URL</option>
                <option value="email">Email</option>
                <option value="select">Select (Dropdown)</option>
                <option value="json">JSON</option>
              </select>
            </div>
            <div>
              <label class="label-field">Description</label>
              <input v-model="fieldForm.description" type="text" class="input-field" placeholder="Optional description" />
            </div>
          </div>
          <div class="flex items-center justify-between">
            <label class="flex items-center gap-2 text-sm text-gray-300">
              <input v-model="fieldForm.is_required" type="checkbox" class="rounded border-gray-600 bg-gray-800 text-indigo-500" />
              Required field
            </label>
            <div class="flex gap-2">
              <button class="btn-secondary" @click="showFieldForm = false">Cancel</button>
              <button class="btn-primary" :disabled="fieldSaving" @click="saveField">Create field</button>
            </div>
          </div>
        </div>

        <!-- Fields list -->
        <div v-if="customFields.length === 0 && !showFieldForm" class="py-8 text-center text-sm text-gray-500">
          No custom fields defined yet
        </div>
        <div v-else class="divide-y divide-gray-800">
          <div v-for="field in customFields" :key="field.id" class="flex items-center justify-between py-3">
            <div>
              <p class="font-medium text-white">{{ field.field_name }}</p>
              <p class="text-xs text-gray-500">
                <code class="rounded bg-gray-800 px-1.5 py-0.5">{{ field.field_key }}</code>
                &middot; {{ field.field_type }}
                <span v-if="field.is_required" class="text-red-400">&middot; required</span>
              </p>
            </div>
            <button class="btn-ghost !p-1.5 text-red-400" @click="deleteField(field.id)">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- AI Assistant -->
    <div v-show="activeTab === 'assistant'" class="card p-6 space-y-5">
      <div>
        <h2 class="text-lg font-semibold text-white">Catalog Assistant (in-app)</h2>
        <p class="mt-1 text-sm text-gray-400">
          Powered by xAI Grok. This is the floating <strong class="text-gray-300">Catalog AI</strong> drawer — live Q&amp;A over your imported products, inventory, and Actions queue.
        </p>
        <div class="mt-3 rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2 text-xs text-gray-400 space-y-1">
          <p><strong class="text-gray-300">In-app Assistant</strong> — catalog counts/search for large imports (uses tools + your xAI key on the server).</p>
          <p><strong class="text-gray-300">MCP</strong> (<code class="text-gray-500">npm run mcp</code> in Cursor/Claude) — marketplace study, draft POs, pipeline. Same workspace data; approve in <strong class="text-gray-300">Actions</strong>.</p>
          <p>They share Supabase + xAI but are different surfaces — pick one based on whether you are in the browser or an IDE agent.</p>
        </div>
      </div>

      <div>
        <label class="label-field">Business Role</label>
        <select v-model="assistantProfile.user_role" class="input-field">
          <option value="retailer">Retailer</option>
          <option value="manufacturer">Manufacturer</option>
          <option value="marketer">Marketer</option>
          <option value="distributor">Distributor</option>
          <option value="custom">Custom</option>
        </select>
        <p class="mt-1 text-xs text-gray-500">Tells the assistant how to frame recommendations and data transformations.</p>
      </div>

      <div>
        <label class="label-field">Model</label>
        <select v-model="assistantProfile.preferred_model" class="input-field">
          <option value="grok-3-mini">Grok 3 Mini — Fast (recommended)</option>
          <option value="grok-3">Grok 3 — Reasoning (slower, deeper analysis)</option>
        </select>
      </div>

      <div>
        <label class="label-field">Slack Webhook URL</label>
        <input
          v-model="assistantProfile.slack_webhook_url"
          type="url"
          class="input-field"
          placeholder="https://hooks.slack.com/services/..."
        />
        <p class="mt-1 text-xs text-gray-500">Optional. Enables the assistant to post insights and alerts to your Slack channel.</p>
      </div>

      <div>
        <label class="label-field">Additional Instructions</label>
        <textarea
          v-model="assistantProfile.system_prompt_additions"
          class="input-field min-h-[100px] resize-y"
          placeholder="e.g. Always respond in British English. Focus on Amazon seller metrics. Never suggest deleting products."
        />
        <p class="mt-1 text-xs text-gray-500">Extra instructions appended to the assistant's system prompt.</p>
      </div>

      <button class="btn-primary" :disabled="assistantSaving" @click="saveAssistantProfile">
        {{ assistantSaving ? 'Saving...' : 'Save AI settings' }}
      </button>
    </div>
  </div>
</template>
