/**
 * Weekday recon digest for shipping gaps.
 * GET/POST /api/apps/shipping/recon-digest
 * Auth: Bearer SHIPPING_RECON_SECRET | SHIPPING_INGEST_SECRET | CRON_SECRET
 */

function expectedSecret(config: any): string {
  return (
    config.shippingReconSecret
    || process.env.SHIPPING_RECON_SECRET
    || config.shippingIngestSecret
    || process.env.SHIPPING_INGEST_SECRET
    || process.env.CRON_SECRET
    || config.marketplaceCronSecret
    || config.queueProcessorKey
    || ""
  )
}

function assertAuth(event: any, config: any) {
  const authHeader = getHeader(event, "authorization") || ""
  const token = authHeader.replace(/^Bearer\s+/i, "").trim()
  const expected = expectedSecret(config)
  if (!expected || token !== expected) {
    throw createError({ statusCode: 401, statusMessage: "Invalid or missing recon secret" })
  }
}

async function runRecon(event: any) {
  const config = useRuntimeConfig()
  assertAuth(event, config)
  const query = getQuery(event)
  const body = event.method === "GET" ? {} : await readBody(event).catch(() => ({} as any))
  const workspaceId = String(body.workspace_id || query.workspace_id || process.env.FRAN_MCP_WORKSPACE_ID || "").trim()
  const client = getServiceClient()

  let q = client.from("shipping_shipments").select("id,title,status,missing_fields,storage_risk,exception_open,package_mismatch,batch_number,quote_number,updated_at").neq("status", "closed").order("updated_at", { ascending: false }).limit(50)
  if (workspaceId) q = q.eq("workspace_id", workspaceId)
  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const rows = data || []
  const gaps = rows.filter((r: any) => (r.missing_fields || []).length || r.storage_risk || r.exception_open || r.package_mismatch)
  const toEmail = config.shippingReconEmail || process.env.SHIPPING_RECON_EMAIL || "jeremy@heyfran.com"
  const subject = `[Fran Shipping] Weekday recon — ${gaps.length} shipment(s) with gaps`
  const lines = gaps.map((r: any) => {
    const missing = (r.missing_fields || []).join(", ") || "—"
    return `- ${r.title} [${r.status}] batch=${r.batch_number || "—"} missing=${missing} storage_risk=${r.storage_risk} exception=${r.exception_open}`
  })
  const text = [`To: ${toEmail}`, subject, "", `Open shipments scanned: ${rows.length}`, `With gaps: ${gaps.length}`, "", ...lines].join("\n")

  // Stub mailer: log only (no provider wired).
  console.info("[shipping.recon-digest] stub email\n" + text)

  if (workspaceId) {
    for (const r of gaps.slice(0, 20)) {
      await client.from("shipping_events").insert({
        workspace_id: workspaceId,
        shipment_id: r.id,
        event_type: "recon",
        title: "Weekday recon digest",
        body: `Included in digest to ${toEmail}`,
        source: "system",
        metadata: { stub_email: true, to: toEmail },
      })
    }
  }

  return { ok: true, to: toEmail, subject, scanned: rows.length, gaps: gaps.length, stub_email: true, preview: text, at: new Date().toISOString() }
}

export default defineEventHandler(async (event) => runRecon(event))
