-- ============================================================
-- Help article: connect Claude / remote MCP (Phase R1)
-- Idempotent upsert by slug
-- ============================================================

insert into public.help_articles (
  slug, title, summary, body_md, category, primary_path, related_paths, intent_tags, sort_order
) values
(
  'connect-claude',
  'Connect Claude (remote MCP)',
  'Point Claude or another AI at Fran SKUMS over HTTPS — no local Node install.',
  $md$
## Overview

**Remote MCP** lets non-technical staff use Claude (or similar) with your workspace catalog and draft tools.

- **URL:** `https://<your-app>/mcp` (production: https://fran-skums.vercel.app/mcp)
- **Auth:** workspace API key (`Authorization: Bearer sk_live_…`)
- **Profile:** cloud-safe — catalog Q&A, help, draft POs / pipeline propose. **No** submit, approve, or pipeline execute.

## Steps (admin)

1. Open **Settings → API keys**.
2. Click **Create Claude / MCP key**.
3. Copy the key once (it is not shown again).
4. Share the MCP URL + key with staff securely (password manager).

## Steps (employee — Claude)

1. In Claude, open **Settings → Integrations / Custom MCP** (wording varies by plan).
2. Add custom integration:
   - **URL:** `https://fran-skums.vercel.app/mcp`
   - **Auth / header:** Bearer token = your `sk_live_…` key
3. Save. Ask: “How many products are in the catalog?” or “Where do I edit products?”

## What the agent can do

| OK | Not OK (use SKUMS UI) |
|----|------------------------|
| catalog_stats / search / get | po_submit / po_decide |
| help_resolve → /help links | pipeline_execute |
| draft POs, clone as draft | Activate for POS (product page) |
| study / propose (if scoped) | Live scrape |

Drafts appear under **Actions** for human approve.

## Local engineers

Developers can still run `npm run mcp` (stdio) with `.env` — separate from cloud.

## Related

- [MCP vs Catalog AI](/help/mcp-vs-catalog-ai)
- [Actions inbox](/help/actions-inbox)
- [Edit products](/help/edit-products)
$md$,
  'ai',
  '/settings',
  array['/mcp', '/help', '/actions'],
  array['claude', 'mcp', 'remote', 'connect', 'integration', 'cloud', 'cursor', 'connector', 'api key'],
  155
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
