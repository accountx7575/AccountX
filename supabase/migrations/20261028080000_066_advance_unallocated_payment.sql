/*
# 066 — Allow unallocated/advance payments on create_payment_with_allocation (PBS-220)

ALTER create_payment_with_allocation to accept p_allow_unallocated boolean DEFAULT false.
When p_allow_unallocated = true and a remainder remains after allocating to all
open documents, do NOT RAISE — record the payment with allocated_amount reflecting
what was allocated; the unallocated remainder stays as advance/on-account balance.
Keep STRICT FULL-ALLOCATION as the default (p_allow_unallocated = false).
Audit row reflects advance/unallocated status.
*/

CREATE OR REPLACE FUNCTION create_payment_with_allocation(
  p_business_id uuid,
  p_type text,
  p_party_id uuid,
  p_amount numeric,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_method text DEFAULT 'cash',
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_allow_unallocated boolean DEFAULT false
)
RETURNS TABLE (
  payment_id uuid,
  journal_entry_id uuid,
  allocated_total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid;
  v_pay_no text;
  v_je uuid;
  v_cash_bank uuid;
  v_party_ledger uuid;
  v_party_name text;
  v_party_type text;
  v_ref_type text;
  v_remaining numeric(14,2);
  v_alloc numeric(14,2);
  v_allocated_total numeric(14,2);
  r RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_type NOT IN ('received', 'made') THEN
    RAISE EXCEPTION 'Payment type must be received or made';
  END IF;

  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;

  IF p_method NOT IN ('cash', 'upi', 'bank', 'card', 'cheque') THEN
    RAISE EXCEPTION 'Unsupported payment method %', p_method;
  END IF;

  IF p_type = 'received' THEN
    v_party_type := 'customer';
    v_ref_type := 'sales_invoice';
    SELECT name INTO v_party_name FROM customers
    WHERE id = p_party_id AND business_id = p_business_id;
  ELSE
    v_party_type := 'supplier';
    v_ref_type := 'purchase_bill';
    SELECT name INTO v_party_name FROM suppliers
    WHERE id = p_party_id AND business_id = p_business_id;
  END IF;

  IF v_party_name IS NULL THEN
    RAISE EXCEPTION 'Party not found in this business';
  END IF;

  -- Payment row first: establishes 015's fixed lock order anchor
  v_pay_no := next_document_number(
    p_business_id,
    CASE WHEN p_type = 'received' THEN 'payment_received' ELSE 'payment_made' END,
    COALESCE(p_payment_date, CURRENT_DATE)
  );

  INSERT INTO payments (business_id, type, party_type, party_id,
    payment_number, date, amount, allocated_amount, payment_method,
    reference, notes, created_by)
  VALUES (p_business_id, p_type, v_party_type, p_party_id,
    v_pay_no, COALESCE(p_payment_date, CURRENT_DATE), round(p_amount, 2), 0,
    p_method, p_reference, p_notes, auth.uid())
  RETURNING id INTO v_pid;

  SELECT * INTO r FROM payments WHERE id = v_pid FOR UPDATE;

  -- Oldest-first walk over live unsettled documents, 015-delegated slices
  v_remaining := round(p_amount, 2);

  IF p_type = 'received' THEN
    FOR r IN
      SELECT id, GREATEST(balance_amount, 0) AS outstanding
      FROM sales_invoices
      WHERE business_id = p_business_id
        AND customer_id = p_party_id
        AND status IN ('issued', 'partially_paid')
        AND balance_amount > 0
      ORDER BY due_date ASC NULLS LAST, invoice_date ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_alloc := LEAST(v_remaining, r.outstanding);
      IF v_alloc > 0 THEN
        PERFORM allocate_payment(v_pid, 'sales_invoice', r.id, v_alloc);
        v_remaining := v_remaining - v_alloc;
      END IF;
    END LOOP;
  ELSE
    FOR r IN
      SELECT id, GREATEST(balance_amount, 0) AS outstanding
      FROM purchase_bills
      WHERE business_id = p_business_id
        AND supplier_id = p_party_id
        AND status IN ('confirmed', 'partially_paid')
        AND balance_amount > 0
      ORDER BY due_date ASC NULLS LAST, bill_date ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_alloc := LEAST(v_remaining, r.outstanding);
      IF v_alloc > 0 THEN
        PERFORM allocate_payment(v_pid, 'purchase_bill', r.id, v_alloc);
        v_remaining := v_remaining - v_alloc;
      END IF;
    END LOOP;
  END IF;

  -- STRICT FULL-ALLOCATION default: any remainder RAISES unless opted in
  IF v_remaining > 0 THEN
    IF NOT p_allow_unallocated THEN
      RAISE EXCEPTION 'Shortfall: % of payment could not be allocated to open documents',
        v_remaining;
    END IF;
    -- Advance/unallocated: remainder stays unallocated; allocated_amount already
    -- reflects what allocate_payment() wrote.
    SELECT COALESCE(SUM(allocated_amount), 0) INTO v_allocated_total
    FROM payments WHERE id = v_pid;
  ELSE
    v_allocated_total := round(p_amount, 2);
  END IF;

  -- Journal at full payment amount (house m008/m009 conventions)
  IF p_type = 'received' THEN
    v_party_ledger := find_or_create_account(p_business_id, v_party_name, 'Sundry Debtors');
    v_cash_bank := find_or_create_account(p_business_id,
      CASE WHEN p_method = 'cash' THEN 'Cash' ELSE 'Bank' END, 'Cash & Bank');

    INSERT INTO journal_entries (business_id, entry_number, date, narration,
      total_debit, total_credit, status, reference_type, reference_id, created_by)
    VALUES (p_business_id, 'JE-' || v_pay_no, COALESCE(p_payment_date, CURRENT_DATE),
      'Payment received ' || v_pay_no || ' from ' || v_party_name,
      round(p_amount, 2), round(p_amount, 2),
      'posted', 'payment_received', v_pid, auth.uid())
    RETURNING id INTO v_je;

    INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
    VALUES (p_business_id, v_je, v_cash_bank, round(p_amount, 2), 0),
           (p_business_id, v_je, v_party_ledger, 0, round(p_amount, 2));
  ELSE
    v_party_ledger := find_or_create_account(p_business_id, v_party_name, 'Sundry Creditors');
    v_cash_bank := find_or_create_account(p_business_id,
      CASE WHEN p_method = 'cash' THEN 'Cash' ELSE 'Bank' END, 'Cash & Bank');

    INSERT INTO journal_entries (business_id, entry_number, date, narration,
      total_debit, total_credit, status, reference_type, reference_id, created_by)
    VALUES (p_business_id, 'JE-' || v_pay_no, COALESCE(p_payment_date, CURRENT_DATE),
      'Payment made ' || v_pay_no || ' to ' || v_party_name,
      round(p_amount, 2), round(p_amount, 2),
      'posted', 'payment_made', v_pid, auth.uid())
    RETURNING id INTO v_je;

    INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
    VALUES (p_business_id, v_je, v_party_ledger, round(p_amount, 2), 0),
           (p_business_id, v_je, v_cash_bank, 0, round(p_amount, 2));
  END IF;

  INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
  VALUES (p_business_id, auth.uid(),
    CASE WHEN p_type = 'received' THEN 'payment_received_created' ELSE 'payment_made_created' END,
    'payment', v_pid,
    'Payment ' || v_pay_no || ' of ' || round(p_amount, 2)::text ||
    CASE WHEN v_remaining > 0 THEN ' (' || v_remaining::text || ' unallocated / advance)' ELSE ' fully allocated and posted' END);

  RETURN QUERY SELECT v_pid, v_je, COALESCE(v_allocated_total, round(p_amount, 2));
END;
$$;

REVOKE EXECUTE ON FUNCTION create_payment_with_allocation(uuid, text, uuid, numeric, date, text, text, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_payment_with_allocation(uuid, text, uuid, numeric, date, text, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION create_payment_with_allocation(uuid, text, uuid, numeric, date, text, text, text, boolean) TO authenticated;
