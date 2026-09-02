# Wedding Core

Shared multi-tenant backend for **DIMAX Wedding** and **DKHochzeitArt** —
schema, tenant/brand isolation, RLS, and (later) shared contract-signing/PDF
logic. Not a frontend, not deployed anywhere itself. DKStudioLab and Mietora
are separate Supabase projects and are not affected by anything here.

Status: **Phase 0 / Fundament — infrastructure only, no visible contract UI.**

## Structure

```
packages/
  db/              schema + the source-of-truth SQL migration (RLS, roles, triggers)
  contract-core/   framework-agnostic domain logic (snapshot hashing, contract
                   numbers, brand resolution) — no database connection
  client/          the thin, brand-bound data-access client — the ONLY
                   package a frontend installs at runtime
```

Full reasoning for this split, the tenant-isolation model, and the finalized
security rules live in the architecture document (sections C and L).

## Why three packages instead of one

A frontend (dimaxwedding_projekt, DKHochzeitArt/Website) should never carry
a hard runtime dependency on the *whole* Wedding Core repo — migrations,
the SQL source, and (later) the internal admin tool's privileged-connection
code have no business being resolvable from either public-facing app.

`@wedding-core/client` is the only package meant to be installed by a
frontend. It depends on `@wedding-core/db` (types only, no live connection
logic) and `@wedding-core/contract-core` (pure functions, no I/O) —
consuming those is still two/three scoped package installs, not "install
the entire monorepo."

## Consuming from a frontend (once this repo has a remote)

No package registry is used — that would be exactly the kind of paid extra
dependency this project is trying to avoid. Each frontend installs the
packages it needs directly from this repo's Git history, scoped to just
that package's subdirectory:

```jsonc
// dimaxwedding_projekt/package.json (illustrative — repo has no remote yet)
"dependencies": {
  "@wedding-core/contract-core": "github:<owner>/wedding-core#main:packages/contract-core",
  "@wedding-core/db":            "github:<owner>/wedding-core#main:packages/db",
  "@wedding-core/client":        "github:<owner>/wedding-core#main:packages/client"
}
```

Each package ships raw TypeScript (`main`/`types` point straight at
`src/index.ts`, there is no `dist/` and no install-time build step) — on
purpose. An earlier version of this repo had each package build to `dist/`
via an npm `prepare` script, but npm does not run workspace `prepare`
scripts in dependency order, so a clean install would non-deterministically
try to build `@wedding-core/client` before `@wedding-core/db` existed yet
and fail. Shipping source instead removes that failure mode entirely: there
is nothing to build, so there is no order to get wrong.

The frontend then adds these three packages to Next.js's
[`transpilePackages`](https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages)
so its own bundler compiles the raw TS directly — the standard,
zero-extra-tooling way Next.js supports local/monorepo packages that aren't
pre-compiled:

```ts
// next.config.ts
const nextConfig = {
  transpilePackages: ["@wedding-core/client", "@wedding-core/contract-core", "@wedding-core/db"],
};
```

Each frontend then constructs exactly one, permanently brand-bound client:

```ts
// dimaxwedding_projekt — always "dimax", never derived from a request
import { createWeddingCoreClient } from "@wedding-core/client";

const weddingCore = await createWeddingCoreClient({
  brandSlug: "dimax",
  databaseUrl: process.env.DATABASE_URL!, // wedding_core_app role only
});
```

DKHochzeitArt/Website does the same with `brandSlug: "dkhochzeitart"` and
its own `DATABASE_URL`. Because the brand is fixed at construction time
(not resolved per-request from Host), a bug in one frontend's route code
structurally cannot address the other brand's data — see
`packages/contract-core/src/brand-guard.ts` for the additional
defense-in-depth host check.

## What's done vs. what's still needed to go live

Done (this repo, local only so far):

- Full schema + composite tenant-safe foreign keys + `FORCE ROW LEVEL
  SECURITY` + policies + append-only audit trigger + concurrency-safe,
  per-brand/per-year contract numbering (`packages/db/migrations/0001_init.sql`)
- Typed Drizzle schema mirror (`packages/db/src/schema.ts`)
- Snapshot hashing, contract-number formatting, brand resolution/guard
  (`packages/contract-core`)
- A minimal, brand-bound client skeleton with the transaction-scoped
  `withBrandScope` choke point (`packages/client`) — no contract/customer
  data-access methods yet, those come with the actual signing flow

Still needed before this is live:

1. Create the **Wedding Core** Supabase project in the existing
   organization (same org as DKStudioLab/Mietora).
2. Run `packages/db/migrations/0001_init.sql` against it once, then set a
   real password for `wedding_core_app`.
3. `npm install` at the repo root (installs workspace deps; `npm run
   typecheck` verifies all three packages — no build step exists or is
   needed, see "Consuming from a frontend" above).
4. Push this repo to a Git remote, then wire the two frontends'
   `package.json` to the `github:...#main:packages/...` dependencies above,
   and add `transpilePackages` to each frontend's `next.config.ts`.
5. Set `DATABASE_URL` (tenant-scoped) in each frontend's env, and
   `ADMIN_DATABASE_URL` only wherever migrations/admin tooling run.

None of the above has been executed yet — this is prepared, reviewed code,
not a live system.
