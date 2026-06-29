# Migration Workflow

## Do 041 And 042 Need Manual Application?

They are committed SQL files, not automatically applied by GitHub. A database
must still receive the migrations before the new attention-item and channel
intelligence APIs can run against it.

Preferred path for the current repo:

```sh
npm run db:migrate:status
npm run db:migrate -- --only 040
npm run db:migrate -- --only 041
npm run db:migrate -- --only 042
```

Run `040` only if the target database has not already applied
`pos_inventory_events.sql`. Then apply `041` before `042`.

Required environment:

```sh
SUPABASE_DB_URL=postgresql://...
```

Alternative Supabase path:

```sh
supabase link --project-ref <project-ref>
supabase db push
```

That path uses `supabase/migrations/`, where the new migrations are mirrored.
Use either the repo runner or Supabase CLI for a given target database. Avoid
mixing both on the same target unless you are deliberately reconciling migration
history.

## New Migration Location

New migrations should be added in both places for now:

- `core/db/NNN_name.sql` for the existing repo runner.
- `supabase/migrations/YYYYMMDDNNN_name.sql` for Supabase CLI compatibility.

Keep the SQL contents aligned between the two copies until the repo standardizes
on a single migration runner.
