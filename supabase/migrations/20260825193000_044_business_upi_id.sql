-- 044: businesses.upi_id - optional UPI ID for invoice payment QR codes (T70)
-- Additive only; businesses SELECT policies already cover owner/members.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS upi_id text;

COMMENT ON COLUMN public.businesses.upi_id IS 'Optional UPI ID (VPA) used to render payment QR codes on sales invoices';
