/*
# Payment Allocation

Adds `allocated_amount` column to payments table and a SECURITY DEFINER
function `allocate_payment` that atomically allocates a payment to an
invoice or bill, preventing overpayment and tracking unapplied amounts.

## allocate_payment(p_payment_id, p_reference_type, p_reference_id, p_amount)
- p_reference_type: 'sales_invoice' or 'purchase_bill'
- p_reference_id: the invoice/bill id
- p_amount: amount to allocate (capped at payment's unapplied balance
  and the invoice/bill's outstanding balance)
- Updates the payment's allocated_amount
- Updates the invoice/bill's paid_amount, balance_amount, payment_status, status
- Returns the actual allocated amount

## Security
- SECURITY DEFINER, fixed search_path = public
- EXECUTE revoked from PUBLIC and anon, granted to authenticated
- Caller must have write access (can_write_business)
- All existing RLS remains intact
*/

ALTER TABLE payments ADD COLUMN IF NOT EXISTS allocated_amount numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE payments ADD CONSTRAINT payments_allocated_check
  CHECK (allocated_amount >= 0 AND allocated_amount <= amount);

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
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
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

    SELECT grand_total, paid_amount, balance_amount, status
      INTO v_grand_total, v_current_paid, v_outstanding, v_current_status
    FROM sales_invoices WHERE id = p_reference_id AND business_id = v_payment.business_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;

    v_allocate := LEAST(p_amount, v_unapplied, v_outstanding);

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

    SELECT grand_total, paid_amount, balance_amount, status
      INTO v_grand_total, v_current_paid, v_outstanding, v_current_status
    FROM purchase_bills WHERE id = p_reference_id AND business_id = v_payment.business_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bill not found';
    END IF;

    v_allocate := LEAST(p_amount, v_unapplied, v_outstanding);

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
