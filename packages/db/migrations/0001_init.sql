-- Wedding Core — Phase 0 / Fundament
-- Initial schema: brands, customers, contracts + full audit/version chain.
-- Implements the finalized hardening rules from the architecture doc, section L.9:
--   9.1 tenant-safe composite foreign keys (brand_id, id)
--   9.2 FORCE ROW LEVEL SECURITY + a dedicated low-privilege app role
--   9.4 storage-path convention (enforced app-side + Storage policy, not here),
--       a truly append-only contract_events table, concurrency-safe contract numbers
--
-- No visible contract UI depends on this yet — pure infrastructure (Phase 0).
-- Run this against the "Wedding Core" Supabase project's SQL editor, or via
-- your migration tool of choice (Drizzle, etc.) once the project exists.

create extension if not exists pgcrypto; -- gen_random_uuid()

create type contract_status as enum (
  'draft', 'sent', 'viewed', 'signed', 'completed', 'cancelled'
);

-- ─────────────────────────────────────────────────────────────────────────
-- brands — single source of truth for everything brand-specific.
-- Not per-request-sensitive customer data, so no RLS here; write access is
-- restricted at the grant level instead (only the admin/service_role path
-- may INSERT/UPDATE/DELETE — see role setup below).
-- ─────────────────────────────────────────────────────────────────────────
create table brands (
  id                       uuid primary key default gen_random_uuid(),
  slug                     text not null unique,               -- 'dimax' · 'dkhochzeitart'
  legal_name               text not null,                      -- for the PDF footer
  domain                   text not null,                      -- primary domain, informational
  email_from               text not null,
  email_reply_to           text,
  contract_number_prefix   text not null,                      -- 'DX' · 'DK'
  brand_theme              jsonb not null default '{}'::jsonb,  -- logo/colour refs for the PDF
  created_at               timestamptz not null default now()
);

-- Seed the two brands. Adjust email_from/prefix to the real verified Resend senders.
insert into brands (slug, legal_name, domain, email_from, contract_number_prefix) values
  ('dimax',        'DIMAX Wedding',  'dimaxwedding.ch',  'vertrag@dimaxwedding.ch',  'DX'),
  ('dkhochzeitart','DKHochzeitArt',  'dkhochzeitart.de', 'vertrag@dkhochzeitart.de', 'DK');

-- ─────────────────────────────────────────────────────────────────────────
-- brand_sequences — concurrency-safe, per-brand, per-year contract counter.
-- See next_contract_number() below for the atomic increment.
-- ─────────────────────────────────────────────────────────────────────────
create table brand_sequences (
  brand_id       uuid not null references brands (id),
  sequence_name  text not null default 'contract_number',
  year           int  not null,
  next_value     int  not null default 1,
  primary key (brand_id, sequence_name, year)
);

create or replace function next_contract_number(p_brand_id uuid, p_year int)
returns int
language plpgsql
as $$
declare
  v int;
begin
  insert into brand_sequences (brand_id, sequence_name, year, next_value)
  values (p_brand_id, 'contract_number', p_year, 1)
  on conflict (brand_id, sequence_name, year)
  do update set next_value = brand_sequences.next_value + 1
  returning next_value into v;
  return v;
end;
$$;
-- Single atomic statement (INSERT ... ON CONFLICT DO UPDATE ... RETURNING):
-- Postgres row-locks the (brand_id, sequence_name, year) row for the
-- statement's duration, so two contracts of the same brand/year completing
-- at the same instant are serialized and can never receive the same number.
-- Format the human-readable number in application code as
-- `${brand.contract_number_prefix}-${year}-${String(v).padStart(3, '0')}`.

-- ─────────────────────────────────────────────────────────────────────────
-- customers
-- ─────────────────────────────────────────────────────────────────────────
create table customers (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands (id),
  names       text not null,          -- "Aline & Noah"
  email       text not null,
  phone       text,
  created_at  timestamptz not null default now(),
  unique (brand_id, id)                -- anchor for composite FKs from contracts
);

-- ─────────────────────────────────────────────────────────────────────────
-- contracts — mutable draft up until signing; current_version_id points at
-- the active contract_versions row once one exists.
-- ─────────────────────────────────────────────────────────────────────────
create table contracts (
  id                   uuid primary key default gen_random_uuid(),  -- = access token in the URL
  brand_id             uuid not null references brands (id),
  customer_id          uuid not null,
  status               contract_status not null default 'draft',
  contract_number      text,                     -- assigned at completion, e.g. "DX-2026-001"
  package_id           text not null,             -- references the brand's pricing content
  wedding_date         date,
  location             text,
  price                integer not null,          -- Rappen/Cents, never float
  deposit              integer,
  extras               jsonb not null default '[]'::jsonb,
  custom_terms         jsonb not null default '{}'::jsonb,
  current_version_id   uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (brand_id, id),
  unique (brand_id, contract_number),
  foreign key (brand_id, customer_id) references customers (brand_id, id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- contract_versions — append-only from the moment of signing. content_snapshot
-- is structured content JSON (never raw rendered HTML) so the hash stays
-- stable against irrelevant formatting changes.
-- ─────────────────────────────────────────────────────────────────────────
create table contract_versions (
  id                 uuid primary key default gen_random_uuid(),
  brand_id           uuid not null,
  contract_id        uuid not null,
  version_number     int not null,
  content_snapshot   jsonb not null,
  content_hash       text not null,   -- SHA-256 of content_snapshot
  created_at         timestamptz not null default now(),
  unique (brand_id, id),
  unique (contract_id, version_number),
  foreign key (brand_id, contract_id) references contracts (brand_id, id)
);

alter table contracts
  add constraint contracts_current_version_same_brand
  foreign key (brand_id, current_version_id) references contract_versions (brand_id, id);
  -- current_version_id is nullable; a NULL leaves a composite FK unchecked
  -- (Postgres MATCH SIMPLE default), so draft contracts with no version yet are fine.

-- ─────────────────────────────────────────────────────────────────────────
-- contract_signatures — vector stroke data is the record, not just a raster
-- image. ip/user_agent are supportive context, never the sole evidence.
-- ─────────────────────────────────────────────────────────────────────────
create table contract_signatures (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null,
  contract_id         uuid not null,
  version_id          uuid not null,
  signer_name_typed   text not null,
  signature_strokes   jsonb not null,   -- [{x,y,t}, ...] point data, not a PNG
  consents            jsonb not null,   -- which required checkboxes were confirmed
  ip_address          inet,
  user_agent          text,
  signed_at           timestamptz not null default now(),
  unique (brand_id, id),
  foreign key (brand_id, contract_id) references contracts (brand_id, id),
  foreign key (brand_id, version_id) references contract_versions (brand_id, id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- contract_events — the audit trail. Truly append-only: the app role gets
-- INSERT/SELECT only (see grants below), and a trigger blocks UPDATE/DELETE
-- as a second, independent layer even against a role that somehow has grants.
-- ─────────────────────────────────────────────────────────────────────────
create table contract_events (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null,
  contract_id   uuid not null,
  event_type    text not null,   -- 'created' · 'sent' · 'viewed' · 'signed' · 'completed' · 'cancelled' · 'redacted' …
  payload       jsonb not null default '{}'::jsonb,
  actor         text,            -- 'customer' · 'system' · 'staff:<name>'
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz not null default now(),
  foreign key (brand_id, contract_id) references contracts (brand_id, id)
);

create or replace function forbid_contract_events_mutation()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.allow_event_mutation', true) is distinct from 'true' then
    raise exception 'contract_events is append-only; % is blocked (row id: %)',
      tg_op, coalesce(old.id, null);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger contract_events_no_update
  before update on contract_events
  for each row execute function forbid_contract_events_mutation();

create trigger contract_events_no_delete
  before delete on contract_events
  for each row execute function forbid_contract_events_mutation();
-- A legitimate correction (e.g. a GDPR erasure request) runs only through the
-- privileged system path, which does `set local app.allow_event_mutation = 'true';`
-- inside its own transaction — and should itself insert a new event row
-- documenting that a redaction happened, rather than silently rewriting history.

-- ─────────────────────────────────────────────────────────────────────────
-- contract_documents — archived, immutable PDF pointers.
-- storage_path convention: contracts/{brand_slug}/{contract_id}/{version}.pdf
-- (the actual access boundary is the Storage bucket policy, set up separately
-- in the Supabase dashboard/Storage SQL — not part of this schema migration).
-- ─────────────────────────────────────────────────────────────────────────
create table contract_documents (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null,
  contract_id    uuid not null,
  version_id     uuid not null,
  storage_path   text not null,
  content_hash   text not null,
  created_at     timestamptz not null default now(),
  foreign key (brand_id, contract_id) references contracts (brand_id, id),
  foreign key (brand_id, version_id) references contract_versions (brand_id, id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- Indexes — modest volume, but brand_id lookups are the hot path for every
-- tenant-scoped query, so index them explicitly rather than relying only on
-- the composite unique constraints above.
-- ─────────────────────────────────────────────────────────────────────────
create index idx_customers_brand           on customers (brand_id);
create index idx_contracts_brand           on contracts (brand_id);
create index idx_contracts_brand_status    on contracts (brand_id, status);
create index idx_contract_versions_brand   on contract_versions (brand_id, contract_id);
create index idx_contract_signatures_brand on contract_signatures (brand_id, contract_id);
create index idx_contract_events_brand     on contract_events (brand_id, contract_id, created_at);
create index idx_contract_documents_brand  on contract_documents (brand_id, contract_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Row Level Security — enabled AND forced on every tenant table (9.2: FORCE
-- makes the policy apply even to the owning role, which is what migrations
-- typically run as). Fails closed: if app.current_brand_id was never set for
-- a session, current_setting(..., true) returns NULL and no rows match.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'contracts', 'contract_versions',
    'contract_signatures', 'contract_events', 'contract_documents'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I
         for all
         using (brand_id = current_setting(''app.current_brand_id'', true)::uuid)
         with check (brand_id = current_setting(''app.current_brand_id'', true)::uuid)',
      t
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- wedding_core_app — the ONLY role the app's normal (tenant-scoped) server
-- connection should ever use. Not a table owner, not superuser, no BYPASSRLS.
-- Migrations and the internal admin tool use a separate, privileged
-- connection (Supabase's service_role / the project's postgres role) — never
-- this role, and never mixed into a request handler that serves brand traffic.
-- ─────────────────────────────────────────────────────────────────────────
create role wedding_core_app noinherit login;
-- Set the actual password out-of-band, e.g.:
--   alter role wedding_core_app with password '<generated-in-supabase-dashboard>';

grant usage on schema public to wedding_core_app;
grant select on brands to wedding_core_app;                 -- brand config: read-only for the app
grant select, update on brand_sequences to wedding_core_app; -- needed by next_contract_number()
grant execute on function next_contract_number(uuid, int) to wedding_core_app;

grant select, insert, update on customers            to wedding_core_app;
grant select, insert, update on contracts             to wedding_core_app;
grant select, insert          on contract_versions     to wedding_core_app; -- append-only in practice
grant select, insert          on contract_signatures   to wedding_core_app; -- append-only in practice
grant select, insert          on contract_events       to wedding_core_app; -- append-only, enforced by trigger too
grant select, insert          on contract_documents    to wedding_core_app;
-- No DELETE grants anywhere except customers/contracts, and even there the
-- app layer should only ever delete a genuinely unsent draft — deleting a
-- contract that has any version/signature/event should be a business-logic
-- error, not something the database silently allows.
