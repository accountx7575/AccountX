-- ============================================================================
-- 046 — Document conversion RPCs (T88): QT->Invoice, SO->Invoice, PO->Bill
--
-- Owner-required flows previously stubbed in the UI ("Conversion lands next
-- release"). Three SECURITY DEFINER functions, house security pattern
-- (is_business_member gate like get_gst_summary / get_ai_business_snapshot):
--
--   convert_quotation_to_invoice(p_quotation_id)     requires source 'accepted'
--   convert_sales_order_to_invoice(p_sales_order_id) requires source 'fulfilled'
--   convert_purchase_order_to_bill(p_purchase_order_id) requires source 'received'
--
-- STATUS MACHINES (026, J2): converted is reachable ONLY from accepted /
-- fulfilled / received. draft/sent/confirmed/received(pending)/rejected/
-- cancelled states RAISE with the current status named. Converting an
-- already-converted doc RAISES naming the existing downstream document
-- (idempotency refusal, issue_document precedent).
--
-- SINGLE TRANSACTION: source header is SELECT ... FOR UPDATE'd first; the
-- target document is created by REUSING the canonical 017/030 save RPCs
-- (create_sales_invoice / create_purchase_bill) so numbering, per-item
-- validation, RMW stock effects, audit logs, and JE posting follow the
-- EXACT live-path math — no parallel tax/stock logic exists here. Item
-- qty/rate/discount/tax breakdowns are carried over verbatim (jsonb numeric
-- round-trip is lossless), preserving the J1 identity through posting.
-- Source flips to status='converted' + converted_doc_id=<target> in the
-- same tx; any failure rolls everything back.
--
-- ADDITIVE ONLY: no ALTER of existing columns (converted_doc_id already
-- exists from 026); no destructive statements. Target documents are dated
-- TODAY (a conversion is a fresh commercial event); due_date left NULL for
-- the user to set.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. Quotation -> Sales Invoice
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION convert_quotation_to_invoice(
  p_quotation_id uuid
)
RETURNS TABLE (document_id uuid, document_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q        record;
  v_header jsonb;
  v_items  jsonb;
  v_inv_id uuid;
  v_je_id  uuid;
  v_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO q
    FROM quotations
   WHERE id = p_quotation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found';
  END IF;

  IF NOT is_business_member(q.business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF NOT can_write_business(q.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF q.converted_doc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quotation % was already converted to document %', q.quotation_number, q.converted_doc_id;
  END IF;
  IF q.status <> 'accepted' THEN
    RAISE EXCEPTION 'Only ACCEPTED quotations can be converted; quotation % is currently %', q.quotation_number, q.status;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id',      i.product_id,
           'product_name',    i.product_name,
           'hsn_sac',         i.hsn_sac,
           'quantity',        i.quantity,
           'unit',            i.unit,
           'rate',            i.rate,
           'discount_amount', i.discount_amount,
           'tax_rate',        i.tax_rate,
           'taxable_amount',  i.taxable_amount,
           'cgst_amount',     i.cgst_amount,
           'sgst_amount',     i.sgst_amount,
           'igst_amount',     i.igst_amount,
           'cess_amount',     i.cess_amount,
           'total_amount',    i.total_amount
         )), '[]'::jsonb)
    INTO v_items
    FROM quotation_items i
   WHERE i.quotation_id = q.id;

  v_header := jsonb_build_object(
    'customer_id',     q.customer_id,
    'invoice_date',    CURRENT_DATE,
    'subtotal',        q.subtotal,
    'discount_amount', q.discount_amount,
    'taxable_amount',  q.taxable_amount,
    'cgst_amount',     q.cgst_amount,
    'sgst_amount',     q.sgst_amount,
    'igst_amount',     q.igst_amount,
    'cess_amount',     q.cess_amount,
    'round_off',       q.round_off,
    'grand_total',     q.grand_total,
    'notes',           concat_ws(' — ', nullif(q.notes, ''), 'Converted from quotation ' || q.quotation_number),
    'terms',           q.terms
  );

  SELECT invoice_id, journal_entry_id
    INTO v_inv_id, v_je_id
    FROM create_sales_invoice(q.business_id, v_header, v_items, 'issued');

  SELECT invoice_number INTO v_number
    FROM sales_invoices
   WHERE id = v_inv_id;

  UPDATE quotations
     SET status = 'converted',
         converted_doc_id = v_inv_id,
         updated_at = now()
   WHERE id = q.id;

  INSERT INTO audit_logs (
    business_id, user_id, action, entity_type, entity_id, description
  ) VALUES (
    q.business_id, auth.uid(), 'quotation_converted', 'quotation', q.id,
    'Quotation ' || q.quotation_number || ' converted to invoice ' || v_number
  );

  RETURN QUERY SELECT v_inv_id, v_number;
END;
$$;

-- ---------------------------------------------------------------------------
-- B. Sales Order -> Sales Invoice
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION convert_sales_order_to_invoice(
  p_sales_order_id uuid
)
RETURNS TABLE (document_id uuid, document_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s        record;
  v_header jsonb;
  v_items  jsonb;
  v_inv_id uuid;
  v_je_id  uuid;
  v_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO s
    FROM sales_orders
   WHERE id = p_sales_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales order not found';
  END IF;

  IF NOT is_business_member(s.business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF NOT can_write_business(s.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF s.converted_doc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Sales order % was already converted to document %', s.order_number, s.converted_doc_id;
  END IF;
  IF s.status <> 'fulfilled' THEN
    RAISE EXCEPTION 'Only FULFILLED sales orders can be converted; order % is currently %', s.order_number, s.status;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id',      i.product_id,
           'product_name',    i.product_name,
           'hsn_sac',         i.hsn_sac,
           'quantity',        i.quantity,
           'unit',            i.unit,
           'rate',            i.rate,
           'discount_amount', i.discount_amount,
           'tax_rate',        i.tax_rate,
           'taxable_amount',  i.taxable_amount,
           'cgst_amount',     i.cgst_amount,
           'sgst_amount',     i.sgst_amount,
           'igst_amount',     i.igst_amount,
           'cess_amount',     i.cess_amount,
           'total_amount',    i.total_amount
         )), '[]'::jsonb)
    INTO v_items
    FROM sales_order_items i
   WHERE i.sales_order_id = s.id;

  v_header := jsonb_build_object(
    'customer_id',     s.customer_id,
    'invoice_date',    CURRENT_DATE,
    'subtotal',        s.subtotal,
    'discount_amount', s.discount_amount,
    'taxable_amount',  s.taxable_amount,
    'cgst_amount',     s.cgst_amount,
    'sgst_amount',     s.sgst_amount,
    'igst_amount',     s.igst_amount,
    'cess_amount',     s.cess_amount,
    'round_off',       s.round_off,
    'grand_total',     s.grand_total,
    'notes',           concat_ws(' — ', nullif(s.notes, ''), 'Converted from sales order ' || s.order_number)
  );

  SELECT invoice_id, journal_entry_id
    INTO v_inv_id, v_je_id
    FROM create_sales_invoice(s.business_id, v_header, v_items, 'issued');

  SELECT invoice_number INTO v_number
    FROM sales_invoices
   WHERE id = v_inv_id;

  UPDATE sales_orders
     SET status = 'converted',
         converted_doc_id = v_inv_id,
         updated_at = now()
   WHERE id = s.id;

  INSERT INTO audit_logs (
    business_id, user_id, action, entity_type, entity_id, description
  ) VALUES (
    s.business_id, auth.uid(), 'sales_order_converted', 'sales_order', s.id,
    'Sales order ' || s.order_number || ' converted to invoice ' || v_number
  );

  RETURN QUERY SELECT v_inv_id, v_number;
END;
$$;

-- ---------------------------------------------------------------------------
-- C. Purchase Order -> Purchase Bill
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION convert_purchase_order_to_bill(
  p_purchase_order_id uuid
)
RETURNS TABLE (document_id uuid, document_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p        record;
  v_header jsonb;
  v_items  jsonb;
  v_bill_id uuid;
  v_je_id  uuid;
  v_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO p
    FROM purchase_orders
   WHERE id = p_purchase_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;

  IF NOT is_business_member(p.business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF NOT can_write_business(p.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p.converted_doc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase order % was already converted to document %', p.order_number, p.converted_doc_id;
  END IF;
  IF p.status <> 'received' THEN
    RAISE EXCEPTION 'Only RECEIVED purchase orders can be converted; order % is currently %', p.order_number, p.status;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id',      i.product_id,
           'product_name',    i.product_name,
           'hsn_sac',         i.hsn_sac,
           'quantity',        i.quantity,
           'unit',            i.unit,
           'rate',            i.rate,
           'discount_amount', i.discount_amount,
           'tax_rate',        i.tax_rate,
           'taxable_amount',  i.taxable_amount,
           'cgst_amount',     i.cgst_amount,
           'sgst_amount',     i.sgst_amount,
           'igst_amount',     i.igst_amount,
           'cess_amount',     i.cess_amount,
           'total_amount',    i.total_amount
         )), '[]'::jsonb)
    INTO v_items
    FROM purchase_order_items i
   WHERE i.purchase_order_id = p.id;

  v_header := jsonb_build_object(
    'supplier_id',     p.supplier_id,
    'bill_date',       CURRENT_DATE,
    'subtotal',        p.subtotal,
    'discount_amount', p.discount_amount,
    'taxable_amount',  p.taxable_amount,
    'cgst_amount',     p.cgst_amount,
    'sgst_amount',     p.sgst_amount,
    'igst_amount',     p.igst_amount,
    'cess_amount',     p.cess_amount,
    'round_off',       p.round_off,
    'grand_total',     p.grand_total,
    'notes',           concat_ws(' — ', nullif(p.notes, ''), 'Converted from purchase order ' || p.order_number)
  );

  SELECT bill_id, journal_entry_id
    INTO v_bill_id, v_je_id
    FROM create_purchase_bill(p.business_id, v_header, v_items, 'confirmed');

  SELECT bill_number INTO v_number
    FROM purchase_bills
   WHERE id = v_bill_id;

  UPDATE purchase_orders
     SET status = 'converted',
         converted_doc_id = v_bill_id,
         updated_at = now()
   WHERE id = p.id;

  INSERT INTO audit_logs (
    business_id, user_id, action, entity_type, entity_id, description
  ) VALUES (
    p.business_id, auth.uid(), 'purchase_order_converted', 'purchase_order', p.id,
    'Purchase order ' || p.order_number || ' converted to bill ' || v_number
  );

  RETURN QUERY SELECT v_bill_id, v_number;
END;
$$;

-- ---------------------------------------------------------------------------
-- D. Hardened grants (house pattern)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION convert_quotation_to_invoice(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION convert_quotation_to_invoice(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION convert_quotation_to_invoice(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION convert_sales_order_to_invoice(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION convert_sales_order_to_invoice(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION convert_sales_order_to_invoice(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION convert_purchase_order_to_bill(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION convert_purchase_order_to_bill(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION convert_purchase_order_to_bill(uuid) TO authenticated;

COMMENT ON FUNCTION convert_quotation_to_invoice(uuid) IS
  'Converts an ACCEPTED quotation into a live sales invoice via the canonical 017 save path; marks source converted + deep-link id; single transaction.';
COMMENT ON FUNCTION convert_sales_order_to_invoice(uuid) IS
  'Converts a FULFILLED sales order into a live sales invoice via the canonical 017 save path; marks source converted + deep-link id; single transaction.';
COMMENT ON FUNCTION convert_purchase_order_to_bill(uuid) IS
  'Converts a RECEIVED purchase order into a confirmed purchase bill via the canonical 017 save path; marks source converted + deep-link id; single transaction.';
