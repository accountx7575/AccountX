-- Business profile extras, supplement to 20261002_business_profile_extras.sql.
-- Must be applied to the live DB (dashboard/push) before saves persist server-side.
-- Until applied, SettingsPage stashes these values locally and invoices merge them in.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS pincode text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS account_name text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS upi_qr_url text;
