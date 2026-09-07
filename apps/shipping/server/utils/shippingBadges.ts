export type ShippingBadge = { key: string; label: string; severity: "info" | "warning" | "danger" }

export function computeShippingBadges(shipment: Record<string, any>): ShippingBadge[] {
  const badges: ShippingBadge[] = []
  const missing: string[] = Array.isArray(shipment.missing_fields) ? shipment.missing_fields : []
  if (shipment.storage_risk) badges.push({ key: "storage_risk", label: "Storage / booking-lead risk", severity: "warning" })
  if (shipment.exception_open) badges.push({ key: "exception_open", label: "Exception open", severity: "danger" })
  if (shipment.package_mismatch) badges.push({ key: "pkg_mismatch", label: "Package mismatch", severity: "danger" })
  for (const m of missing) {
    const label = String(m).replace(/_/g, " ")
    badges.push({ key: `missing_${m}`, label: `Missing: ${label}`, severity: m.includes("ci") || m.includes("waybill") ? "danger" : "warning" })
  }
  if (Array.isArray(shipment.badges) && shipment.badges.length && !badges.length) {
    return shipment.badges as ShippingBadge[]
  }
  return badges
}

export function deriveMissingFields(shipment: Record<string, any>, files: Array<Record<string, any>> = []): string[] {
  const missing: string[] = []
  const kinds = new Set(files.filter((f) => !f.is_missing && f.drive_url).map((f) => f.file_kind))
  if (!kinds.has("ci")) missing.push("commercial_invoice")
  if (!kinds.has("waybill")) missing.push("waybill_file")
  if (!kinds.has("freight_quote")) missing.push("freight_quote_file")
  if (!shipment.driver_name) missing.push("driver_name")
  if (!shipment.pickup_confirmed_at) missing.push("pickup_confirmed")
  return missing
}
