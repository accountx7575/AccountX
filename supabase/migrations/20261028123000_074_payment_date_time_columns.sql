-- 074 — Add payment_date and time columns to payments table
-- Ensures payments table can persist user-specified payment_date and time alongside date.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_date text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS time text;

-- Backfill payment_date from date for existing records
UPDATE payments
SET payment_date = to_char(date, 'YYYY-MM-DD')
WHERE payment_date IS NULL AND date IS NOT NULL;

NOTIFY pgrst, 'reload schema';
