# Fran SKUMS MCP Server

stdio MCP server for agents (Cursor, Claude, Grok, etc.) to:

- **Study** new products (brief via Grok, catalog match, pipeline propose)
- **BI** watch Shopee warehouse data (seeds, snapshots, export tables)
- **Pipeline** decide/execute watchlist seeds and catalog drafts

Does **not** scrape Shopee itself for every tool call — it reads/writes the Supabase warehouse. Use `bi_run_seed_now` + the collect worker for new pulls.

## Setup

1. Repo `.env` must include:

```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
XAI_API_KEY=...                  # live Grok briefs / projection commentary
FRAN_MCP_WORKSPACE_ID=<uuid>     # your Fran workspace
# optional:
# FRAN_MCP_SCOPES=intel:read,study:write,pipeline:propose,pipeline:decide,pipeline:execute,po:draft,po:submit,po:decide,projection:run
```

### How to get `FRAN_MCP_WORKSPACE_ID`

It is the **UUID of a row in `public.workspaces`**. You do not invent a random UUID.

**Recommended (app):**

1. `npm run dev`
2. Sign up / log in
3. Complete **onboarding** (creates a workspace via `create_workspace` RPC)
4. Run:

```bash
node scripts/print-workspace-id.mjs
```

5. Copy into `.env`:

```env
FRAN_MCP_WORKSPACE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

If the script prints **no workspaces**, you have not created one yet — finish onboarding first.  
Service role alone cannot create a normal workspace without a real user `profiles` row (`owner_id` is required).

2. Run from monorepo root:

```bash
npm run mcp
# or
node mcp/src/index.mjs
```

## Cursor / Claude Desktop config example

```json
{
  "mcpServers": {
    "fran-skums": {
      "command": "node",
      "args": ["C:/Users/Jeremy Tan/CodeProjects/fran-skums/mcp/src/index.mjs"],
      "env": {
        "FRAN_MCP_WORKSPACE_ID": "your-workspace-uuid"
      }
    }
  }
}
```

Env vars can also come from the shell that launches the MCP process; the server loads repo `.env` automatically.

## Tools (Phase 4)

### Study
| Tool | Scope |
|------|--------|
| `study_start` | study:write |
| `study_get` / `study_list` | intel:read |
| `study_brief` | study:write |
| `study_match_catalog` | study:write |
| `study_propose` | pipeline:propose |
| `market_search` / `market_seller_mix` / `market_listing_history` | intel:read |

### Pipeline
| Tool | Scope |
|------|--------|
| `pipeline_propose` | pipeline:propose |
| `pipeline_list` | intel:read |
| `pipeline_decide` | pipeline:decide |
| `pipeline_execute` | pipeline:execute |

### BI
| Tool | Scope |
|------|--------|
| `bi_list_seeds` / `bi_job_status` / `bi_query_snapshots` / `bi_export_table` / `bi_list_metrics` / `bi_latest_digest` | intel:read |
| `bi_upsert_seed` / `bi_set_cadence` / `bi_run_seed_now` | intel:write |

Empty `FRAN_MCP_SCOPES` = all scopes allowed.

## Typical agent flow

```text
study_start → study_brief → study_match_catalog
  → study_propose → pipeline_decide(accepted) → pipeline_execute
bi_export_table(search_query) for sheets
```

### Internal POs + projections (Phase 5)

| Tool | Scope |
|------|--------|
| `po_create_draft` / `po_update_draft` / `po_add_lines` | po:draft |
| `po_submit` | po:submit |
| `po_decide` | po:decide |
| `po_get` / `po_list` / `po_export` / `po_suggest_qty` | intel:read (suggest) / draft scopes for writes |
| `projection_create` / `projection_from_po` / `projection_from_study` | projection:run |
| `projection_get` / `projection_list` / `projection_export` | intel:read |

## Not in MCP yet

- Reconciliation packs (Phase 6)
- Browser collect inside MCP (use worker `process-jobs`)
