/** GET /api/apps/shipping?workspace_id= */
import { serverSupabaseClient, serverSupabaseUser } from "#supabase/server"

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: "Unauthorized" })
  const query = getQuery(event)
  const workspaceId = String(query.workspace_id || "").trim()
  if (!workspaceId) throw createError({ statusCode: 400, statusMessage: "workspace_id required" })

  const client = await serverSupabaseClient(event)
  await requireWorkspaceAccess(event, client as any, workspaceId, "member")

  let q = client.from("shipping_shipments").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(100)
  if (query.status) q = q.eq("status", String(query.status))
  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { data: data || [] }
})
