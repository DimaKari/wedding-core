-- Internal contract management tool (architecture: "kleine interne
-- Vertragsverwaltung mit Pflicht-Vorschau vor Versand"). Two things:
--
-- 1) Status widens from draft|signed to draft|ready|sent|signed:
--      draft  -- created internally, editable, public link is inert
--      ready  -- internally reviewed and released; public link now works
--               (customer can fill data / sign), no email sent yet
--      sent   -- same as ready for the customer-facing flow; internal
--               bookkeeping only ("we emailed them")
--      signed -- unchanged, final, read-only
--
-- 2) A second, more privileged role (wedding_admin) for the new internal
--    tool -- deliberately NOT reusing wedding_app for this. wedding_app's
--    whole security property ("a signed contract is read-only at the DB
--    level, not just by app convention") must stay untouched by internal
--    tooling too. wedding_admin gets its own, separately scoped policies
--    that still hard-block any write to a signed row -- internal staff can
--    manage draft/ready/sent contracts, but nobody, including this admin
--    role, can ever mutate a signed one. wedding_app's own update policy
--    widens from status='draft' to status in ('draft','ready','sent') --
--    the customer flow only ever touches pre-signed rows now instead of
--    only-draft rows, still never a signed one.

alter table contracts drop constraint contracts_status_check;
alter table contracts add constraint contracts_status_check
  check (status in ('draft', 'ready', 'sent', 'signed'));

drop policy tenant_update_draft_only on contracts;
create policy tenant_update_unsigned on contracts
  for update
  using (brand = current_setting('app.current_brand', true) and status in ('draft', 'ready', 'sent'))
  with check (brand = current_setting('app.current_brand', true));

-- ─────────────────────────────────────────────────────────────────────────
-- wedding_admin -- used only by the new internal server actions (its own
-- connection string, WEDDING_ADMIN_DATABASE_URL, never exposed to the
-- public-facing customer routes). Same brand-scoping pattern as
-- wedding_app (set_config('app.current_brand', ...) per request).
-- ─────────────────────────────────────────────────────────────────────────
create role wedding_admin noinherit login;
-- Set the real password out-of-band, same as wedding_app:
--   alter role wedding_admin with password '<generated>';

grant usage on schema public to wedding_admin;
grant select, insert, update, delete on contracts to wedding_admin;

create policy admin_read on contracts
  for select
  using (brand = current_setting('app.current_brand', true));

-- New contracts always start as drafts -- the tool has no path that
-- inserts a row in any other status.
create policy admin_insert_draft on contracts
  for insert
  with check (brand = current_setting('app.current_brand', true) and status = 'draft');

-- Admin can update anything EXCEPT an already-signed row -- signed stays
-- immutable for every role, not just wedding_app.
create policy admin_update_unsigned on contracts
  for update
  using (brand = current_setting('app.current_brand', true) and status <> 'signed')
  with check (brand = current_setting('app.current_brand', true));

-- Only an undispatched draft may be deleted -- once released (ready/sent)
-- or signed, deletion is not offered by the tool and not permitted here.
create policy admin_delete_draft_only on contracts
  for delete
  using (brand = current_setting('app.current_brand', true) and status = 'draft');
