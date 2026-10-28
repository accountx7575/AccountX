/*
# 067 — Payment Received / Payment Made prefix columns (PBS-222)

Add user-configurable prefix columns to public.businesses so payment document
numbering (RCV/PAY by default) is driven from Settings > Numbering Prefixes
instead of being hardcoded in next_document_number.

Both columns default to the existing hardcoded values ('RCP' and 'PM') so
existing businesses keep the same numbering pattern unless they change it.
*/

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS payment_received_prefix text DEFAULT 'RCP';

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS payment_made_prefix text DEFAULT 'PM';
