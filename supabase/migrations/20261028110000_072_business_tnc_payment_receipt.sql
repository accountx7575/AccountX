-- Central Payment Receipts Terms & Conditions defaults.
alter table public.businesses
  add column if not exists tnc_payment_receipt text default null,
  add column if not exists terms_payment_receipt text default null;
