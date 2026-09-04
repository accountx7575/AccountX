/*
# 015 — Payment allocation integrity (T12)

Hardens allocate_payment against audit risk R5. Contract per master §J2:
payments may allocate ONLY against LIVE documents with outstanding > 0;
under-allocation is an ERROR, never a silent partial success.

## Changes (behaviour preserved for valid, fully-covering allocations)
1. Row locking: the payment AND the target document are SELECT ... FOR
   UPDATE, so two concurrent allocations of one payment or against one
   document serialise instead of double-spending unapplied/outstanding.
   Lock order is always payment -> document (single entry point), so no
   lock-cycle deadlock is reachable through this RPC.
2. Status guard: sales invoices must be 'issued'/'partially_paid';
   purchase bills 'confirmed'/'partially_paid' (schema reality per §J2
   ENUM REALITY). Draft / cancelled / void / already-paid documents are
   rejected by name.
3. Explicit under-allocation: previously LEAST(p_amount, unapplied,
   outstanding) silently allocated less while callers toasted success.
   Now any shortfall RAISEs with requested/unapplied/outstanding figures,
   and a fully-settled document gets its own message. Callers finally get
   a real error to surface (client surfacing is Stanley's T-batch).
4. Zero/negative outstanding guard before arithmetic.

Return value remains numeric (now always equals p_amount on success).
Statics: single $$ body, IF/END IF balanced.
*/

CREATE OR REPLACE FUNCTION allocate_payment(
  p_payment_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_unapplied numeric;
  v_outstanding numeric;
  v_allocate numeric;
  v_new_paid numeric;
  v_new_balance numeric;
  v_pay_status text;
  v_new_status text;
  v_grand_total numeric;
  v_current_paid numeric;
  v_current_status text;
BEGIN
  -- Lock the payment row first (fixed lock order: payment -> document)
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_payment.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Allocation amount must be positive';
  END IF;

  -- Unapplied = total payment amount minus already-allocated
  v_unapplied := v_payment.amount - v_payment.allocated_amount;

  IF v_unapplied <= 0 THEN
    RAISE EXCEPTION 'Payment has no unapplied balance';
  END IF;

  IF p_reference_type = 'sales_invoice' THEN
    IF v_payment.type != 'received' OR v_payment.party_type != 'customer' THEN
      RAISE EXCEPTION 'Payment type does not match sales invoice allocation';
    END IF;

    -- Lock the document row against concurrent allocations
    SELECT grand_total, paid_amount, balance_amount, status
      INTO v_grand_total, v_current_paid, v_outstanding, v_current_status
    FROM sales_invoices WHERE id = p_reference_id AND business_id = v_payment.business_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;

    -- J2: only live, unsettled invoices may receive allocations
    IF v_current_status NOT IN ('issued', 'partially_paid') THEN
      RAISE EXCEPTION 'Cannot allocate against invoice in status %', v_current_status;
    END IF;

    IF v_outstanding <= 0 THEN
      RAISE EXCEPTION 'Invoice has no outstanding balance';
    END IF;

    v_allocate := LEAST(p_amount, v_unapplied, v_outstanding);

    -- R5: never allocate silently less than requested
    IF v_allocate < p_amount THEN
      RAISE EXCEPTION 'Insufficient balance for allocation: requested %, payment unapplied %, invoice outstanding %',
        p_amount, v_unapplied, v_outstanding;
    END IF;

    v_new_paid := v_current_paid + v_allocate;
    v_new_balance := v_grand_total - v_new_paid;
    v_pay_status := CASE WHEN v_new_balance <= 0 THEN 'paid' ELSE 'partial' END;
    v_new_status := CASE
      WHEN v_pay_status = 'paid' THEN 'paid'
      ELSE CASE WHEN v_current_status = 'issued' THEN 'partially_paid' ELSE v_current_status END
    END;

    UPDATE sales_invoices
      SET paid_amount = v_new_paid,
          balance_amount = v_new_balance,
          payment_status = v_pay_status,
          status = v_new_status
    WHERE id = p_reference_id;

  ELSIF p_reference_type = 'purchase_bill' THEN
    IF v_payment.type != 'made' OR v_payment.party_type != 'supplier' THEN
      RAISE EXCEPTION 'Payment type does not match purchase bill allocation';
    END IF;

    -- Lock the document row against concurrent allocations
    SELECT grand_total, paid_amount, balance_amount, status
      INTO v_grand_total, v_current_paid, v_outstanding, v_current_status
    FROM purchase_bills WHERE id = p_reference_id AND business_id = v_payment.business_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bill not found';
    END IF;

    -- J2: only live, unsettled bills may receive allocations
    IF v_current_status NOT IN ('confirmed', 'partially_paid') THEN
      RAISE EXCEPTION 'Cannot allocate against bill in status %', v_current_status;
    END IF;

    IF v_outstanding <= 0 THEN
      RAISE EXCEPTION 'Bill has no outstanding balance';
    END IF;

    v_allocate := LEAST(p_amount, v_unapplied, v_outstanding);

    -- R5: never allocate silently less than requested
    IF v_allocate < p_amount THEN
      RAISE EXCEPTION 'Insufficient balance for allocation: requested %, payment unapplied %, bill outstanding %',
        p_amount, v_unapplied, v_outstanding;
    END IF;

    v_new_paid := v_current_paid + v_allocate;
    v_new_balance := v_grand_total - v_new_paid;
    v_pay_status := CASE WHEN v_new_balance <= 0 THEN 'paid' ELSE 'partial' END;
    v_new_status := CASE
      WHEN v_pay_status = 'paid' THEN 'paid'
      ELSE CASE WHEN v_current_status = 'confirmed' THEN 'partially_paid' ELSE v_current_status END
    END;

    UPDATE purchase_bills
      SET paid_amount = v_new_paid,
          balance_amount = v_new_balance,
          payment_status = v_pay_status,
          status = v_new_status
    WHERE id = p_reference_id;

  ELSE
    RAISE EXCEPTION 'Invalid reference type';
  END IF;

  -- Update the payment's allocated amount and link it
  UPDATE payments
    SET allocated_amount = v_payment.allocated_amount + v_allocate,
        invoice_id = CASE WHEN p_reference_type = 'sales_invoice' THEN p_reference_id ELSE invoice_id END,
        bill_id = CASE WHEN p_reference_type = 'purchase_bill' THEN p_reference_id ELSE bill_id END
  WHERE id = p_payment_id;

  RETURN v_allocate;
END;
$$;

REVOKE EXECUTE ON FUNCTION allocate_payment FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION allocate_payment FROM anon;
GRANT EXECUTE ON FUNCTION allocate_payment TO authenticated;
