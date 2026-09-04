-- ============================================================================
-- 048: convert_quotation_to_sales_order (T92) — completes the conversion
-- family started by 046 (QT->INV, SO->INV, PO->BILL). Mirrors the live
-- 046 house pattern exactly (20260825213000_046_document_conversion_rpcs):
--   * auth.uid() + can_write_business() gates
--   * FOR UPDATE lock on the source quotation, business-scoped
--   * double-conversion blocked TWICE: pre-check under the lock AND the
--     final status-guarded UPDATE (idempotent RAISE on re-entry)
--   * deep-copy with EXACT column mapping, zero re-derivation of any total
--   * guarded flip to 'converted' + converted_doc_id linkage
--
-- CONTRACT NOTES (deviations from the dispatch text, all schema-driven):
--   * RETURNS new_doc_id UUID (dispatch said int) — sales_orders.id and
--     quotations.converted_doc_id are uuid since 026; mirroring 046.
--   * quotations has NO converted_doc_type column (026) — linkage is
--     converted_doc_id plus the natural back-link sales_orders.quotation_id,
--     which this RPC populates for bidirectional traceability.
--   * sales_orders has NO terms column — quotation terms are dropped on
--     copy (documented here; notes carry over verbatim).
--   * New order starts at 'draft': orders are paperwork until confirmed
--     (J2 machine draft -> confirmed -> fulfilled -> converted). A merely
--     SENT quote must not mint a confirmed commitment; the user confirms
--     deliberately downstream. 046 produced a LIVE invoice because invoices
--     are themselves the money event — an order is not.
--   * expected_date <- expiry_date (quote validity maps to delivery
--     expectation); order_date <- p_order_date (default CURRENT_DATE).
--
-- NUMBERING: next_document_number(business_id,'sales_order',date) — the
-- SAME service path every existing sales_orders row uses (026 re-emission;
-- prefix SO/YYYY/nnnnnn). No parallel numbering.
-- NO stock movements, NO journal entries (orders never touch stock or books
-- per J2). NO audit_logs write — mirror of the live 046 bodies.
-- businesses.financial_year_lock triggers (038) police the order date
-- automatically via the generic to_jsonb coverage — nothing to add here.
-- ============================================================================

CREATE OR REPLACE FUNCTION convert_quotation_to_sales_order(
  p_business_id uuid,
  p_quotation_id uuid,
  p_order_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (new_doc_id uuid, new_doc_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q quotations;
  v_expected text[] := ARRAY['sent','accepted']::text[];
  v_order_date date;
  v_so_no text;
  v_so_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_q FROM quotations
  WHERE id = p_quotation_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found in this business';
  END IF;
  IF v_q.status = 'converted' OR v_q.converted_doc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quotation % has already been converted', v_q.quotation_number;
  END IF;
  IF NOT v_q.status = ANY(v_expected) THEN
    RAISE EXCEPTION 'Only sent or accepted quotations can be converted (current status: %)', v_q.status;
  END IF;

  v_order_date := COALESCE(p_order_date, CURRENT_DATE);
  v_so_no := next_document_number(p_business_id, 'sales_order', v_order_date);

  INSERT INTO sales_orders (
    business_id, order_number, customer_id, quotation_id,
    order_date, expected_date,
    subtotal, discount_amount, taxable_amount,
    cgst_amount, sgst_amount, igst_amount, cess_amount,
    round_off, grand_total,
    status, notes, created_by
  ) VALUES (
    v_q.business_id, v_so_no, v_q.customer_id, v_q.id,
    v_order_date, v_q.expiry_date,
    v_q.subtotal, v_q.discount_amount, v_q.taxable_amount,
    v_q.cgst_amount, v_q.sgst_amount, v_q.igst_amount, v_q.cess_amount,
    v_q.round_off, v_q.grand_total,
    'draft', v_q.notes, auth.uid()
  )
  RETURNING id INTO v_so_id;

  -- Deep-copy ALL line items verbatim (rates, tax distribution, totals).
  INSERT INTO sales_order_items (
    business_id, sales_order_id, product_id, product_name, hsn_sac,
    quantity, unit, rate, discount_amount, tax_rate,
    taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount,
    total_amount
  )
  SELECT
    v_q.business_id, v_so_id, it.product_id, it.product_name, it.hsn_sac,
    it.quantity, it.unit, it.rate, it.discount_amount, it.tax_rate,
    it.taxable_amount, it.cgst_amount, it.sgst_amount, it.igst_amount, it.cess_amount,
    it.total_amount
  FROM quotation_items it
  WHERE it.quotation_id = v_q.id
  ORDER BY it.created_at, it.id;

  -- Post-guard flip: re-checks the allow-list under the row lock taken at
  -- entry; if a concurrent writer changed status, this finds no row and we
  -- abort the whole transaction (order insert rolls back with it).
  UPDATE quotations
  SET status = 'converted', converted_doc_id = v_so_id, updated_at = now()
  WHERE id = v_q.id AND status = ANY(v_expected);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation state changed during conversion - retry';
  END IF;

  RETURN QUERY SELECT v_so_id, v_so_no;
END;
$$;

REVOKE EXECUTE ON FUNCTION convert_quotation_to_sales_order(uuid, uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION convert_quotation_to_sales_order(uuid, uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION convert_quotation_to_sales_order(uuid, uuid, date) TO authenticated;
