-- Wedding Core — minimal contract system (architecture doc, section M).
-- One table. No brands table (CHECK constraint instead, see M.2). No
-- versions/signatures/events tables — everything lives on the one row.
--
-- Run this once against a fresh "Wedding Core" Supabase project (SQL
-- editor or any Postgres client, using the privileged/admin connection
-- string — never the low-privilege wedding_app role created below).

create extension if not exists pgcrypto; -- gen_random_uuid()

create table contracts (
  id                 uuid primary key default gen_random_uuid(), -- = the private link token
  brand              text not null check (brand in ('dimax', 'dkhochzeitart')),
  status             text not null default 'draft' check (status in ('draft', 'signed')),

  -- Customer data — completed by the customer via the link while status='draft'.
  customer_names     text,
  customer_email     text,
  customer_phone     text,

  -- Package/price snapshot at creation time — never a live reference to
  -- content/pricing.ts, so a later price change never rewrites history.
  package_id         text not null,
  package_label      text not null,
  price_chf          integer not null, -- whole CHF, matches this project's existing pricing.ts convention
  wedding_date       date,
  location           text,
  custom_terms       jsonb not null default '{}'::jsonb,

  -- Frozen at signing only. Structured content JSON, never raw HTML —
  -- includes a frozen copy of the legal text shown at signing time, so the
  -- post-signing view never depends on the frontend's template code having
  -- stayed the same.
  content_snapshot   jsonb,
  content_hash       text, -- SHA-256 of content_snapshot

  -- Signature — one input among several, not the sole evidence. Vector
  -- stroke data, not a raster image. ip/user_agent are supportive context.
  signer_name_typed  text,
  signature_strokes  jsonb,
  consents           jsonb,
  ip_address         inet,
  user_agent         text,
  signed_at          timestamptz, -- = Abschlusszeitpunkt

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index idx_contracts_brand        on contracts (brand);
create index idx_contracts_brand_status on contracts (brand, status);

-- ─────────────────────────────────────────────────────────────────────────
-- Row Level Security — two things enforced here, both requested explicitly:
--   1) a brand can never see/touch another brand's rows
--   2) a signed contract is read-only at the database level, not just by
--      application convention — the UPDATE policy's USING clause is
--      evaluated against the row as it is BEFORE the update, so once
--      status='signed' no further UPDATE can succeed through this role at
--      all, regardless of what the application code does or forgets to check.
-- ─────────────────────────────────────────────────────────────────────────
alter table contracts enable row level security;
alter table contracts force row level security;

create policy tenant_read on contracts
  for select
  using (brand = current_setting('app.current_brand', true));

create policy tenant_insert on contracts
  for insert
  with check (brand = current_setting('app.current_brand', true));

create policy tenant_update_draft_only on contracts
  for update
  using (brand = current_setting('app.current_brand', true) and status = 'draft')
  with check (brand = current_setting('app.current_brand', true));

-- No DELETE policy, no delete grant below — a contract, signed or not, is
-- never deleted through the normal app role.

-- ─────────────────────────────────────────────────────────────────────────
-- wedding_app — the only role the app's normal (tenant-scoped) connection
-- uses. Not a table owner, not superuser, no BYPASSRLS.
-- ─────────────────────────────────────────────────────────────────────────
create role wedding_app noinherit login;
-- Set the real password out-of-band, e.g.:
--   alter role wedding_app with password '<generated-in-supabase-dashboard>';

grant usage on schema public to wedding_app;
grant select, insert, update on contracts to wedding_app;
