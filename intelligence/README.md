# Intelligence layer (Fran)

Judgment helpers for marketplace study + pipeline. **Facts** stay in `marketplace/` warehouse; this package proposes and executes promotions.

## Modules

| Path | Role |
|------|------|
| `grok/contracts.mjs` | Grounded JSON normalize + offline study brief |
| `grok/client.mjs` | xAI chat completions for brief + match rerank |
| `match/catalogMatch.mjs` | Rule-based product title/token match |
| `pipeline/execute.mjs` | Payload builders + status guards for execute |

## Phase 3 flows

```text
POST /api/v1/study/sessions
POST /api/v1/study/sessions/:id/brief      # Grok or offline
POST /api/v1/study/sessions/:id/match      # rule + optional Grok
POST /api/v1/study/sessions/:id/propose    # watchlist + catalog candidates
POST /api/v1/pipeline/candidates/:id/decide
POST /api/v1/pipeline/candidates/:id/execute
```

Execute kinds implemented: `watchlist_seed`, `catalog_product`.

Set `XAI_API_KEY` for live Grok; without it, offline grounded briefs still work.
