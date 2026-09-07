/** GET /api/apps/shipping/:id */
import { serverSupabaseClient, serverSupabaseUser } from "#supabase/server"

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: "Unauthorized" })
  const id = getRouterParam(event, "id")
  const query = getQuery(event)
  const workspaceId = String(query.workspace_id || "").trim()
  if (!id) throw createError({ statusCode: 400, statusMessage: "id required" })
  if (!workspaceId) throw createError({ statusCode: 400, statusMessage: "workspace_id required" })

  const client = await serverSupabaseClient(event)
  await requireWorkspaceAccess(event, client as any, workspaceId, "member")

  const { data: shipment, error } = await client.from("shipping_shipments").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle()
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!shipment) throw createError({ statusCode: 404, statusMessage: "Shipment not found" })

  const [events, notes, files, lines] = await Promise.all([
    client.from("shipping_events").select("*").eq("shipment_id", id).order("occurred_at", { ascending: true }),
    client.from("shipping_notes").select("*").eq("shipment_id", id).order("occurred_at", { ascending: false }),
    client.from("shipping_files").select("*").eq("shipment_id", id).order("sort_order", { ascending: true }),
    client.from("shipping_lines").select("*").eq("shipment_id", id).order("line_number", { ascending: true }),
  ])

  return {
    data: {
      shipment,
      events: events.data || [],
      notes: notes.data || [],
      files: files.data || [],
      lines: lines.data || [],
    },
  }
})
