# Wedding Core

Minimal shared contract-system module for **DIMAX Wedding** and
**DKHochzeitArt** — one Supabase table, one small client. Not a frontend,
not deployed anywhere itself. DKStudioLab and Mietora are separate Supabase
projects and are not affected by anything here.

Status: implements architecture doc section M (the simplified plan that
superseded the earlier multi-table "Wedding Core" design in section L).

## What's here

```
src/
  types.ts        BrandSlug, ContentSnapshot, SignatureInput, CustomerDataInput
  schema.ts        Drizzle schema mirroring migrations/0001_init.sql
  snapshot.ts       hashSnapshot() — SHA-256 over canonicalized content_snapshot
  brand-guard.ts    assertHostMatchesBrand() — defense-in-depth host allowlist
  client.ts         WeddingClient — getContract / saveCustomerData / signContract
migrations/
  0001_init.sql     the one `contracts` table, RLS, wedding_app role
```

One table, no `brands` table (a `CHECK (brand in ('dimax','dkhochzeitart'))`
constraint does that job — see doc section M.2 for why). No versions,
signatures, or events tables: a signed contract is read-only both by
application check (`WeddingClient` throws `ContractAlreadySignedError`) and
at the database level (an RLS `UPDATE` policy whose `USING` clause only
matches `status='draft'` — once a row flips to `signed`, no further update
can succeed through the `wedding_app` role at all, regardless of what
application code does or forgets to check).

## Consuming from a frontend

Same verified mechanism as before ([npm does not support git-subdirectory
dependencies](https://github.com/npm/cli/issues/513) — tested, not assumed;
see this repo's git history for the test), just simpler now that there's
only one package: the whole repo **is** the package.

```jsonc
// dimaxwedding_projekt/package.json (once pushed to a private GitHub remote)
"dependencies": {
  "wedding-core": "git+https://github.com/<owner>/wedding-core.git#main"
}
```

```ts
// next.config.ts
const nextConfig = { transpilePackages: ["wedding-core"] };
```

```ts
import { createWeddingClient } from "wedding-core";

const weddingCore = createWeddingClient({
  brandSlug: "dimax", // fixed per deployment, see WEDDING_CORE_BRAND
  databaseUrl: process.env.WEDDING_DATABASE_URL!,
});
```

For local development before this repo has a remote, a `file:` dependency
works identically (`"wedding-core": "file:../wedding-core"`) — same
`exports`/resolution behavior, just a local path instead of a git URL.

Private-repo authentication on Vercel: see the git history of this file for
the two verified options (Vercel's direct-embed pattern vs. the recommended
`git config --global url.insteadOf` + PAT-as-env-var rewrite) — unchanged by
this simplification.

## What's done vs. what's still needed to go live

Done: schema + migration + RLS + `wedding_app` role, the three client
methods, snapshot hashing, brand-guard. Typechecks clean (`npm run
typecheck`).

Still needed:

1. Create the **Wedding Core** Supabase project (existing org, same as
   DKStudioLab/Mietora).
2. Run `migrations/0001_init.sql` once via the privileged connection, then
   set a real password for `wedding_app`.
3. Push this repo to a private GitHub remote; wire `dimaxwedding_projekt`
   and (as a follow-up) `DKHochzeitArt/Website` to depend on it.
4. Set `WEDDING_DATABASE_URL` + `WEDDING_CORE_BRAND` per frontend.
5. Draft contracts are created directly (Supabase SQL editor or a short
   script) for now — no internal creation tool was asked for or built in
   this pass (doc section M.8, step 1: "vorerst direkt in Supabase").

None of the above has been executed yet.
