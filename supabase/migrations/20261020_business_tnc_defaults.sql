-- Central document Terms & Conditions defaults.
-- UNAPPLIED by design until the human applies it: client reads/writes fail-soft with a
-- localStorage fallback while these columns are missing (business_profile_extras precedent).
alter table businesses
  add column if not exists tnc_invoice text default null,
  add column if not exists tnc_quotation text default null,
  add column if not exists tnc_sales_order text default null,
  add column if not exists tnc_purchase text default null;
