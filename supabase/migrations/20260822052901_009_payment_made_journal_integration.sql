/*
# Payment Made Journal Integration

Adds a SECURITY DEFINER function that posts the accounting journal entry
for a supplier payment made, atomically and duplicate-safe.

## post_payment_made_journal(p_payment_id)
- Loads the payment (must be type='made', party_type='supplier')
- Checks no existing journal entry with reference_type='payment_made' + reference_id = payment id
- Finds or creates a Cash & Bank account ("Cash" for cash, "Bank" for all other methods)
- Finds or creates a Sundry Creditors (payable) account named after the supplier
- Posts a balanced journal entry: debit supplier payable, credit Cash/Bank
- Links via reference_type='payment_made', reference_id=payment_id
- Returns the journal entry id

## Security
- SECURITY DEFINER, fixed search_path = public
- EXECUTE revoked from PUBLIC and anon, granted to authenticated
- Caller must have write access (can_write_business)
- All existing RLS remains intact
*/

CREATE OR REPLACE FUNCTION post_payment_made_journal(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_supplier_name text;
  v_cash_bank_account_id uuid;
  v_payable_account_id uuid;
  v_cash_bank_name text;
  v_entry_id uuid;
  v_existing uuid;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.type != 'made' THEN
    RAISE EXCEPTION 'This function only handles made payments';
  END IF;

  IF v_payment.party_type != 'supplier' THEN
    RAISE EXCEPTION 'This function only handles supplier payments';
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
    AND reference_type = 'payment_made'
    AND reference_id = p_payment_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_payment.party_id;

  -- Determine Cash/Bank account name based on payment method
  v_cash_bank_name := CASE WHEN v_payment.payment_method = 'cash' THEN 'Cash' ELSE 'Bank' END;

  -- Find or create Cash & Bank account
  v_cash_bank_account_id := find_or_create_account(
    v_payment.business_id,
    v_cash_bank_name,
    'Cash & Bank'
  );

  -- Find or create payable (Sundry Creditors) account for this supplier
  v_payable_account_id := find_or_create_account(
    v_payment.business_id,
    v_supplier_name,
    'Sundry Creditors'
  );

  -- Post the journal entry: debit supplier payable, credit Cash/Bank
  v_entry_id := post_journal_entry(
    v_payment.business_id,
    v_payment.date,
    'Payment made ' || v_payment.payment_number,
    'payment_made',
    p_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_payable_account_id,
        'debit_amount', v_payment.amount,
        'credit_amount', 0
      ),
      jsonb_build_object(
        'account_id', v_cash_bank_account_id,
        'debit_amount', 0,
        'credit_amount', v_payment.amount
      )
    )
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_payment_made_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_payment_made_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_payment_made_journal TO authenticated;
