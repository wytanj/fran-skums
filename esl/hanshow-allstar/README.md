# Hanshow All-Star ESL (WIP)

Store electronic shelf labels via Hanshow All-Star Cloud.

**Spec in hand:** `docs/hanshow.pdf` — HS-ALLSTAR-V220005 Login + Article query + ESL bind/flash.

**Blocked**

- Article create/update (price push) is not in that PDF
- API `client_id` / `client_secret` must be issued by Hanshow (not the Test2 web login)
- Physical tags only refresh when a store Hanshow AP (or USB gateway) is online

SKUMS talks HTTPS to All-Star Cloud. The AP is the 2.4 GHz last mile. See Track **HS** in `TODO.md`.
