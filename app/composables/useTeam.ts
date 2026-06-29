import type {
  WorkspaceMember,
  WorkspaceInvite,
  PermissionSchema,
  PermissionsMap,
  PermissionArea,
  PermissionSet,
} from '~/types'

export function useTeam() {
  const client = useSupabaseClient()
  const user = useSupabaseUser()
  const { currentWorkspace } = useWorkspace()

  const members = ref<(WorkspaceMember & { profile?: any })[]>([])
  const invites = ref<WorkspaceInvite[]>([])
  const permissionSchemas = ref<PermissionSchema[]>([])
  const myPermissions = ref<PermissionsMap | null>(null)
  const loading = ref(false)

  function getUid(): string | undefined {
    const u = user.value as any
    return u?.id || u?.sub
  }

  // ── Members ──

  async function fetchMembers() {
    if (!currentWorkspace.value) return
    const { data } = await client
      .from('workspace_members')
      .select('*, profile:profiles(*)')
      .eq('workspace_id', currentWorkspace.value.id)
      .order('created_at')
    members.value = (data || []) as any[]
  }

  async function updateMemberRole(userId: string, role: 'admin' | 'member' | 'viewer') {
    if (!currentWorkspace.value) return
    const { error } = await client
      .from('workspace_members')
      .update({ role })
      .eq('workspace_id', currentWorkspace.value.id)
      .eq('user_id', userId)
    if (error) throw error
    await fetchMembers()
  }

  async function removeMember(userId: string) {
    if (!currentWorkspace.value) return
    const { error } = await client
      .from('workspace_members')
      .delete()
      .eq('workspace_id', currentWorkspace.value.id)
      .eq('user_id', userId)
    if (error) throw error
    await fetchMembers()
  }

  // ── Invites ──

  async function fetchInvites() {
    if (!currentWorkspace.value) return
    const { data } = await client
      .from('workspace_invites')
      .select('*, inviter:profiles!workspace_invites_invited_by_fkey(*)')
      .eq('workspace_id', currentWorkspace.value.id)
      .in('status', ['pending'])
      .order('created_at', { ascending: false })
    invites.value = (data || []) as WorkspaceInvite[]
  }

  async function sendInvite(email: string, role: 'admin' | 'member' | 'viewer'): Promise<WorkspaceInvite> {
    if (!currentWorkspace.value) throw new Error('No workspace selected')
    const uid = getUid()
    const { data, error } = await client
      .from('workspace_invites')
      .insert({
        workspace_id: currentWorkspace.value.id,
        email: email.toLowerCase().trim(),
        role,
        invited_by: uid,
      })
      .select()
      .single()
    if (error) throw error
    await fetchInvites()
    return data as WorkspaceInvite
  }

  async function revokeInvite(id: string) {
    const { error } = await client
      .from('workspace_invites')
      .update({ status: 'revoked' })
      .eq('id', id)
    if (error) throw error
    await fetchInvites()
  }

  async function acceptInvite(token: string): Promise<{ status: string; workspace_id: string }> {
    const { data, error } = await client.rpc('accept_invite', { p_token: token })
    if (error) throw error
    return data as { status: string; workspace_id: string }
  }

  async function fetchMyPendingInvites(): Promise<WorkspaceInvite[]> {
    const { data } = await client
      .from('workspace_invites')
      .select('*, workspace:workspaces(name, slug)')
      .eq('status', 'pending')
    return (data || []) as WorkspaceInvite[]
  }

  // ── Permissions ──

  async function fetchPermissionSchemas() {
    const promises = [
      client.from('permission_schemas').select('*').is('workspace_id', null).order('name'),
    ]
    if (currentWorkspace.value) {
      promises.push(
        client.from('permission_schemas').select('*').eq('workspace_id', currentWorkspace.value.id).order('name'),
      )
    }
    const results = await Promise.all(promises)
    const global = (results[0].data || []) as PermissionSchema[]
    const ws = results.length > 1 ? (results[1].data || []) as PermissionSchema[] : []
    permissionSchemas.value = [...global, ...ws]
  }

  async function fetchMyPermissions() {
    if (!currentWorkspace.value) return
    const { data, error } = await client.rpc('get_my_permissions', {
      p_workspace_id: currentWorkspace.value.id,
    })
    if (error) {
      console.error('[SKUMS] fetchMyPermissions:', error.message)
      return
    }
    myPermissions.value = data as PermissionsMap
  }

  function can(area: PermissionArea, action: keyof PermissionSet): boolean {
    if (!myPermissions.value) return false
    const areaPerms = myPermissions.value[area]
    if (!areaPerms) return false
    return !!areaPerms[action]
  }

  function getDefaultSchemaForRole(role: string): PermissionSchema | undefined {
    return permissionSchemas.value.find(
      s => s.workspace_id === null && s.slug === role && s.is_default,
    )
  }

  // ── Load All ──

  async function loadAll() {
    loading.value = true
    try {
      await Promise.all([
        fetchMembers(),
        fetchInvites(),
        fetchPermissionSchemas(),
        fetchMyPermissions(),
      ])
    } finally {
      loading.value = false
    }
  }

  return {
    members,
    invites,
    permissionSchemas,
    myPermissions,
    loading,

    fetchMembers,
    updateMemberRole,
    removeMember,

    fetchInvites,
    sendInvite,
    revokeInvite,
    acceptInvite,
    fetchMyPendingInvites,

    fetchPermissionSchemas,
    fetchMyPermissions,
    can,
    getDefaultSchemaForRole,

    loadAll,
  }
}
