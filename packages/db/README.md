# @wedding-core/db

The typed schema reflection (`src/schema.ts`, Drizzle) plus the hand-written
SQL migration that is the actual source of truth for shape, RLS, triggers,
roles and grants (`migrations/0001_init.sql`).

## Applying the initial migration

`0001_init.sql` is written to run once, directly, against a fresh Wedding
Core Supabase project — via the Supabase SQL editor, or `psql`/any Postgres
client using the **privileged** connection string (`ADMIN_DATABASE_URL`,
never `DATABASE_URL`). It creates its own low-privilege application role
(`wedding_core_app`) as part of running, so nothing needs to pre-exist
beyond an empty Supabase Postgres database.

After running it once, set a real password for the app role:

```sql
alter role wedding_core_app with password '<generated, store as a secret>';
```

Future schema changes should go through `drizzle-kit` migrations layered on
top of this baseline, since most day-to-day changes (a new column, a new
table with the established `brand_id` + composite-FK + RLS pattern) don't
need hand-written SQL — only structural exceptions (new roles, new trigger
functions) do.

## Why this package has no runtime `pg`/connection code

`@wedding-core/db` intentionally only exports schema/types. Actually opening
a connection and enforcing brand scoping is `@wedding-core/client`'s job —
keeping the schema definition connection-agnostic means the same types can
be used by the (future) admin tool's privileged connection and by the
frontend-facing client's tenant-scoped connection without either one
importing code meant for the other.
