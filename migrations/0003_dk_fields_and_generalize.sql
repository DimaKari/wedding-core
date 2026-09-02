-- DKHochzeitArt V1 (Germany, EUR) needs fields the DIMAX-only schema didn't
-- have, and exposes a naming mistake worth fixing now, before a second
-- brand locks it in: price_chf/deposit_chf were CHF-specific column names
-- on a table shared by both brands -- exactly the "EUR/CHF-Vermischung"
-- the operator explicitly said not to carry over. Renamed to currency-
-- neutral names; each brand's own frontend applies its own currency
-- formatting (CHF for DIMAX, EUR for DKHochzeitArt) -- the column itself
-- carries no currency assumption.
--
-- customer_names -> customer_name_1 (+ new customer_name_2): DKHochzeitArt's
-- text asks for both partners' names separately ("Person 1"/"Person 2");
-- DIMAX keeps working exactly as before, just storing its one combined
-- name string in customer_name_1 and leaving customer_name_2 null.

alter table contracts rename column customer_names to customer_name_1;
alter table contracts rename column price_chf to package_price_amount;
alter table contracts rename column deposit_chf to deposit_amount;

alter table contracts
  add column customer_name_2 text,
  add column customer_address text,          -- optional; DIMAX leaves this null
  add column additional_locations text,       -- "weitere vereinbarte Locations"
  add column booking_type text check (booking_type in ('photo', 'video', 'photo_and_video')),
  add column package_services jsonb not null default '[]'::jsonb,  -- "enthaltene Leistungen" of the booked package, frozen at signing same as extras
  add column extras_price_amount integer not null default 0;       -- separate from package_price_amount; DIMAX always 0 (its V1 text doesn't itemize extras pricing)

-- Note: no RLS/grant changes needed -- policies and grants are table-wide.
