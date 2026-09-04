-- ============================================================================
-- 061 — RELEASE HARDENING: export_business_backup RPC
-- ============================================================================
-- T112 new-surface deliverable (owner directive). ONE jsonb snapshot of one
-- business for the Settings "Download backup" action.
--
-- Access model = 045 house pattern: SECURITY DEFINER (must read every table
-- regardless of future policy drift) + hard gates auth.uid() + membership.
-- Read-only operation -> gate on is_business_member (NOT can_write): any
-- active member may export; only the data of businesses they belong to.
--
-- Contract (FROZEN — relayed to Phyllis via god):
--   export_business_backup(p_business_id uuid) RETURNS jsonb
--   { schema_version: '1', generated_at: timestamptz,
--     business, customers, suppliers, products, warehouses,
--     invoices, invoice_items, purchase_bills, purchase_bill_items,
--     payments, accounts, journal_entries, journal_entry_lines,
--     stock_movements }   -- all collection keys are arrays ('[]' when empty)
--
-- Deliberate v1 scope = exactly the owner-directed table list. Excluded and
-- extendable later without breaking consumers (additive keys only):
-- expenses/categories, credit/debit notes, quote/order family, comms/tally
-- tables, fiscal_year_closes, gst_settlements.
--
-- Determinism: every aggregate ORDER BY id (stable byte-comparable exports).
-- Scale note: jsonb_agg materializes the whole business in memory once;
-- fine at SMB volume, revisit only if a tenant grows past ~6-figure rows.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.export_business_backup(
  p_business_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $export_body$
DECLARE
  v_uid uuid;
  v_result jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Not a member of this business';
  END IF;

  SELECT jsonb_build_object(
    'schema_version', '1',
    'generated_at', now(),

    'business', (
      SELECT to_jsonb(b) FROM public.businesses b WHERE b.id = p_business_id
    ),

    'customers', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.customers x WHERE x.business_id = p_business_id
    ),

    'suppliers', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.suppliers x WHERE x.business_id = p_business_id
    ),

    'products', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.products x WHERE x.business_id = p_business_id
    ),

    'warehouses', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.warehouses x WHERE x.business_id = p_business_id
    ),

    'invoices', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.sales_invoices x WHERE x.business_id = p_business_id
    ),

    'invoice_items', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.sales_invoice_items x WHERE x.business_id = p_business_id
    ),

    'purchase_bills', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.purchase_bills x WHERE x.business_id = p_business_id
    ),

    'purchase_bill_items', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.purchase_bill_items x WHERE x.business_id = p_business_id
    ),

    'payments', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.payments x WHERE x.business_id = p_business_id
    ),

    'accounts', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.accounts x WHERE x.business_id = p_business_id
    ),

    'journal_entries', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.journal_entries x WHERE x.business_id = p_business_id
    ),

    'journal_entry_lines', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.journal_entry_lines x WHERE x.business_id = p_business_id
    ),

    'stock_movements', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.stock_movements x WHERE x.business_id = p_business_id
    )
  )
  INTO v_result;

  RETURN v_result;
END
$export_body$;

REVOKE EXECUTE ON FUNCTION public.export_business_backup(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.export_business_backup(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.export_business_backup(uuid) TO authenticated;
