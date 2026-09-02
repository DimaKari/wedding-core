-- Additive migration for DIMAX Wedding contract text V1 (architecture doc
-- follow-up): the real legal text references fields the minimal M schema
-- didn't have yet -- start time, duration, extras, deposit (balance is
-- computed as price_chf - deposit_chf, not stored separately).
--
-- No RLS/grant changes needed: policies and grants in 0001_init.sql are
-- table-wide, not column-scoped, so they already cover these new columns.

alter table contracts
  add column start_time text,          -- freeform, e.g. "14:00" -- no timezone handling needed for a display field
  add column duration_label text,      -- freeform, e.g. "10 Stunden" or "Ohne Zeitlimit" -- matches how content/pricing.ts already describes durations
  add column extras jsonb not null default '[]'::jsonb,  -- list of extra-service labels (Zusatzleistungen)
  add column deposit_chf integer;       -- Anzahlung; Restbetrag = price_chf - deposit_chf, computed, not stored
