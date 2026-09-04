/*
# 017 — Transactional document save & cancel RPCs (T14, arbitration §J4)

One-call, one-transaction replacements for the 3-5 request client chains
(R6) with server-side stock RMW (R11). Clients keep identical payload
shapes to today's pages, minus the manual numbering and follow-up writes.

## create_sales_invoice(p_business_id uuid, p_invoice jsonb, p_items jsonb)
RETURNS TABLE (invoice_id uuid, journal_entry_id uuid)
1. Guards: authenticated; can_write_business; >=1 item; every item has
   product_name and quantity > 0; p_invoice->>'status' must be 'issued'
   (draft flow intentionally out of scope until a draft lifecycle task).
2. Numbering: explicit number registered via register_document_number
   (UNIQUE backstop), otherwise next_document_number('INV/...').
3. Insert sales_invoices row (status 'issued', payment_status 'unpaid',
   balance_amount = grand_total, created_by = caller).
4. Insert all items.
5. Stock per item with a product of type='product': lock product row,
   single UPDATE current_stock = old - qty, write stock_movements
   ('sale', signed -qty, balance_after from RETURNING). Behaviour parity:
   negative stock still allowed (floor policy is a later task).
   Service products never touch stock. Products of another business are
   rejected by the scoped SELECT, not silently skipped.
6. audit_logs row 'invoice_created' (parity with today's client write).
7. post_sales_invoice_journal in the same transaction — any failure above
   rolls back EVERYTHING (fixes issued-without-JE / stock-without-invoice).

## create_purchase_bill(...) mirror: type 'purchase', +qty, BILL numbers,
   status 'confirmed' (schema's live state for bills).

## cancel_sales_invoice(p_invoice_id uuid) RETURNS uuid (reversal JE id)
§J2 machine: draft → cancelled (no JE to reverse, returns NULL);
issued → cancelled + reverse_sales_invoice_journal; anything paid /
partially_paid / cancelled / void is rejected — refunds belong to the
future CN flow. cancel_purchase_bill mirrors with 'confirmed'.
Amounts are left untouched on cancel (history reads by status).

All functions SECURITY DEFINER, search_path pinned, grants hardened.
*/

-- ============================================================================
-- Transactional sales invoice creation
-- ============================================================================
CREATE OR REPLACE FUNCTION create_sales_invoice(
  p_business_id uuid,
  p_invoice jsonb,
  p_items jsonb
)
RETURNS TABLE (invoice_id uuid, journal_entry_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_number text;
  v_invoice_id uuid;
  v_je_id uuid;
  v_item jsonb;
  v_pid uuid;
  v_stock numeric;
  v_bal numeric;
  v_qty numeric;
  v_grand_total numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Invoice must have at least one item';
  END IF;

  IF COALESCE(p_invoice->>'status', 'issued') <> 'issued' THEN
    RAISE EXCEPTION 'Only status ''issued'' is supported by this RPC';
  END IF;

  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    IF COALESCE(v_item->>'product_name', '') = '' THEN
      RAISE EXCEPTION 'Every item needs a product name';
    END IF;
    IF COALESCE((v_item->>'quantity')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Item % needs a positive quantity', v_item->>'product_name';
    END IF;
  END LOOP;

  v_grand_total := COALESCE((p_invoice->>'grand_total')::numeric, 0);

  -- Numbering: explicit wins (registered, UNIQUE-guarded), else service
  v_invoice_number := COALESCE(
    nullif(btrim(COALESCE(p_invoice->>'invoice_number', '')), ''),
    next_document_number(p_business_id, 'sales_invoice', COALESCE((p_invoice->>'invoice_date')::date, CURRENT_DATE))
  );
  IF p_invoice->>'invoice_number' IS NOT NULL AND nullif(btrim(p_invoice->>'invoice_number'), '') IS NOT NULL THEN
    PERFORM register_document_number(p_business_id, 'sales_invoice', v_invoice_number);
  END IF;

  INSERT INTO sales_invoices (
    business_id, customer_id, invoice_number, invoice_date, due_date,
    place_of_supply, subtotal, discount_amount, taxable_amount,
    cgst_amount, sgst_amount, igst_amount, cess_amount, round_off,
    grand_total, paid_amount, balance_amount, payment_status, status,
    payment_method, notes, terms, created_by
  ) VALUES (
    p_business_id,
    (p_invoice->>'customer_id')::uuid,
    v_invoice_number,
    COALESCE((p_invoice->>'invoice_date')::date, CURRENT_DATE),
    (p_invoice->>'due_date')::date,
    p_invoice->>'place_of_supply',
    COALESCE((p_invoice->>'subtotal')::numeric, 0),
    COALESCE((p_invoice->>'discount_amount')::numeric, 0),
    COALESCE((p_invoice->>'taxable_amount')::numeric, 0),
    COALESCE((p_invoice->>'cgst_amount')::numeric, 0),
    COALESCE((p_invoice->>'sgst_amount')::numeric, 0),
    COALESCE((p_invoice->>'igst_amount')::numeric, 0),
    COALESCE((p_invoice->>'cess_amount')::numeric, 0),
    COALESCE((p_invoice->>'round_off')::numeric, 0),
    v_grand_total,
    0,
    v_grand_total,
    'unpaid',
    'issued',
    nullif(p_invoice->>'payment_method', ''),
    nullif(p_invoice->>'notes', ''),
    nullif(p_invoice->>'terms', ''),
    auth.uid()
  )
  RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    INSERT INTO sales_invoice_items (
      business_id, invoice_id, product_id, product_name, hsn_sac,
      quantity, unit, rate, discount_amount, tax_rate, taxable_amount,
      cgst_amount, sgst_amount, igst_amount, cess_amount, total_amount
    ) VALUES (
      p_business_id,
      v_invoice_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      nullif(v_item->>'hsn_sac', ''),
      (v_item->>'quantity')::numeric,
      COALESCE(nullif(v_item->>'unit', ''), 'PCS'),
      COALESCE((v_item->>'rate')::numeric, 0),
      COALESCE((v_item->>'discount_amount')::numeric, 0),
      COALESCE((v_item->>'tax_rate')::numeric, 0),
      COALESCE((v_item->>'taxable_amount')::numeric, 0),
      COALESCE((v_item->>'cgst_amount')::numeric, 0),
      COALESCE((v_item->>'sgst_amount')::numeric, 0),
      COALESCE((v_item->>'igst_amount')::numeric, 0),
      COALESCE((v_item->>'cess_amount')::numeric, 0),
      COALESCE((v_item->>'total_amount')::numeric, 0)
    );

    -- Server-side stock movement (R11): no client read-modify-write
    v_pid := (v_item->>'product_id')::uuid;
    IF v_pid IS NOT NULL THEN
      SELECT current_stock INTO v_stock
      FROM products
      WHERE id = v_pid AND business_id = p_business_id AND type = 'product'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found in this business', COALESCE(v_item->>'product_name', v_pid::text);
      END IF;

      v_qty := (v_item->>'quantity')::numeric;

      UPDATE products
      SET current_stock = round(current_stock - v_qty, 2)
      WHERE id = v_pid
      RETURNING current_stock INTO v_bal;

      INSERT INTO stock_movements (
        business_id, product_id, type, quantity, balance_after,
        reference_type, reference_id, notes, created_by
      ) VALUES (
        p_business_id, v_pid, 'sale', -v_qty, v_bal,
        'sales_invoice', v_invoice_id, 'Invoice ' || v_invoice_number, auth.uid()
      );
    END IF;
  END LOOP;

  INSERT INTO audit_logs (
    business_id, user_id, action, entity_type, entity_id, description
  ) VALUES (
    p_business_id, auth.uid(), 'invoice_created', 'sales_invoice', v_invoice_id,
    'Invoice ' || v_invoice_number || ' created via transactional RPC'
  );

  v_je_id := post_sales_invoice_journal(v_invoice_id);

  RETURN QUERY SELECT v_invoice_id, v_je_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_sales_invoice(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_sales_invoice(uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION create_sales_invoice(uuid, jsonb, jsonb) TO authenticated;

-- ============================================================================
-- Transactional purchase bill creation (mirror)
-- ============================================================================
CREATE OR REPLACE FUNCTION create_purchase_bill(
  p_business_id uuid,
  p_bill jsonb,
  p_items jsonb
)
RETURNS TABLE (bill_id uuid, journal_entry_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill_number text;
  v_bill_id uuid;
  v_je_id uuid;
  v_item jsonb;
  v_pid uuid;
  v_stock numeric;
  v_bal numeric;
  v_qty numeric;
  v_grand_total numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must have at least one item';
  END IF;

  IF COALESCE(p_bill->>'status', 'confirmed') NOT IN ('confirmed') THEN
    RAISE EXCEPTION 'Only status ''confirmed'' is supported by this RPC';
  END IF;

  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    IF COALESCE(v_item->>'product_name', '') = '' THEN
      RAISE EXCEPTION 'Every item needs a product name';
    END IF;
    IF COALESCE((v_item->>'quantity')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Item % needs a positive quantity', v_item->>'product_name';
    END IF;
  END LOOP;

  v_grand_total := COALESCE((p_bill->>'grand_total')::numeric, 0);

  v_bill_number := COALESCE(
    nullif(btrim(COALESCE(p_bill->>'bill_number', '')), ''),
    next_document_number(p_business_id, 'purchase_bill', COALESCE((p_bill->>'bill_date')::date, CURRENT_DATE))
  );
  IF p_bill->>'bill_number' IS NOT NULL AND nullif(btrim(p_bill->>'bill_number'), '') IS NOT NULL THEN
    PERFORM register_document_number(p_business_id, 'purchase_bill', v_bill_number);
  END IF;

  INSERT INTO purchase_bills (
    business_id, supplier_id, bill_number, bill_date, due_date,
    subtotal, discount_amount, taxable_amount,
    cgst_amount, sgst_amount, igst_amount, cess_amount, round_off,
    grand_total, paid_amount, balance_amount, payment_status, status,
    payment_method, notes, created_by
  ) VALUES (
    p_business_id,
    (p_bill->>'supplier_id')::uuid,
    v_bill_number,
    COALESCE((p_bill->>'bill_date')::date, CURRENT_DATE),
    (p_bill->>'due_date')::date,
    COALESCE((p_bill->>'subtotal')::numeric, 0),
    COALESCE((p_bill->>'discount_amount')::numeric, 0),
    COALESCE((p_bill->>'taxable_amount')::numeric, 0),
    COALESCE((p_bill->>'cgst_amount')::numeric, 0),
    COALESCE((p_bill->>'sgst_amount')::numeric, 0),
    COALESCE((p_bill->>'igst_amount')::numeric, 0),
    COALESCE((p_bill->>'cess_amount')::numeric, 0),
    COALESCE((p_bill->>'round_off')::numeric, 0),
    v_grand_total,
    0,
    v_grand_total,
    'unpaid',
    'confirmed',
    nullif(p_bill->>'payment_method', ''),
    nullif(p_bill->>'notes', ''),
    auth.uid()
  )
  RETURNING id INTO v_bill_id;

  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    INSERT INTO purchase_bill_items (
      business_id, bill_id, product_id, product_name, hsn_sac,
      quantity, unit, rate, discount_amount, tax_rate, taxable_amount,
      cgst_amount, sgst_amount, igst_amount, cess_amount, total_amount
    ) VALUES (
      p_business_id,
      v_bill_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      nullif(v_item->>'hsn_sac', ''),
      (v_item->>'quantity')::numeric,
      COALESCE(nullif(v_item->>'unit', ''), 'PCS'),
      COALESCE((v_item->>'rate')::numeric, 0),
      COALESCE((v_item->>'discount_amount')::numeric, 0),
      COALESCE((v_item->>'tax_rate')::numeric, 0),
      COALESCE((v_item->>'taxable_amount')::numeric, 0),
      COALESCE((v_item->>'cgst_amount')::numeric, 0),
      COALESCE((v_item->>'sgst_amount')::numeric, 0),
      COALESCE((v_item->>'igst_amount')::numeric, 0),
      COALESCE((v_item->>'cess_amount')::numeric, 0),
      COALESCE((v_item->>'total_amount')::numeric, 0)
    );

    -- Purchase brings stock IN (server-side RMW)
    v_pid := (v_item->>'product_id')::uuid;
    IF v_pid IS NOT NULL THEN
      SELECT current_stock INTO v_stock
      FROM products
      WHERE id = v_pid AND business_id = p_business_id AND type = 'product'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found in this business', COALESCE(v_item->>'product_name', v_pid::text);
      END IF;

      v_qty := (v_item->>'quantity')::numeric;

      UPDATE products
      SET current_stock = round(current_stock + v_qty, 2)
      WHERE id = v_pid
      RETURNING current_stock INTO v_bal;

      INSERT INTO stock_movements (
        business_id, product_id, type, quantity, balance_after,
        reference_type, reference_id, notes, created_by
      ) VALUES (
        p_business_id, v_pid, 'purchase', v_qty, v_bal,
        'purchase_bill', v_bill_id, 'Bill ' || v_bill_number, auth.uid()
      );
    END IF;
  END LOOP;

  INSERT INTO audit_logs (
    business_id, user_id, action, entity_type, entity_id, description
  ) VALUES (
    p_business_id, auth.uid(), 'bill_created', 'purchase_bill', v_bill_id,
    'Bill ' || v_bill_number || ' created via transactional RPC'
  );

  v_je_id := post_purchase_bill_journal(v_bill_id);

  RETURN QUERY SELECT v_bill_id, v_je_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_purchase_bill(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_purchase_bill(uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION create_purchase_bill(uuid, jsonb, jsonb) TO authenticated;

-- ============================================================================
-- §J2 cancel flows
-- ============================================================================
CREATE OR REPLACE FUNCTION cancel_sales_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_existing_reversal uuid;
BEGIN
  SELECT * INTO v_invoice FROM sales_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_invoice.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- §J2: money moved => cancellation blocked, refund via CN path
  IF v_invoice.paid_amount > 0 OR v_invoice.payment_status <> 'unpaid' THEN
    RAISE EXCEPTION 'Paid or partially paid invoices cannot be cancelled; use the credit-note flow';
  END IF;

  IF v_invoice.status = 'cancelled' OR v_invoice.status = 'void' THEN
    -- Immutable already: surface the existing reversal, if any
    SELECT id INTO v_existing_reversal
    FROM journal_entries
    WHERE business_id = v_invoice.business_id
      AND reference_type = 'sales_invoice_reversal'
      AND reference_id = p_invoice_id
    LIMIT 1;
    RETURN v_existing_reversal;
  END IF;

  IF v_invoice.status = 'draft' THEN
    UPDATE sales_invoices SET status = 'cancelled' WHERE id = p_invoice_id;
    RETURN NULL;  -- nothing was ever posted
  END IF;

  -- Live (issued): flip first — the reversal engine requires it — then reverse
  UPDATE sales_invoices SET status = 'cancelled' WHERE id = p_invoice_id;

  RETURN reverse_sales_invoice_journal(p_invoice_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_sales_invoice(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_sales_invoice(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_sales_invoice(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION cancel_purchase_bill(p_bill_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill RECORD;
  v_existing_reversal uuid;
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_bill.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- §J2: money moved => cancellation blocked, refund via debit-note path
  IF v_bill.paid_amount > 0 OR v_bill.payment_status <> 'unpaid' THEN
    RAISE EXCEPTION 'Paid or partially paid bills cannot be cancelled; use the debit-note flow';
  END IF;

  IF v_bill.status = 'cancelled' THEN
    SELECT id INTO v_existing_reversal
    FROM journal_entries
    WHERE business_id = v_bill.business_id
      AND reference_type = 'purchase_bill_reversal'
      AND reference_id = p_bill_id
    LIMIT 1;
    RETURN v_existing_reversal;
  END IF;

  IF v_bill.status = 'draft' THEN
    UPDATE purchase_bills SET status = 'cancelled' WHERE id = p_bill_id;
    RETURN NULL;
  END IF;

  UPDATE purchase_bills SET status = 'cancelled' WHERE id = p_bill_id;

  RETURN reverse_purchase_bill_journal(p_bill_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_purchase_bill(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_purchase_bill(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_purchase_bill(uuid) TO authenticated;
