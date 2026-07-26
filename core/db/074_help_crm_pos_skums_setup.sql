-- ============================================================
-- 074 — Help: Setup CRM + POS + SKUMS (loyalty live path)
--
-- In-app /help + Catalog AI resolve_help + MCP help_get.
-- Agent-readable setup for test workspace live demo and production later.
--
-- As of: 2026-07-24
-- Design: docs/POS_CRM_SKUMS_CONNECTION_ARCHITECTURE.md
-- Run AFTER: 072, 073
-- ============================================================

insert into public.help_articles (
  slug, title, summary, body_md, category, primary_path, related_paths, intent_tags, sort_order
) values
(
  'crm-pos-skums-setup',
  'Setup: CRM + POS + SKUMS (loyalty live path)',
  'How to connect Fran POS and Fran CRM through a SKUMS workspace key. As of 2026-07-24. Prefer this for POS/CRM setup, live demo, or loyalty not linked.',
  $md$
## As of

**2026-07-24** — production architecture for Catalog AI / MCP.  
Engineering detail: `docs/POS_CRM_SKUMS_CONNECTION_ARCHITECTURE.md`.  
POS operator smoke: `fran-pos/docs/CRM_POS_LIVE_TEST.md`.

When answering setup questions, **prefer this article** over inventing dual CRM+SKUMS keys on the register.

---

## AGENT RULES (read first)

1. **POS production holds only a SKUMS workspace API key** (`pos:read` + `pos:write`). It does **not** store CRM service secrets.
2. **CRM is linked on the SKUMS workspace** (HQ Integrations → Fran CRM, or env `FRAN_CRM_BASE_URL`). Loyalty path:  
   `POS → SKUMS /fran/pos/loyalty/* → Fran CRM`.
3. **SKUMS does not depend on POS or CRM** to run catalog/inventory/store-ops. Loyalty is optional; missing link → `loyalty_not_configured` / `ready_for_member_loyalty: false`.
4. **Ownership**
   - **POS** = checkout UX, payment, local receipt/outbox  
   - **SKUMS** = catalog, price quote, stock/sale facts, store-ops, API keys, CRM link  
   - **CRM** = members, tiers, points ledger, FWB policy, vouchers, `commit_sale`
5. **Demo login ≠ live architecture.** Demo POS may use mock members without SKUMS. Live demo for a test workspace uses Live login + SKUMS key + CRM link.
6. **Never tell operators** to put Supabase service role or CRM DB credentials in the browser / `VITE_*`.
7. **Member path** needs `GET /fran/pos/capabilities` → `ready_for_member_loyalty: true`. Non-member/tourist can sell with SKUMS only.
8. Cite deep links: `/integrations` (HQ CRM link), POS Settings → Integrations (SKUMS connector), `/help/crm-pos-skums-setup`.

---

## Architecture (one diagram)

```text
POS register                 SKUMS workspace                    Fran CRM
────────────                 ───────────────                    ────────
pos API key  ──────────────► catalog · quote · sale
same key     ──────────────► /fran/pos/loyalty/*  ──server──►  policy · member · commit_sale
                             workspace_crm_links
                               (base URL + optional token)
```

**Test workspace first, production Fran workspace later** — same flow, new keys + new CRM link. Do not reuse test keys in prod.

---

## Setup A — Live demo (test workspace) [recommended first]

### A1. Fran CRM running

- Deployed example: `https://fran-crm-eight.vercel.app`  
- Or local: `npm run dev` in fran-crm → `http://localhost:3000`  
- Demo member for smoke: **FRAN-0001** (aliases FRAN1001) · phone **81234470** → F3 · high points balance

### A2. SKUMS — link CRM on the **test** workspace

**Option HQ UI (M4):**

1. Open SKUMS → workspace = **test** (not eventual prod Fran if still separate).  
2. **Integrations** → card **Fran CRM (POS loyalty)**.  
3. CRM base URL = CRM origin (no trailing slash).  
4. CRM workspace ID = demo `11111111-1111-4111-8111-111111111111` (or real CRM test workspace).  
5. Auth mode = `none` for demo POS routes.  
6. **Save CRM link** → **Test policy** (should return policyVersionId).

**Option env (single-tenant / Vercel):**

```text
FRAN_CRM_BASE_URL=https://fran-crm-eight.vercel.app
FRAN_CRM_WORKSPACE_ID=11111111-1111-4111-8111-111111111111
```

Redeploy SKUMS after env change. UI may show link source **(env)**.

**Option API (service key):**

```text
PUT /api/v1/workspace/crm-link
Authorization: Bearer sk_live_…
{ "crm_base_url": "https://fran-crm-eight.vercel.app",
  "crm_workspace_id": "11111111-1111-4111-8111-111111111111",
  "auth_mode": "none" }
```

Requires mig **073** (`workspace_crm_links`) on the DB.

### A3. SKUMS — POS API key

Create key with **`pos:read`** and **`pos:write`** (pos_connector-style).  
Note the raw key once; bind/scopes per workspace policy.

### A4. Smoke from SKUMS key (before POS)

```text
GET /fran/pos/capabilities
Authorization: Bearer sk_live_…

→ skums.ok: true
→ loyalty.ok: true
→ ready_for_member_loyalty: true
→ architecture: skums_facade
```

If `loyalty.ok: false` → CRM not linked or CRM unreachable from SKUMS server.

### A5. POS register

1. Login **Live** (not Demo).  
2. **Settings → Integrations → SKUMS Connector**  
   - API URL = SKUMS origin (e.g. `https://fran-skums.vercel.app`)  
   - Account key = test workspace key  
   - Enable + Save + Test connection  
3. Leave **Advanced / dev: direct CRM URL** unused for this path.  
4. Hard-refresh **Sale**.

### A6. Cashier smoke

1. Banner: green **SKUMS + loyalty linked**.  
2. Find member → **FRAN-0001** → Ava Tan, F3, points.  
3. Add products → earn preview uses CRM policy via facade.  
4. Pay → Network: loyalty calls go to **SKUMS** `/fran/pos/loyalty/*`, not directly to CRM host.  
5. Commerce sale also uses SKUMS when live.

---

## Setup B — Demo POS only (training, no network)

1. POS login **Demo**.  
2. No SKUMS key required.  
3. Mock members (e.g. Mei Lin FRAN1001).  
4. No real CRM ledger, no SKUMS sale sync.

Use for UI training only — **not** a live loyalty proof.

---

## Setup C — Live commerce without loyalty yet

1. Live POS + SKUMS key.  
2. CRM **not** linked → `ready_for_member_loyalty: false`.  
3. Catalog/sale OK.  
4. **Find member** blocked with message to link CRM on SKUMS HQ.  
5. Non-member / tourist checkout still allowed.

---

## Setup D — Production Fran workspace (later)

Same as A, but:

1. **New** SKUMS workspace (or promote carefully).  
2. **New** pos keys (never reuse test keys).  
3. CRM link to **production** CRM URL + real CRM workspace id.  
4. Real members/policy when demo graph is retired.  
5. Re-point each register’s SKUMS connector.  
6. Revoke test keys.

---

## Endpoints agents may mention

| Purpose | Method + path | Auth |
|---------|---------------|------|
| Capabilities | `GET /fran/pos/capabilities` | POS API key |
| Member resolve | `POST /fran/pos/loyalty/member/resolve` | POS API key |
| Counter session | `POST /fran/pos/loyalty/counter-session` | POS API key |
| Active policy | `GET /fran/pos/loyalty/policy/active` | POS API key |
| Commit sale | `POST /fran/pos/loyalty/commit-sale` | POS API key `pos:write` |
| HQ read link | `GET /api/integrations/fran-crm/link?workspace_id=` | SKUMS session |
| HQ save link | `PUT /api/integrations/fran-crm/link` | SKUMS owner/admin session |
| HQ test | `POST /api/integrations/fran-crm/test` | SKUMS session |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Loyalty not linked banner | Save CRM link on SKUMS Integrations or set `FRAN_CRM_BASE_URL` |
| Find member blocked | Same; or use non-member until linked |
| Capabilities 401 | Wrong/missing POS key or scopes |
| CRM test fails | CRM down; wrong base URL; SKUMS server cannot reach CRM (localhost from Vercel won’t work) |
| Still mock Mei Lin | SKUMS connector not enabled on POS, or Demo login without SKUMS |
| table workspace_crm_links missing | Run migration **073** on that database |
| Dual CRM URL on POS | Advanced/dev only — production should be SKUMS-only |

---

## Related Help

- [POS vs SKUMS vs CRM](/help/pos-vs-skums)  
- [Operator runbook](/help/operator-runbook)  
- [Inventory stock truth](/help/inventory-stock)  
- [PO and stock movement statuses](/help/po-transfer-lifecycle)  
$md$,
  'operations',
  '/integrations',
  array[
    '/integrations',
    '/settings',
    '/help/pos-vs-skums',
    '/help/operator-runbook',
    '/help/po-transfer-lifecycle'
  ],
  array[
    'crm', 'pos', 'skums', 'setup', 'connect', 'loyalty', 'fwb', 'fran crm',
    'workspace key', 'api key', 'pos connector', 'live demo', 'test workspace',
    'commit_sale', 'capabilities', 'fran-pos', 'member lookup', 'FRAN-0001',
    'workspace_crm_links', 'loyalty facade', 'how to connect pos', 'loyalty not linked'
  ],
  54
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

-- Cross-link from related articles (append related_paths / soft pointer in summary only via re-seed optional)
-- Keep operator-runbook / pos-vs-skums as-is; agents resolve via tags + this slug.
