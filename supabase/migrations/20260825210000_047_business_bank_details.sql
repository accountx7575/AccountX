-- 047: businesses bank detail columns - quotation/sales-order/invoice bank pre-fill (T90)
-- Additive only; mirrors 044 pattern. InvoiceSheet.tsx already reads
-- bank_name / bank_account_number via casts; this makes them real columns.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_ifsc_code text;

COMMENT ON COLUMN public.businesses.bank_name IS 'Optional bank name rendered in Bank Details blocks on invoices/quotations/sales orders';
COMMENT ON COLUMN public.businesses.bank_account_number IS 'Optional account number rendered in Bank Details blocks';
COMMENT ON COLUMN public.businesses.bank_ifsc_code IS 'Optional IFSC code rendered in Bank Details blocks';
