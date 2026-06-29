import type { Organization, OrganizationMember, OrganizationInvite, Workspace } from '~/types'

const currentOrganization = ref<Organization | null>(null)
const organizations = ref<Organization[]>([])
const orgMembers = ref<(OrganizationMember & { profile?: any })[]>([])
const orgInvites = ref<OrganizationInvite[]>([])
const orgWorkspaces = ref<Workspace[]>([])
const hasFetchedOrgs = ref(false)

function getUid(u: any): string | undefined {
  return u?.id || u?.sub
}

export function useOrganization() {
  const client = useSupabaseClient()
  const user = useSupabaseUser()

  async function fetchOrganizations() {
    const uid = getUid(user.value)
    if (!uid) return

    const { data: memberships } = await client
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', uid)

    if (!memberships || memberships.length === 0) {
      organizations.value = []
      hasFetchedOrgs.value = true
      return
    }

    const orgIds = memberships.map((m: any) => m.organization_id)
    const { data: orgs } = await client
      .from('organizations')
      .select('*')
      .in('id', orgIds)
      .order('name')

    organizations.value = (orgs || []) as Organization[]

    // Auto-select first org if none selected
    if (organizations.value.length > 0 && !currentOrganization.value) {
      currentOrganization.value = organizations.value[0]
    }

    hasFetchedOrgs.value = true
  }

  function selectOrganization(org: Organization) {
    currentOrganization.value = org
  }

  async function createOrganization(name: string): Promise<Organization> {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

    const { data, error } = await client.rpc('create_organization', {
      org_name: name,
      org_slug: slug,
    })

    if (error) throw error

    const org = data as unknown as Organization
    currentOrganization.value = org
    organizations.value = [...organizations.value, org]
    return org
  }

  async function updateOrganization(updates: Partial<Pick<Organization, 'name' | 'logo_url' | 'billing_email'>>) {
    if (!currentOrganization.value) throw new Error('No organization selected')

    const { error } = await client
      .from('organizations')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', currentOrganization.value.id)

    if (error) throw error

    // Update local state
    Object.assign(currentOrganization.value, updates)
  }

  // ── Members ──

  async function fetchOrgMembers() {
    if (!currentOrganization.value) return
    const { data } = await client
      .from('organization_members')
      .select('*, profile:profiles(*)')
      .eq('organization_id', currentOrganization.value.id)
      .order('created_at')
    orgMembers.value = (data || []) as any[]
  }

  async function updateOrgMemberRole(userId: string, role: 'admin' | 'member' | 'billing') {
    if (!currentOrganization.value) return
    const { error } = await client
      .from('organization_members')
      .update({ role })
      .eq('organization_id', currentOrganization.value.id)
      .eq('user_id', userId)
    if (error) throw error
    await fetchOrgMembers()
  }

  async function removeOrgMember(userId: string) {
    if (!currentOrganization.value) return
    const { error } = await client
      .from('organization_members')
      .delete()
      .eq('organization_id', currentOrganization.value.id)
      .eq('user_id', userId)
    if (error) throw error
    await fetchOrgMembers()
  }

  // ── Invites ──

  async function fetchOrgInvites() {
    if (!currentOrganization.value) return
    const { data } = await client
      .from('organization_invites')
      .select('*, inviter:profiles!organization_invites_invited_by_fkey(*)')
      .eq('organization_id', currentOrganization.value.id)
      .in('status', ['pending'])
      .order('created_at', { ascending: false })
    orgInvites.value = (data || []) as OrganizationInvite[]
  }

  async function sendOrgInvite(email: string, role: 'admin' | 'member' | 'billing'): Promise<OrganizationInvite> {
    if (!currentOrganization.value) throw new Error('No organization selected')
    const uid = getUid(user.value)
    const { data, error } = await client
      .from('organization_invites')
      .insert({
        organization_id: currentOrganization.value.id,
        email: email.toLowerCase().trim(),
        role,
        invited_by: uid,
      })
      .select()
      .single()
    if (error) throw error
    await fetchOrgInvites()
    return data as OrganizationInvite
  }

  async function revokeOrgInvite(id: string) {
    const { error } = await client
      .from('organization_invites')
      .update({ status: 'revoked' })
      .eq('id', id)
    if (error) throw error
    await fetchOrgInvites()
  }

  async function acceptOrgInvite(token: string): Promise<{ status: string; organization_id: string }> {
    const { data, error } = await client.rpc('accept_org_invite', { p_token: token })
    if (error) throw error
    return data as { status: string; organization_id: string }
  }

  // ── Workspaces in org ──

  async function fetchOrgWorkspaces() {
    if (!currentOrganization.value) return
    const { data } = await client
      .from('workspaces')
      .select('*')
      .eq('organization_id', currentOrganization.value.id)
      .order('name')
    orgWorkspaces.value = (data || []) as Workspace[]
  }

  async function moveWorkspaceToOrg(workspaceId: string) {
    if (!currentOrganization.value) throw new Error('No organization selected')
    const { error } = await client.rpc('move_workspace_to_org', {
      p_workspace_id: workspaceId,
      p_org_id: currentOrganization.value.id,
    })
    if (error) throw error
    await fetchOrgWorkspaces()
  }

  // ── Helpers ──

  function getMyOrgRole(): string | null {
    const uid = getUid(user.value)
    if (!uid || !currentOrganization.value) return null
    const member = orgMembers.value.find(m => m.user_id === uid)
    return member?.role || null
  }

  const isOrgAdmin = computed(() => {
    const role = getMyOrgRole()
    return role === 'owner' || role === 'admin'
  })

  const isOrgOwner = computed(() => {
    return getMyOrgRole() === 'owner'
  })

  async function loadAll() {
    await Promise.all([
      fetchOrgMembers(),
      fetchOrgInvites(),
      fetchOrgWorkspaces(),
    ])
  }

  return {
    currentOrganization,
    organizations,
    orgMembers,
    orgInvites,
    orgWorkspaces,
    hasFetchedOrgs,
    isOrgAdmin,
    isOrgOwner,

    fetchOrganizations,
    selectOrganization,
    createOrganization,
    updateOrganization,

    fetchOrgMembers,
    updateOrgMemberRole,
    removeOrgMember,

    fetchOrgInvites,
    sendOrgInvite,
    revokeOrgInvite,
    acceptOrgInvite,

    fetchOrgWorkspaces,
    moveWorkspaceToOrg,

    getMyOrgRole,
    loadAll,
  }
}
