# Teammate onboarding (Fran POS · SKUMS · CRM)

**As of:** 2026-07-29  
**Goal:** Add people with **buttons only** (no SQL). Test uses **personal Gmail**; prod later uses **Google Workspace SSO** (Phase S).

## Mental model

| App | Tenant | Join path |
|-----|--------|-----------|
| **SKUMS** | Workspace | Settings → Team → Invite · `/invite/{token}` |
| **POS** | Company | Settings → **Team** → Invite · `/invite/{token}` · onboarding lists pending |
| **CRM** | Workspace | Settings → **Team** → Invite · `/invite/{token}` · setup lists pending |

Loyalty triangle stays **company/workspace config** (SKUMS CRM link + POS key), not per-person secrets.

## Admin steps (you)

1. **SKUMS** → Settings → Team → email + role → Send · **Copy link** if mail flaky.  
2. **POS** → Settings → **Team** (not Staff PIN) → email + manager/admin → Invite · Copy link.  
3. **CRM** → Settings → Team → email + member/admin → Invite + copy link.  
4. Share the three links (or one suite message with three URLs).

## Invitee steps

1. Open each invite link.  
2. **Continue with Google** using the **exact invited email**.  
3. **Join {company/workspace}**.  
4. POS: Sync from SKUMS if needed · Live Sale smoke.  
5. Do **not** create a second company/workspace unless founding Fran.

## Migrations (must apply once)

| App | File |
|-----|------|
| POS | `fran-pos/supabase/migrations/00014_company_invites.sql` |
| CRM | `fran-crm/supabase/migrations/0011_crm_workspace_invites.sql` |
| SKUMS | already has `workspace_invites` / `accept_invite` |

Run in Supabase SQL editor (or `scripts/_apply_*_invites.mjs` when DB URL reachable).

## Test Gmail vs Workspace SSO

- **Test:** any Gmail; copy-link primary.  
- **Prod:** Workspace domain + enforced MFA; optional domain allowlist on OAuth.

## Floor staff

POS **Staff PIN** = cashiers on tablet. **Team** = Google dashboard users. Do not mix.
