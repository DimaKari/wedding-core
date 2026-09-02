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
  client/          the thin, brand-bound data-access client
```

Full reasoning for this split, the tenant-isolation model, and the finalized
security rules live in the architecture document (sections C and L).

## Consuming from a frontend — verified, not assumed

An earlier version of this README told frontends to install
`@wedding-core/client`, `@wedding-core/contract-core`, `@wedding-core/db` as
three **separate git-subdirectory dependencies**
(`github:owner/wedding-core#main:packages/client`, etc.). That was wrong,
and has been corrected after actually testing it — the finding, and why,
is worth keeping here so nobody reintroduces it:

**npm does not support installing a subdirectory of a git repository.**
Tested against a real git remote (a local `git://` daemon, not just a
`file://` path, to rule out a transport quirk) from a completely separate
consumer repo:

- `"@wedding-core/client": "git://host/wedding-core.git#main:packages/client"`
  — npm's own argument parser silently treats `main:packages/client` as
  garbage, warns `ignoring unknown key "main"`, and **silently installs the
  entire repository root** under the `@wedding-core/client` name instead
  (confirmed by inspecting the installed `package.json` — its `name` field
  said `"wedding-core"`, not `"@wedding-core/client"`, and every top-level
  file was there, not just `packages/client`). No error, wrong content —
  worse than a hard failure. This matches npm's own documentation (the git
  URL spec only accepts `#<commit-ish>` or `#semver:<range>` after the
  hash) and a long-standing, still-unresolved upstream issue,
  [npm/cli#513](https://github.com/npm/cli/issues/513).

**What was verified to actually work**, end to end, from a fresh, unrelated
consumer directory (`npm install` → real TypeScript imports → `npm run
build` via `tsc`, zero errors): a **single git dependency on the whole
repo**, with the root `package.json` exposing each package as a **subpath
export**:

```json
// wedding-core/package.json (root)
{
  "name": "wedding-core",
  "exports": {
    "./client": "./packages/client/src/index.ts",
    "./contract-core": "./packages/contract-core/src/index.ts",
    "./db": "./packages/db/src/index.ts"
  }
}
```

A frontend depends on the repo **once**:

```jsonc
// dimaxwedding_projekt/package.json (illustrative — repo has no remote yet)
"dependencies": {
  "wedding-core": "git+https://github.com/<owner>/wedding-core.git#main"
}
```

and imports by subpath:

```ts
import { createWeddingCoreClient } from "wedding-core/client";
import type { BrandSlug } from "wedding-core/contract-core";
```

This still isn't "a hard dependency on the whole repo" in the sense that
matters: only `./client`, `./contract-core`, `./db` are reachable import
paths (enforced by the `exports` map — anything not listed, e.g. reaching
into `migrations/` or a future `apps/admin`, is not importable at all, even
though the files are physically present in `node_modules/wedding-core`).
Internal cross-package imports (`packages/client` → `packages/db` /
`packages/contract-core`) use **relative paths**, not bare `@wedding-core/*`
specifiers, precisely so they keep resolving once installed this way — bare
specifiers only worked locally via npm workspace symlinks and would have
broken for an external consumer.

Each package still ships raw TypeScript (no `dist/`, no build step — see
the "why" in the prior README revision's git history if curious). The
frontend adds the repo to Next.js's
[`transpilePackages`](https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages)
so its own bundler compiles the raw TS:

```ts
// next.config.ts
const nextConfig = {
  transpilePackages: ["wedding-core"],
};
```

## Private-repo authentication on Vercel

Once this repo is pushed to GitHub as **private**, Vercel's build container
needs a credential to `git clone` it as a dependency of `dimaxwedding_projekt`
/ `DKHochzeitArt/Website`. Two real options, both zero-cost (a GitHub
Personal Access Token, not a paid product):

- **Vercel's own documented pattern** ([Vercel KB: private
  dependencies](https://vercel.com/kb/guide/using-private-dependencies-with-vercel)):
  a read-only GitHub PAT embedded directly in the git URL,
  `git+https://<user>:<token>@github.com/<owner>/wedding-core.git#main`.
  Simplest, but the token then lives in `package.json` — acceptable only if
  that token is treated as fully sensitive wherever the file is stored, and
  rotated if ever exposed. Not recommended to actually commit this.
- **Recommended instead — token stays out of any committed file.** Keep
  `package.json`'s dependency token-free
  (`git+https://github.com/<owner>/wedding-core.git#main`) and add a
  `preinstall` script in each frontend that rewrites the URL via a Vercel
  Environment Variable at build time, before npm ever clones:
  ```json
  "scripts": {
    "preinstall": "git config --global url.\"https://${WEDDING_CORE_PAT}@github.com/\".insteadOf \"https://github.com/\""
  }
  ```
  with `WEDDING_CORE_PAT` set as a **Sensitive** Environment Variable in
  each frontend's Vercel project settings (a fine-grained PAT, read-only,
  scoped to just the `wedding-core` repo). Verified mechanically: rewriting
  a deliberately-unreachable git URL via `git config --global
  url.<real>.insteadOf <fake>` and re-running `npm install` changed the
  failure from "could not resolve host" to the rewritten target actually
  being contacted — confirming npm's git-clone step honors the rewrite
  before ever touching the original (tokenless) URL in `package.json`.

Either way: no paid registry, no GitHub Packages subscription, no Vercel
add-on — a single free, revocable, read-only PAT per frontend project.

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
- Root `exports` map + relative internal imports, verified end-to-end from
  a separate consumer repo against a real git transport (see above)

Still needed before this is live:

1. Create the **Wedding Core** Supabase project in the existing
   organization (same org as DKStudioLab/Mietora).
2. Run `packages/db/migrations/0001_init.sql` against it once, then set a
   real password for `wedding_core_app`.
3. `npm install` at the repo root (installs workspace deps; `npm run
   typecheck` verifies all three packages — no build step exists or is
   needed).
4. Push this repo to a **private** GitHub remote, then wire both frontends'
   `package.json` to `"wedding-core": "git+https://github.com/<owner>/wedding-core.git#main"`,
   add `transpilePackages: ["wedding-core"]` to each `next.config.ts`, and
   set up the `preinstall` PAT rewrite (or Vercel's direct-embed pattern)
   described above.
5. Set `DATABASE_URL` (tenant-scoped) in each frontend's env, and
   `ADMIN_DATABASE_URL` only wherever migrations/admin tooling run.

None of the above has been executed yet — this is prepared, reviewed, and
now empirically tested code, not a live system.
