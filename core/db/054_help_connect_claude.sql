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

## Steps (employee — Claude personal / custom connector)

Claude’s custom connector form often only has:

- **Name**
- **Remote MCP server URL**
- **OAuth Client ID / Secret (optional)**

There is **no Bearer field**. Leave OAuth **empty**. Put the API key **in the URL**:

1. SKUMS **Settings → API keys → Create Claude / MCP key** → copy `sk_live_…`
2. Claude → **Settings → Connectors → Add custom connector**
3. **Name:** `Fran SKUMS`
4. **URL (pick one):**
   - Query form: `https://fran-skums.vercel.app/mcp?api_key=sk_live_YOUR_KEY`
   - Path form: `https://fran-skums.vercel.app/mcp/c/sk_live_YOUR_KEY`
5. **OAuth Client ID:** leave blank  
6. **OAuth Client Secret:** leave blank  
7. Save / enable → ask: “How many products are in the catalog?”

**Security:** the key is in the URL (Claude may store it). Treat it like a password; rotate if shared. Prefer a dedicated “Claude MCP” key you can revoke.

**If “Couldn’t reach Fran SKUMS”:**
- Open the same URL in a browser — you should see JSON `name: fran-skums`
- Confirm the key is complete (no spaces/newlines)
- Wait 1–2 minutes after a deploy and retry

**Claude Code (CLI) alternative** (header auth, better):

```bash
claude mcp add fran-skums --transport http --header "Authorization: Bearer sk_live_…" https://fran-skums.vercel.app/mcp
```

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
