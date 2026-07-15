-- ============================================================
-- 060 — Operator runbook Help article for Catalog AI / MCP
-- Full how-to body so resolve_help + get_help_article answer quickly
-- ============================================================

insert into public.help_articles (
  slug, title, summary, body_md, category, primary_path, related_paths, intent_tags, sort_order
) values
(
  'operator-runbook',
  'Operator runbook (how to operate SKUMS)',
  'Day-to-day HQ + POS + Loft: who does what, waves, receive, floor ledger, inbound ASN, permissions.',
  $md$
## Overview

Fran SKUMS is the catalog, inventory ledger, and store-operations hub. POS reports; SKUMS decides and ledgers; Loft executes warehouse work; CRM owns points.

**Primary UI:** [Store Ops](/store-ops) · [Inventory](/inventory) · [Integrations](/integrations) · [Help](/help)

## Who does what

| Role | System | Can do | Must not |
|------|--------|--------|----------|
| POS cashier | Fran POS | Sell; damage/found; receive delivery + exceptions | Approve stock; send Loft; resolve HQ exceptions |
| POS manager+ | Fran POS | + request replenishment (signal to HQ) | Same restrictions |
| HQ inventory | SKUMS Store Ops | Approve/defer/reject requests; verify exceptions; apply floor adjustments; waves | Hold OFS passwords (admin) |
| 3PL admin | Integrations + Store Ops | WorldSyntech credentials; send Loft; inbound ASN | Expose secrets to POS |

## Weekly rhythm (LISE)

- **Monday + Thursday:** baseline replenishment waves
- **Any day:** store may request urgent stock → HQ inbox only (not auto-Loft)
- **Deliveries:** POS Receive delivery → good stock apply; exceptions → HQ
- **Floor:** damage / found / cycle count → HQ Floor adjustments → ledger
- **Inbound KR/HK:** ASN → Loft → LISE confirm → **LOFT-SG** (never store on_hand)

## Store Ops tabs

1. **Queue** — open requests; Lift now / Defer to wave / Reject
2. **Orders** — send to Loft when mapped (`store_ops:execute_3pl`)
3. **Inbound ASN** — pre-alert Loft; confirm promote LOFT-SG
4. **Receiving** — session history
5. **Exceptions** — Confirm / Escalate Loft / Reject POS claims
6. **Floor adjustments** — Apply to ledger or Reject (damage/found/count)

## Replenishment steps (HQ)

1. Open **Store Ops → Queue**
2. Optional recommend / MCP baseline+lift is **advice only**
3. **Approve now** (lift) · **Defer Mon/Thu** · **Reject**
4. Separate step: **Send to Loft** when products mapped + delivery mode set
5. Send does **not** increase store on_hand

## Receive (POS + HQ)

**POS:** Receive delivery (not free-form Stock receive in live mode). Enter received/damaged; flag exceptions.

**HQ:** Exceptions tab — Confirm claim, Escalate, or Reject. Scope `store_ops:verify`.

## Floor damage / found / cycle count

**POS reports** → pending only.  
**HQ Floor adjustments → Apply to ledger** writes `inventory_ledger` (`inventory:write`). Reject = no qty change.

Cycle count quantity = **physical counted on-hand** (absolute).

## Inbound ASN

1. Create draft (tracking, ETA, lines, M&P notes)
2. Send to Loft
3. Poll partial/full
4. LISE confirm → promote **LOFT-SG** only

## Stock truth

| Question | System |
|----------|--------|
| Sellable store qty | SKUMS inventory levels |
| Why it changed | inventory_ledger |
| Cashier receipt | POS outbox + SKUMS pos_sales |
| Points | Fran CRM |

## Scopes (cheat sheet)

| Task | Scope |
|------|--------|
| View store ops | store_ops:read |
| Request / receive report | store_ops:write or pos:write |
| Approve / defer wave | store_ops:approve |
| Send Loft | store_ops:execute_3pl |
| Verify exception | store_ops:verify |
| Apply floor adj | inventory:write |
| Inbound ASN | store_ops:inbound |
| Credentials | credentials:write |

## Common issues

- Request not at Loft → not approved **and** sent
- Live free-form receive does nothing → use Receive delivery
- Floor report no stock change → HQ must Apply
- ASN not on LOFT-SG → confirm not done

## Related Help

- [Store operations](/help/store-ops)
- [Approve replenishment](/help/store-ops-replenishment)
- [Receive & exceptions](/help/store-ops-receive)
- [Floor adjustments](/help/store-ops-floor-adjustments)
- [Inbound ASN](/help/store-ops-inbound)
- [Loft setup](/help/loft-worldsyntech)
- [POS vs SKUMS vs CRM](/help/pos-vs-skums)
- [Inventory truth](/help/inventory-stock)
$md$,
  'operations',
  '/store-ops',
  array['/store-ops', '/inventory', '/integrations', '/help'],
  array[
    'operator', 'runbook', 'operate', 'how we work', 'hq', 'store ops', 'loft',
    'wave', 'replenishment', 'receive', 'floor', 'ledger', 'asn', '3pl',
    'monday', 'thursday', 'permission', 'scope', 'daily', 'process'
  ],
  12
)
on conflict (slug) do update set
  title = excluded.title,
  summary = excluded.summary,
  body_md = excluded.body_md,
  category = excluded.category,
  primary_path = excluded.primary_path,
  related_paths = excluded.related_paths,
  intent_tags = excluded.intent_tags,
  sort_order = excluded.sort_order,
  published = true,
  updated_at = now();
