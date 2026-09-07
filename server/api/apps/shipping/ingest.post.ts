/**
 * POST /api/apps/shipping/ingest
 * Auth: Authorization Bearer SHIPPING_INGEST_SECRET (or x-shipping-ingest-secret)
 * Body: shipment upsert + optional events/notes/files/lines
 */

type ShippingStatus = 'intake' | 'quote' | 'booked' | 'pickup_scheduled' | 'in_transit' | 'arrived_sg' | 'delivered' | 'closed' | 'on_hold' | 'exception'


function expectedSecret(config: any): string {
  return config.shippingIngestSecret || process.env.SHIPPING_INGEST_SECRET || process.env.CRON_SECRET || ""
}

function assertIngestAuth(event: any, config: any) {
  const header = getHeader(event, "authorization") || ""
  const bearer = header.replace(/^Bearer\s+/i, "").trim()
  const alt = getHeader(event, "x-shipping-ingest-secret") || ""
  const token = bearer || String(alt).trim()
  const expected = expectedSecret(config)
  if (!expected || token !== expected) {
    throw createError({ statusCode: 401, statusMessage: "Invalid or missing shipping ingest secret" })
  }
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  assertIngestAuth(event, config)
  const body = await readBody(event).catch(() => ({} as any))
  const workspaceId = String(body.workspace_id || "").trim()
  if (!workspaceId) throw createError({ statusCode: 400, statusMessage: "workspace_id required" })

  const client = getServiceClient()
  const shipmentInput = body.shipment || body
  const idempotencyKey = shipmentInput.idempotency_key || body.idempotency_key || null

  let existing: any = null
  if (idempotencyKey) {
    const { data } = await client.from("shipping_shipments").select("*").eq("workspace_id", workspaceId).eq("idempotency_key", idempotencyKey).maybeSingle()
    existing = data
  } else if (body.shipment_id) {
    const { data } = await client.from("shipping_shipments").select("*").eq("workspace_id", workspaceId).eq("id", body.shipment_id).maybeSingle()
    existing = data
  }

  const nextStatus = (shipmentInput.status || existing?.status || "intake") as ShippingStatus
  if (existing?.status && !canTransition(existing.status as ShippingStatus, nextStatus)) {
    throw createError({ statusCode: 400, statusMessage: `Illegal status transition ${existing.status} -> ${nextStatus}` })
  }

  const filesPreview = Array.isArray(body.files) ? body.files : []
  const missing = Array.isArray(shipmentInput.missing_fields)
    ? shipmentInput.missing_fields
    : deriveMissingFields({ ...existing, ...shipmentInput }, filesPreview)
  const row: Record<string, any> = {
    workspace_id: workspaceId,
    title: shipmentInput.title || existing?.title || "Shipment",
    status: nextStatus,
    mode: shipmentInput.mode || existing?.mode || "air",
    forwarder_name: shipmentInput.forwarder_name ?? existing?.forwarder_name ?? null,
    origin_name: shipmentInput.origin_name ?? existing?.origin_name ?? null,
    destination_name: shipmentInput.destination_name ?? existing?.destination_name ?? null,
    shipper_name: shipmentInput.shipper_name ?? existing?.shipper_name ?? null,
    consignee_name: shipmentInput.consignee_name ?? existing?.consignee_name ?? null,
    contact_email: shipmentInput.contact_email ?? existing?.contact_email ?? null,
    quote_number: shipmentInput.quote_number ?? existing?.quote_number ?? null,
    batch_number: shipmentInput.batch_number ?? existing?.batch_number ?? null,
    mawb: shipmentInput.mawb ?? existing?.mawb ?? null,
    hawb: shipmentInput.hawb ?? existing?.hawb ?? null,
    flight_number: shipmentInput.flight_number ?? existing?.flight_number ?? null,
    flight_date: shipmentInput.flight_date ?? existing?.flight_date ?? null,
    pickup_eta: shipmentInput.pickup_eta ?? existing?.pickup_eta ?? null,
    pickup_confirmed_at: shipmentInput.pickup_confirmed_at ?? existing?.pickup_confirmed_at ?? null,
    driver_name: shipmentInput.driver_name ?? existing?.driver_name ?? null,
    package_count: shipmentInput.package_count ?? existing?.package_count ?? null,
    weight_kg: shipmentInput.weight_kg ?? existing?.weight_kg ?? null,
    carrier_shipment_ids: shipmentInput.carrier_shipment_ids ?? existing?.carrier_shipment_ids ?? [],
    drive_folder_url: shipmentInput.drive_folder_url ?? existing?.drive_folder_url ?? null,
    drive_folder_id: shipmentInput.drive_folder_id ?? existing?.drive_folder_id ?? null,
    storage_risk: shipmentInput.storage_risk ?? existing?.storage_risk ?? false,
    exception_open: shipmentInput.exception_open ?? existing?.exception_open ?? false,
    package_mismatch: shipmentInput.package_mismatch ?? existing?.package_mismatch ?? false,
    missing_fields: missing,
    current_location_label: shipmentInput.current_location_label ?? existing?.current_location_label ?? null,
    idempotency_key: idempotencyKey,
    metadata: { ...(existing?.metadata || {}), ...(shipmentInput.metadata || {}), source: "ingest" },
  }
  row.badges = shipmentInput.badges || computeShippingBadges(row)
  if (existing && existing.status !== nextStatus) row.status_changed_at = new Date().toISOString()

  let shipment: any
  if (existing) {
    const { data, error } = await client.from("shipping_shipments").update(row).eq("id", existing.id).select().single()
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    shipment = data
  } else {
    const { data, error } = await client.from("shipping_shipments").insert(row).select().single()
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    shipment = data
  }

  if (!existing || existing.status !== nextStatus) {
    await client.from("shipping_events").insert({
      workspace_id: workspaceId,
      shipment_id: shipment.id,
      event_type: "status_transition",
      from_status: existing?.status || null,
      to_status: nextStatus,
      title: existing ? `Status -> ${nextStatus}` : `Created as ${nextStatus}`,
      body: body.event_body || null,
      source: "ingest",
      metadata: { ingest: true },
    })
  } else {
    await client.from("shipping_events").insert({
      workspace_id: workspaceId,
      shipment_id: shipment.id,
      event_type: "ingest",
      title: body.event_title || "Ingest update",
      body: body.event_body || null,
      source: "ingest",
      metadata: { ingest: true },
    })
  }

  if (Array.isArray(body.notes)) {
    for (const n of body.notes) {
      await client.from("shipping_notes").insert({
        workspace_id: workspaceId,
        shipment_id: shipment.id,
        note_type: n.note_type || "staff",
        body: n.body,
        author_label: n.author_label || null,
        is_curated: n.is_curated !== false,
        occurred_at: n.occurred_at || new Date().toISOString(),
        metadata: n.metadata || {},
      })
    }
  }
  if (Array.isArray(body.files)) {
    for (const f of body.files) {
      await client.from("shipping_files").insert({
        workspace_id: workspaceId,
        shipment_id: shipment.id,
        label: f.label || f.file_kind || "file",
        file_kind: f.file_kind || "other",
        drive_url: f.drive_url || null,
        drive_file_id: f.drive_file_id || null,
        is_missing: Boolean(f.is_missing),
        sort_order: f.sort_order ?? 0,
        metadata: f.metadata || {},
      })
    }
  }
  if (Array.isArray(body.lines)) {
    for (const [i, line] of body.lines.entries()) {
      await client.from("shipping_lines").insert({
        workspace_id: workspaceId,
        shipment_id: shipment.id,
        line_number: line.line_number ?? i + 1,
        package_ref: line.package_ref || null,
        description: line.description || null,
        sku: line.sku || null,
        quantity: line.quantity ?? null,
        weight_kg: line.weight_kg ?? null,
        metadata: line.metadata || {},
      })
    }
  }

  return { ok: true, data: shipment, duplicate: Boolean(existing && idempotencyKey) }
})
