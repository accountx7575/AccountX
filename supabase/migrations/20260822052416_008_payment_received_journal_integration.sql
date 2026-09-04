/*
# Payment Received Journal Integration

Adds a SECURITY DEFINER function that posts the accounting journal entry
for a customer payment received, atomically and duplicate-safe.

## post_payment_received_journal(p_payment_id)
- Loads the payment (must be type='received', party_type='customer')
- Checks no existing journal entry with reference_type='payment_received' + reference_id = payment id
- Finds or creates a Cash & Bank account ("Cash" for cash, "Bank" for all other methods)
- Finds or creates a Sundry Debtors account named after the customer
- Posts a balanced journal entry: debit Cash/Bank, credit customer receivable
- Links via reference_type='payment_received', reference_id=payment_id
- Returns the journal entry id

## Security
- SECURITY DEFINER, fixed search_path = public
- EXECUTE revoked from PUBLIC and anon, granted to authenticated
- Caller must have write access (can_write_business)
- All existing RLS remains intact
*/

CREATE OR REPLACE FUNCTION post_payment_received_journal(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_customer_name text;
  v_cash_bank_account_id uuid;
  v_receivable_account_id uuid;
  v_cash_bank_name text;
  v_entry_id uuid;
  v_existing uuid;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.type != 'received' THEN
    RAISE EXCEPTION 'This function only handles received payments';
  END IF;

  IF v_payment.party_type != 'customer' THEN
    RAISE EXCEPTION 'This function only handles customer payments';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_payment.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_payment.business_id
    AND reference_type = 'payment_received'
    AND reference_id = p_payment_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_customer_name FROM customers WHERE id = v_payment.party_id;

  -- Determine Cash/Bank account name based on payment method
  v_cash_bank_name := CASE WHEN v_payment.payment_method = 'cash' THEN 'Cash' ELSE 'Bank' END;

  -- Find or create Cash & Bank account
  v_cash_bank_account_id := find_or_create_account(
    v_payment.business_id,
    v_cash_bank_name,
    'Cash & Bank'
  );

  -- Find or create receivable (Sundry Debtors) account for this customer
  v_receivable_account_id := find_or_create_account(
    v_payment.business_id,
    v_customer_name,
    'Sundry Debtors'
  );

  -- Post the journal entry: debit Cash/Bank, credit customer receivable
  v_entry_id := post_journal_entry(
    v_payment.business_id,
    v_payment.date,
    'Payment received ' || v_payment.payment_number,
    'payment_received',
    p_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_cash_bank_account_id,
        'debit_amount', v_payment.amount,
        'credit_amount', 0
      ),
      jsonb_build_object(
        'account_id', v_receivable_account_id,
        'debit_amount', 0,
        'credit_amount', v_payment.amount
      )
    )
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_payment_received_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_payment_received_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_payment_received_journal TO authenticated;
