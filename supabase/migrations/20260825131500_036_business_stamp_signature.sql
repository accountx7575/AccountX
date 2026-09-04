/*
# 036 — Business stamp & digital signature images (owner direct order)

Two additive nullable text columns on businesses. Values are image URLs
or base64 data-URLs (client caps uploads at ~500KB each for v1; Supabase
Storage can take over later without a column change since the contract
is 'URL or data-URL string').

Rendered by the shared InvoiceSheet signatory block (live preview, print
and PDF capture all use <img src>, which data-URLs satisfy). No RLS
change needed: businesses rows already member-readable / admin-writable.
*/

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stamp_url text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS signature_url text;
