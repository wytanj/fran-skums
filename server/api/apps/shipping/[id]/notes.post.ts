/** POST /api/apps/shipping/:id/notes */
import { serverSupabaseClient, serverSupabaseUser } from "#supabase/server"

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  const uid = (user as any)?.id || (user as any)?.sub
  if (!uid) throw createError({ statusCode: 401, statusMessage: "Unauthorized" })
  const id = getRouterParam(event, "id")
  const body = await readBody(event).catch(() => ({} as any))
  const workspaceId = String(body.workspace_id || "").trim()
  const noteBody = String(body.body || "").trim()
  if (!id || !workspaceId || !noteBody) throw createError({ statusCode: 400, statusMessage: "id, workspace_id, body required" })

  const client = await serverSupabaseClient(event)
  await requireWorkspaceAccess(event, client as any, workspaceId, "write")

  const { data, error } = await client.from("shipping_notes").insert({
    workspace_id: workspaceId,
    shipment_id: id,
    note_type: body.note_type || "staff",
    body: noteBody,
    author_label: body.author_label || null,
    is_curated: body.is_curated !== false,
    occurred_at: body.occurred_at || new Date().toISOString(),
    created_by: uid,
    metadata: body.metadata || {},
  }).select().single()
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  await client.from("shipping_events").insert({
    workspace_id: workspaceId,
    shipment_id: id,
    event_type: "note",
    title: body.note_type === "whatsapp_excerpt" ? "WhatsApp excerpt added" : "Staff note added",
    body: noteBody.slice(0, 240),
    source: "ui",
    created_by: uid,
    metadata: { note_id: data.id },
  })

  return { data }
})
