-- 077 — Add invoice_time and time columns to sales_invoices table
-- Ensures sales_invoices can persist custom user-specified invoice_time alongside invoice_date.

ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS invoice_time text;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS time text;

-- Backfill invoice_time and time from created_at in Asia/Kolkata (+05:30)
UPDATE sales_invoices
SET 
  invoice_time = to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'hh:mi am'),
  time = to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'hh:mi am')
WHERE invoice_time IS NULL AND created_at IS NOT NULL;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
