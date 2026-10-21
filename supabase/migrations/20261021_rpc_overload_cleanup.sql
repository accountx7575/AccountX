-- 2026-10-21: RPC overload cleanup (PG 42725 "function is not unique" fix)
--
-- Symptom: converting a quotation to a tax invoice threw
--   "function create_sales_invoice(...) is not unique" (42725) / HTTP 400
--   PostgREST variant: PGRST203 "Could not choose the best candidate"
--
-- Root cause: two overload families exist for the save RPCs and the old
-- single-argument conversion wrappers coexist with the canonical
-- (p_business_id, p_*_id, date, date) ones:
--   create_sales_invoice(uuid, jsonb, jsonb)            -- 030 wrapper
--   create_sales_invoice(uuid, jsonb, jsonb, text)      -- canonical (DEFAULT 'issued')
--   convert_quotation_to_invoice(uuid)                  -- 046 single-arg wrapper
--   convert_quotation_to_invoice(uuid, uuid, date, date)-- canonical (046s)
-- PostgreSQL / PostgREST cannot resolve calls when two candidates tie
-- (untyped named args with defaults), so conversion failed at dispatch.
--
-- Fix: the canonical 4-arg save functions keep their bodies (last replaced by
-- 062); every overload that merely forwards or wraps is DROPPED. After this,
-- exactly one signature per function remains, so:
--   * PostgREST resolves PGRST203-free (clients passing p_status explicitly
--     or 3 args both hit the singleton),
--   * the internal calls inside convert_quotation_to_invoice /
--     convert_sales_order_to_invoice / convert_purchase_order_to_bill have a
--     single candidate (no plpgsql 42725).
-- Idempotent; safe on a fresh install (later migrations win).

DROP FUNCTION IF EXISTS public.create_sales_invoice(uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.create_purchase_bill(uuid, jsonb, jsonb);

-- superseded single-argument conversion wrappers (046 first pass)
DROP FUNCTION IF EXISTS public.convert_quotation_to_invoice(uuid);
DROP FUNCTION IF EXISTS public.convert_sales_order_to_invoice(uuid);
DROP FUNCTION IF EXISTS public.convert_purchase_order_to_bill(uuid);

COMMENT ON FUNCTION public.convert_quotation_to_invoice(uuid, uuid, date, date) IS
  'Converts quotations(sent|accepted) to tax invoices. Canonical entry point: p_business_id + p_quotation_id (+ optional dates). Creates the invoice via create_sales_invoice(uuid, jsonb, jsonb, text) with p_status=''issued'' and flips quotation to ''converted''.';
COMMENT ON FUNCTION public.create_sales_invoice(uuid, jsonb, jsonb, text) IS
  'Transactional invoice save (numbering, items, stock movements, journal posting, audit). p_status: ''issued'' (default) or ''draft''.';
