# Fran’s With Benefits — architecture diagrams

**Status:** Track **L** in `TODO.md` — L-pos / L-skums slice 1 started (2026-07-23); L-base CRM next  
**Date:** 2026-07-17 (arch) · updated 2026-07-23  
**Sources:** `docs/loyaltys.pdf` (FWB mechanics), `docs/HEADLESS_LOYALTY_PROJECT_BRIEF.md`, genesis ownership  

Principles:

1. **Base FWB** = constitution (tiers, expiry, redeem denoms) — rare change.  
2. **Campaigns** = time-boxed overlays — marketer + LLM frequent.  
3. **Agents propose; simulation mandatory; publish gated; runtime never loads red/unsimulated rules.**  
4. **CRM (or headless-loyalty) owns ledger; POS owns checkout UX; SKUMS owns product/sale facts.**

---

## 1. System ownership (who owns what)

```mermaid
flowchart TB
  subgraph Marketers
    M[Marketer ideas]
    LLM[LLM + MCP]
  end

  subgraph CRM["fran-crm — loyalty brain"]
    POL[Base policy FWB]
    CAMP[Campaigns + rule kinds]
    SIM[Implication simulator]
    LED[Point batches + ledger]
    VCH[Vouchers / QR]
    MEM[Member · tier · YTD spend]
  end

  subgraph POS["fran-pos — checkout"]
    CART[Cart + member ID]
    SCAN[Scan voucher QR]
    PRE[Preview earn / redeem]
    PAY[Pay + commit sale]
  end

  subgraph SKUMS["fran-skums — commerce truth"]
    CAT[Catalog · collections · categories]
    SALE[Sale / return ingest]
    INV[Inventory ATS]
    META[Product eligibility metadata]
  end

  M --> LLM
  LLM -->|draft · simulate · propose| CAMP
  CAMP --> SIM
  SIM -->|green/yellow/red report| LLM
  SIM -->|publish only if gate OK| CAMP

  POL --> LED
  CAMP --> LED
  MEM --> LED
  LED --> VCH

  CART --> PRE
  PRE <-->|API| MEM
  PRE <-->|API| CAMP
  SCAN --> VCH
  PAY -->|sale facts + member_ref| SALE
  PAY -->|commit_sale same sale_id| LED

  CAT -->|collection membership| CAMP
  SALE --> INV
  META --> CAMP
```

**Not in SKUMS:** points balance SoR, tier jobs, campaign authoring, QR issue.

---

## 2. Agentic campaign airlock (no blind load)

```mermaid
sequenceDiagram
  participant Mk as Marketer
  participant LLM as LLM + MCP
  participant Gate as Policy gate
  participant Sim as Simulator
  participant DB as Campaign store
  participant RT as Runtime evaluator
  participant POS as fran-pos

  Mk->>LLM: Creative idea (NL)
  LLM->>Gate: loyalty_draft_campaign (closed schema)
  Gate-->>LLM: valid | unsupported_kind

  LLM->>Sim: loyalty_simulate_campaign
  Sim->>Sim: Base FWB + live campaigns + proposal
  Sim->>Sim: Fixtures · liability · stack · DB cost
  Sim-->>LLM: Implications report green/yellow/red

  alt red
    LLM-->>Mk: Blocked — narrow rule
  else yellow / green
    LLM->>DB: loyalty_propose_campaign + simulation_id
    Note over DB: status=pending · never live yet
    Mk->>Gate: Human approve (or admin MCP publish)
    Gate->>DB: publish only if sim passed
    DB-->>RT: live versioned campaign
  end

  POS->>RT: preview_earn / authorize redeem
  RT->>RT: load only live · in-window · not killed · sim≠red
  RT-->>POS: applied campaign_ids + pts + copy
  POS->>RT: commit_sale (idempotent)
  RT->>DB: ledger + decision log
```

---

## 3. Decision layers (constitution vs campaigns)

```mermaid
flowchart LR
  subgraph Constitution["L-base — rare / eng+ops"]
    T[Tiers F1 F2 F3]
    E[Point batches + theoretical expiry]
    R[Redeem denoms 200…2500]
    C[Check-in milestone table]
  end

  subgraph Campaigns["L-campaigns — frequent / marketer+LLM"]
    K1[earn_multiplier]
    K2[earn_flat_bonus]
    K3[catalog_scope_earn]
    K4[redeem_limit]
    K5[redeem_eligibility]
    K6[gift_with_purchase]
    K7[voucher_issue]
    K8[message_only]
  end

  Constitution --> Eval[Evaluator]
  Campaigns --> Eval
  Eval --> Out[Earn · redeem auth · POS copy]
```

New creative idea → **new parameters on a kind**, or **new kind (eng)**, never free-form code in DB.

---

## 4. Earn evaluation (stacking)

```mermaid
flowchart TD
  Cart[Cart lines + net spend] --> Scope[Match catalog scopes via SKUMS collections]
  Scope --> Base[Base tier rate 1.00 / 1.25 / 1.50]
  Scope --> Camp[Sum matching campaign earn_add]
  Scope --> Vouch[Birthday / category voucher additives if scanned]
  Base --> Sum[Total multiplier]
  Camp --> Sum
  Vouch --> Sum
  Sum --> Cap{Global max rate cap?}
  Cap -->|yes clamp| Floor[floor spend_portion × rate]
  Cap -->|no| Floor
  Floor --> Batch[Credit point batch<br/>earn_date · quarter · theoretical_expiry]
  Batch --> Log[Runtime decision log<br/>campaign_ids[]]
```

PDF-aligned: birthday and category each contribute **+1.00** when active; campaigns add within stack rules and hard caps.

---

## 5. Implication report (three axes)

```mermaid
flowchart TB
  Prop[Campaign proposal JSON] --> Sim[Simulator]

  Sim --> A[Accounting]
  Sim --> J[Customer journey]
  Sim --> S[Systems / DB]

  A --> A1[Liability estimate]
  A --> A2[Stack with live campaigns]
  A --> A3[Expiry / tier freeze OK?]
  A --> A4[Redeem table intact?]
  A --> A5[Budget / once caps present?]

  J --> J1[POS one-line explanation?]
  J --> J2[Surprise earn / silent exclude]
  J --> J3[Channel mismatch POS vs app]
  J --> J4[Tier fairness skew]

  S --> S1[Collection ref vs huge id list]
  S --> S2[Eval cost / cart preview latency]
  S --> S3[Ledger volume / counters]
  S --> S4[Unsupported graph fan-out]

  A1 --> Sev{Severity}
  A2 --> Sev
  A3 --> Sev
  A4 --> Sev
  A5 --> Sev
  J1 --> Sev
  J2 --> Sev
  J3 --> Sev
  J4 --> Sev
  S1 --> Sev
  S2 --> Sev
  S3 --> Sev
  S4 --> Sev

  Sev -->|all green| G[Publish allowed]
  Sev -->|any yellow| Y[Human ack required]
  Sev -->|any red| R[Cannot publish]
```

---

## 6. Logging (three append-only streams)

```mermaid
flowchart LR
  subgraph Authoring
    P1[draft] --> P2[simulate] --> P3[propose] --> P4[publish / kill]
    P1 --> AL[Authoring audit]
    P2 --> AL
    P3 --> AL
    P4 --> AL
  end

  subgraph Checkout
    PRE[preview] --> DL[Decision log]
    AUTH[authorize redeem] --> DL
    COM[commit_sale] --> DL
    DL --> LED[Ledger entries + batches]
  end

  AL -.->|who · prompt_hash · simulation_id| Audit
  DL -.->|member · sale_id · campaign_versions| Audit
  LED -.->|source_campaign_id · batch expiry| Audit
```

**Debug path:** “Why 875 pts?” → decision log → campaign versions + base tier → batches.

---

## 7. Catalog targeting (marketer collections)

```mermaid
flowchart LR
  Mk[Marketer] --> Coll[SKUMS collection<br/>promo-11-11-2026]
  Coll --> Products[Product ids 1…99]
  Rule[CRM campaign<br/>catalog_scope.collection_id] --> Coll
  Cart[POS line product_id] --> Match{In collection?}
  Coll --> Match
  Match -->|yes| Apply[Apply earn / redeem rule]
  Match -->|no| Skip[Skip rule]
```

Prefer **collection id** over dumping thousands of product ids into the campaign row.

---

## 8. Runtime load filter (never blind)

```mermaid
flowchart TD
  Start[Load campaigns for channel + now] --> F1{status = live?}
  F1 -->|no| Drop
  F1 -->|yes| F2{now in window?}
  F2 -->|no| Drop
  F2 -->|yes| F3{killed?}
  F3 -->|yes| Drop
  F3 -->|no| F4{published_version set?}
  F4 -->|no| Drop
  F4 -->|yes| F5{last sim severity ≠ red?}
  F5 -->|no| Drop
  F5 -->|yes| F6{circuit breakers OK?}
  F6 -->|no| Drop
  F6 -->|yes| Active[Active set for evaluator]
  Drop[Exclude]
```

---

## 9. Point batch lifecycle (PDF expiry × campaigns)

```mermaid
stateDiagram-v2
  [*] --> Credited: earn / campaign / check-in
  Credited --> Frozen: member holds F2 or F3
  Credited --> Active: member is F1
  Frozen --> Active: Jan 1 drop to F1 only
  Active --> Expired: theoretical_expiry passed\n(quarter-end schedule)
  Frozen --> Expired: never while F2/F3\n(theoretical date still stored)
  Credited --> PartiallyRedeemed: FIFO / soonest expiry
  PartiallyRedeemed --> Expired
  PartiallyRedeemed --> Frozen
```

Campaigns **create** batches with the same tagging rules; they must **not** rewrite theoretical_expiry.

---

## 10. MCP tool surface (loyalty)

```mermaid
flowchart TB
  subgraph Read
    R1[loyalty_list_rule_kinds]
    R2[loyalty_list_campaigns]
    R3[loyalty_get_implications]
  end

  subgraph Write_safe
    W1[loyalty_draft_campaign]
    W2[loyalty_simulate_campaign]
    W3[loyalty_propose_campaign]
  end

  subgraph Write_gated
    P1[loyalty_publish_campaign]
    P2[loyalty_kill_campaign]
  end

  R1 --> W1 --> W2 --> W3 --> P1
  W2 --> R3
  P2 --> Runtime[Runtime stops loading]
```

| Scope | Tools |
|-------|--------|
| `loyalty:read` | list / get implications |
| `loyalty:draft` | draft |
| `loyalty:simulate` | simulate |
| `loyalty:propose` | propose pending |
| `loyalty:publish` | publish (admin / human; not default cloud agent) |
| `loyalty:kill` | emergency off |

---

## 11. End-to-end happy path (one diagram)

```mermaid
sequenceDiagram
  participant App as Member app
  participant CRM as fran-crm loyalty
  participant POS as fran-pos
  participant SK as fran-skums

  App->>CRM: sign-up → F1 + 50 pts batch
  Note over CRM: Marketer published 11/11 2× via airlock

  POS->>CRM: identify member
  POS->>CRM: preview_earn(cart)
  CRM->>SK: resolve collection membership
  CRM-->>POS: earn preview + “2× 11/11 serums”

  App->>CRM: redeem 500 pts → QR voucher
  POS->>CRM: authorize QR
  CRM-->>POS: $20 off line

  POS->>SK: POST sale (facts, member_ref, voucher_ids)
  POS->>CRM: commit_sale(same sale_id)
  CRM->>CRM: debit batches · credit earn batch · YTD · maybe tier-up
  CRM->>CRM: decision log + ledger
```

---

## 12. Track L slice map (for later TODO)

```mermaid
gantt
  title Track L — suggested order (relative)
  dateFormat X
  axisFormat %s

  section Base
  L-base FWB ledger + PDF golden tests     :a1, 0, 3
  section Campaigns
  L-kinds closed rule kinds + evaluator    :a2, 2, 3
  L-sim implications + fixtures            :a3, 4, 3
  L-mcp draft/sim/propose · publish gated  :a4, 6, 2
  L-admin UI kill audit                    :a5, 7, 2
  section Channels
  L-pos preview commit                     :a6, 5, 3
  L-skums collections + sale contract      :a7, 3, 3
```

---

## Related files

| File | Role |
|------|------|
| `docs/loyaltys.pdf` | FWB business rules |
| `docs/HEADLESS_LOYALTY_PROJECT_BRIEF.md` | Optional separate loyalty service |
| `genesis.md` | Ownership boundaries |
| `fran-pos/LOYALTY_POLICY_EXECUTION_PLAN.md` | POS policy evaluator notes |
