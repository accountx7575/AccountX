/*
# 071 — Add Aadhaar column to customers table

Add nullable column `aadhaar` (text) to the `customers` table matching `pan`.
Allows individual and proprietor customers to store their 12-digit Aadhaar number
and have it rendered on sales documents, receipts, and invoices.
*/

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS aadhaar text;
