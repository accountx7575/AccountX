-- 046: document conversion RPCs (T88) - the "later card" promised by 026
-- Reuses create_sales_invoice / create_purchase_bill INTERNALLY so invoice/bill
-- math, numbering, journal posting and server-side stock movements are exactly
-- the 017 path (J1 identity preserved; no parallel math).
--
-- Status machines (026): only live pre-conversion states may convert.
--   quotations      sent|accepted  -> converted (draft/rejected/cancelled blocked)
--   sales_orders    confirmed|fulfilled -> converted
--   purchase_orders confirmed|received  -> converted
-- Double conversion impossible: source row is locked FOR UPDATE, status is
-- re-checked under that lock, and the final UPDATE guards on status again.
-- Linkage: 026 already provides converted_doc_id on all three tables.

-- ============================================================================
-- A. QUOTATION -> SALES INVOICE
-- ============================================================================
CREATE OR REPLACE FUNCTION convert_quotation_to_invoice(
  p_business_id uuid,
  p_quotation_id uuid,
  p_invoice_date date DEFAULT CURRENT_DATE,
  p_due_date date DEFAULT NULL
)
RETURNS TABLE (new_doc_id uuid, new_doc_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q quotations;
  v_expected text[] := ARRAY['sent','accepted']::text[];
  v_items jsonb;
  v_inv jsonb;
  v_created record;
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id',      it.product_id,
           'product_name',    it.product_name,
           'hsn_sac',         it.hsn_sac,
           'quantity',        it.quantity,
           'unit',            it.unit,
           'rate',            it.rate,
           'discount_amount', it.discount_amount,
           'tax_rate',        it.tax_rate,
           'taxable_amount',  it.taxable_amount,
           'cgst_amount',     it.cgst_amount,
           'sgst_amount',     it.sgst_amount,
           'igst_amount',     it.igst_amount,
           'cess_amount',     it.cess_amount,
           'total_amount',    it.total_amount
         ) ORDER BY it.created_at, it.id), '[]'::jsonb)
  INTO v_items
  FROM quotation_items it
  WHERE it.quotation_id = v_q.id;

  v_inv := jsonb_build_object(
    'status',          'issued',
    'customer_id',     v_q.customer_id,
    'invoice_date',    COALESCE(p_invoice_date, CURRENT_DATE),
    'due_date',        p_due_date,
    'subtotal',        v_q.subtotal,
    'discount_amount', v_q.discount_amount,
    'taxable_amount',  v_q.taxable_amount,
    'cgst_amount',     v_q.cgst_amount,
    'sgst_amount',     v_q.sgst_amount,
    'igst_amount',     v_q.igst_amount,
    'cess_amount',     v_q.cess_amount,
    'round_off',       v_q.round_off,
    'grand_total',     v_q.grand_total,
    'notes',           v_q.notes,
    'terms',           v_q.terms
  );

  SELECT invoice_id, invoice_number INTO v_created
  FROM create_sales_invoice(p_business_id, v_inv, v_items);

  UPDATE quotations
  SET status = 'converted', converted_doc_id = v_created.invoice_id, updated_at = now()
  WHERE id = v_q.id AND status = ANY(v_expected);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation state changed during conversion - retry';
  END IF;

  RETURN QUERY SELECT v_created.invoice_id, v_created.invoice_number;
END;
$$;

-- ============================================================================
-- B. SALES ORDER -> SALES INVOICE
-- ============================================================================
CREATE OR REPLACE FUNCTION convert_sales_order_to_invoice(
  p_business_id uuid,
  p_order_id uuid,
  p_invoice_date date DEFAULT CURRENT_DATE,
  p_due_date date DEFAULT NULL
)
RETURNS TABLE (new_doc_id uuid, new_doc_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_o sales_orders;
  v_expected text[] := ARRAY['confirmed','fulfilled']::text[];
  v_items jsonb;
  v_inv jsonb;
  v_created record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_o FROM sales_orders
  WHERE id = p_order_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales order not found in this business';
  END IF;
  IF v_o.status = 'converted' OR v_o.converted_doc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Sales order % has already been converted', v_o.order_number;
  END IF;
  IF NOT v_o.status = ANY(v_expected) THEN
    RAISE EXCEPTION 'Only confirmed or fulfilled sales orders can be converted (current status: %)', v_o.status;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id',      it.product_id,
           'product_name',    it.product_name,
           'hsn_sac',         it.hsn_sac,
           'quantity',        it.quantity,
           'unit',            it.unit,
           'rate',            it.rate,
           'discount_amount', it.discount_amount,
           'tax_rate',        it.tax_rate,
           'taxable_amount',  it.taxable_amount,
           'cgst_amount',     it.cgst_amount,
           'sgst_amount',     it.sgst_amount,
           'igst_amount',     it.igst_amount,
           'cess_amount',     it.cess_amount,
           'total_amount',    it.total_amount
         ) ORDER BY it.created_at, it.id), '[]'::jsonb)
  INTO v_items
  FROM sales_order_items it
  WHERE it.sales_order_id = v_o.id;

  v_inv := jsonb_build_object(
    'status',          'issued',
    'customer_id',     v_o.customer_id,
    'invoice_date',    COALESCE(p_invoice_date, CURRENT_DATE),
    'due_date',        p_due_date,
    'subtotal',        v_o.subtotal,
    'discount_amount', v_o.discount_amount,
    'taxable_amount',  v_o.taxable_amount,
    'cgst_amount',     v_o.cgst_amount,
    'sgst_amount',     v_o.sgst_amount,
    'igst_amount',     v_o.igst_amount,
    'cess_amount',     v_o.cess_amount,
    'round_off',       v_o.round_off,
    'grand_total',     v_o.grand_total,
    'notes',           v_o.notes
  );

  SELECT invoice_id, invoice_number INTO v_created
  FROM create_sales_invoice(p_business_id, v_inv, v_items);

  UPDATE sales_orders
  SET status = 'converted', converted_doc_id = v_created.invoice_id, updated_at = now()
  WHERE id = v_o.id AND status = ANY(v_expected);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales order state changed during conversion - retry';
  END IF;

  RETURN QUERY SELECT v_created.invoice_id, v_created.invoice_number;
END;
$$;

-- ============================================================================
-- C. PURCHASE ORDER -> PURCHASE BILL
-- ============================================================================
CREATE OR REPLACE FUNCTION convert_purchase_order_to_bill(
  p_business_id uuid,
  p_order_id uuid,
  p_bill_date date DEFAULT CURRENT_DATE,
  p_due_date date DEFAULT NULL
)
RETURNS TABLE (new_doc_id uuid, new_doc_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_o purchase_orders;
  v_expected text[] := ARRAY['confirmed','received']::text[];
  v_items jsonb;
  v_bill jsonb;
  v_created record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_o FROM purchase_orders
  WHERE id = p_order_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found in this business';
  END IF;
  IF v_o.status = 'converted' OR v_o.converted_doc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase order % has already been converted', v_o.order_number;
  END IF;
  IF NOT v_o.status = ANY(v_expected) THEN
    RAISE EXCEPTION 'Only confirmed or received purchase orders can be converted (current status: %)', v_o.status;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id',      it.product_id,
           'product_name',    it.product_name,
           'hsn_sac',         it.hsn_sac,
           'quantity',        it.quantity,
           'unit',            it.unit,
           'rate',            it.rate,
           'discount_amount', it.discount_amount,
           'tax_rate',        it.tax_rate,
           'taxable_amount',  it.taxable_amount,
           'cgst_amount',     it.cgst_amount,
           'sgst_amount',     it.sgst_amount,
           'igst_amount',     it.igst_amount,
           'cess_amount',     it.cess_amount,
           'total_amount',    it.total_amount
         ) ORDER BY it.created_at, it.id), '[]'::jsonb)
  INTO v_items
  FROM purchase_order_items it
  WHERE it.purchase_order_id = v_o.id;

  v_bill := jsonb_build_object(
    'status',          'confirmed',
    'supplier_id',     v_o.supplier_id,
    'bill_date',       COALESCE(p_bill_date, CURRENT_DATE),
    'due_date',        p_due_date,
    'subtotal',        v_o.subtotal,
    'discount_amount', v_o.discount_amount,
    'taxable_amount',  v_o.taxable_amount,
    'cgst_amount',     v_o.cgst_amount,
    'sgst_amount',     v_o.sgst_amount,
    'igst_amount',     v_o.igst_amount,
    'cess_amount',     v_o.cess_amount,
    'round_off',       v_o.round_off,
    'grand_total',     v_o.grand_total,
    'notes',           v_o.notes
  );

  SELECT bill_id, bill_number INTO v_created
  FROM create_purchase_bill(p_business_id, v_bill, v_items);

  UPDATE purchase_orders
  SET status = 'converted', converted_doc_id = v_created.bill_id, updated_at = now()
  WHERE id = v_o.id AND status = ANY(v_expected);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order state changed during conversion - retry';
  END IF;

  RETURN QUERY SELECT v_created.bill_id, v_created.bill_number;
END;
$$;
