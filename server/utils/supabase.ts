import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function getAdminClient(): SupabaseClient {
  const config = useRuntimeConfig()
  const url = config.supabaseUrl || process.env.SUPABASE_URL || ''
  const key = config.supabaseServiceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured')
  return createClient(url, key)
}

export function getServiceClient(): SupabaseClient {
  return getAdminClient()
}
