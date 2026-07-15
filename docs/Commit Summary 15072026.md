# Commit Summary — 15 July 2026

**Repos:** fran-skums (main) · fran-pos (master)  
**Theme:** Phase 0 ops dictionary expand · Phase E floor hygiene + inventory logging · operator runbook · Catalog AI Help tools · deploy for pilot testing

---

## fran-skums

### Phase 0 — Loft dictionary (docs)

- Expanded `docs/LOFT_OPS_DICTIONARY.md`: auth, rate guidance, provisional order/inbound status maps aligned to poll code, ASN/SOW parity, FEFO/M&P, structured Loft email draft.
- Updated `docs/LOFT_SOW_KIV.md` product locks + engineering checklist (P–D shipped; live OFS IDs still open).

### Phase E — Floor hygiene + logging

- Migration **058** `apply_inventory_adjustment` / `reject_inventory_adjustment` → `inventory_ledger` via `upsert_inventory_level`.
- APIs: `GET /api/store-ops/adjustments`, apply/reject with `inventory:write` + `recordAudit`.
- Store Ops UI: **Floor adjustments** tab.
- POS events: cycle count (`inventory.cycle_count.reported` → stocktake); intake audit.
- Store receive ledger types fixed to `transfer_received`.
- `docs/INVENTORY_AND_PURCHASE_LOGGING.md` — ledger rules + POS/SKUMS/CRM ownership for purchases/points.

### Operator documentation

- `docs/SKUMS_OPERATOR_RUNBOOK.md` — day-to-day HQ + POS + Loft.
- Migrations **059–060** Help Center: store-ops, replenishment, receive, floor, inbound, Loft setup, POS vs CRM, **operator-runbook**.
- README + cross-links from handoff / logging / Loft dictionary.

### Catalog AI / MCP Help

- `resolve_help`: store-ops scoring; body_excerpt on top matches.
- New tools: in-app `get_help_article`; MCP `help_get`.
- System prompt: always use Help for how-to/ops; Store Ops page context + suggestion chips.

### Tests / DB

- `tests/inventory-adjustments-phase-e.test.mjs`, help-resolve + remote-mcp updates.
- Local/shared Supabase: migrations **058–060** applied.

---

## fran-pos

- Floor actions: cycle count; damage/found copy = HQ approve before ledger.
- Live free-form “Receive stock” disabled; Loft path = Receive delivery; display = cache.
- Types: `inventory.cycle_count.reported`.

---

## Deploy / test notes

- Push `main` → Vercel production (fran-skums.vercel.app).
- Confirm migrations **058–060** on production Supabase if separate from shared project used locally.
- Smoke: Store Ops Floor tab; Help `/help/operator-runbook`; Catalog AI “how do I approve replenishment?”; POS floor report → pending adjustment.

---

## Still open (not this commit)

- Phase 0: send Loft email; paste live URLs / `delivery_method_id`s / official status enums.
- Phase F: store delivery calendars, multi-store allocation, POS next-wave hint.
- Phase N notifications; P.3 empty-key package; R2 OAuth held.

---

## Next

**Phase F** — delivery calendars & multi-store wave polish (`TODO-LOFT.md` PR-F.1–F.3).
