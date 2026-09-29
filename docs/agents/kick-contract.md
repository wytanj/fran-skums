# Kick contract for fran-skums

This file says what a kicked Claude Code session owes the outer loop (Grok Bot) when it finishes.
It is a draft. Amend it by PR.

## Scope classes

The classes come from `agent-home/operating-model.md`. That file wins if the two disagree.

| Class | Meaning | Who acts |
|---|---|---|
| A | Local work and the dev database: code, tests, docs, drafts, the session's own worktree and branch | The kicked session |
| B | Production, read-only: health checks, status reads, `db:migrate:status`, dry runs | Outer loop |
| C | Production, reversible: merge a green PR into `main`, then `vercel --prod` | Outer loop, logged on the PR |
| D | Production, irreversible or touching money, customers, or secrets: migrations (`npm run db:migrate`), data fixes, customer messages | Outer loop runs the dry run, then waits for JT's yes in his own words |

A kicked session does class A only. It stages B, C, and D commands in its report and never runs them. It never merges, deploys, applies a migration to a shared database, or force-pushes.

## Worktree rules

A session works only in the worktree it was kicked into. It does not create another worktree. It does not touch the owner's main checkout at `C:\Users\Jeremy Tan\CodeProjects\fran-skums`.

The session pushes only the branch it was kicked on, and the PR targets `main`.

## Source-of-truth locks

These locks hold for every kick. A session does not rebuild what they rule out.

- `inventory_ledger` is the quantity source of truth. Stock changes go through `upsert_inventory_level` from an approved flow: PO receive RPC, Loft receive-delivery, floor adjustment apply, store-ops replenishment. The app never writes `inventory_levels` directly. See `docs/INVENTORY_AND_PURCHASE_LOGGING.md`.
- SKUMS owns lots and expiry data. POS and store staff report. SKUMS approves, then the ledger applies.
- Fran HRM owns staff and shifts. Fran CRM owns members, loyalty, and points. See `docs/HRM_ROSTER.md` and `docs/fran-skums-contract.md`.
- Hanshow ESL lives in this repo.

## What the session returns

Report these, verdict first, in plain bullets.

- The draft PR URL, as `https://github.com/wytanj/fran-skums/pull/<number>`. When `gh` is not authenticated, push the branch and return the GitHub compare URL instead, so JT can open the draft.
- Files touched, as a list of paths with one clause each on what changed.
- Verify notes. Name the surface each check ran on and what it proved. `nuxt build` passing is a compile check, not a UI check.
- What was staged rather than done, with its class and the exact command.
- Anything that blocked, and what unblocks it.

## Briefs

A kick may carry a brief at `docs/agents/briefs/<slug>.md`. When the PR finishes that item, the same PR deletes the brief. A PR that only advances the item updates the brief and leaves it in place.

## Done webhook

When `%USERPROFILE%\.config\agent-loop\done-webhook.env` is present, the session POSTs to `DONE_WEBHOOK_URL` on finish with `Authorization: Bearer $DONE_WEBHOOK_KEY` and `X-Automation-Key: $DONE_WEBHOOK_KEY`.

```json
{
  "event": "session_done",
  "repo": "fran-skums",
  "slug": "<short-slug>",
  "session": "claude-<short-slug>",
  "status": "ok",
  "summary": "one or two sentences",
  "pr_url": "https://github.com/wytanj/fran-skums/pull/<number>",
  "class_c_ready": false
}
```

Set `class_c_ready` to `true` only when the PR is ready for the class C merge and deploy. The key never appears in chat, logs, or a commit.

When the env file is absent, the session says so in its reply and posts nothing.
