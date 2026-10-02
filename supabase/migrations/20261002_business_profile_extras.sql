-- Business profile extras for print settings (PBS printset-1002).
-- Must be applied to the live DB (dashboard/push) before saves persist.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS pincode text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS upi_qr_url text;
