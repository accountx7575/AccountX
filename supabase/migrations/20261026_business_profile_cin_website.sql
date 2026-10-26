-- PBS-204 (human directive-18a): Business Profile CIN + Website columns.
--
-- The Business Profile tab now edits CIN (company registration number) and
-- Website. Until this migration is applied the client column-discovery probe
-- treats both as missing: the save still succeeds (existing columns only) and
-- the values are stashed locally, then flushed back on the next save once the
-- columns exist. Human applies this SQL.
--
-- Idempotent: IF NOT EXISTS makes re-running the script a no-op.

alter table public.businesses
  add column if not exists cin text default null,
  add column if not exists website text default null;
