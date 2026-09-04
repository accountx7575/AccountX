/*
# Accounting Reversal for Cancelled/Voided Documents

Adds two SECURITY DEFINER functions that post a reversal journal entry
for a cancelled sales invoice or purchase bill. The reversal exactly
mirrors the original accounting entry with debits and credits swapped.

## reverse_sales_invoice_journal(p_invoice_id)
- Loads the invoice; must be status='cancelled' or 'void'
- Finds the original journal entry (reference_type='sales_invoice', reference_id=invoice_id)
- Prevents duplicate reversal entries (reference_type='sales_invoice_reversal')
- Loads the original lines, swaps debit/credit, posts a new balanced entry
- Links via reference_type='sales_invoice_reversal', reference_id=invoice_id
- Returns the reversal journal entry id

## reverse_purchase_bill_journal(p_bill_id)
- Loads the bill; must be status='cancelled'
- Finds the original journal entry (reference_type='purchase_bill', reference_id=bill_id)
- Prevents duplicate reversal entries (reference_type='purchase_bill_reversal')
- Loads the original lines, swaps debit/credit, posts a new balanced entry
- Links via reference_type='purchase_bill_reversal', reference_id=bill_id
- Returns the reversal journal entry id

## Security
- Both functions SECURITY DEFINER, fixed search_path = public
- EXECUTE revoked from PUBLIC and anon, granted to authenticated
- can_write_business enforced
- Original journal entry is never modified or deleted
- Reversal is a separate journal entry
- Existing payment allocations are not deleted
- Stock cancellation behavior is unchanged (handled by the caller)
*/

-- ============================================================================
-- Function: reverse_sales_invoice_journal
-- ============================================================================
CREATE OR REPLACE FUNCTION reverse_sales_invoice_journal(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_original_entry_id uuid;
  v_reversal_exists uuid;
  v_lines jsonb := '[]'::jsonb;
  v_line RECORD;
  v_entry_id uuid;
BEGIN
  SELECT * INTO v_invoice FROM sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice.status NOT IN ('cancelled', 'void') THEN
    RAISE EXCEPTION 'Only cancelled or void invoices can be reversed';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_invoice.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Find the original journal entry
  SELECT id INTO v_original_entry_id
  FROM journal_entries
  WHERE business_id = v_invoice.business_id
    AND reference_type = 'sales_invoice'
    AND reference_id = p_invoice_id
    AND status = 'posted'
  LIMIT 1;

  IF v_original_entry_id IS NULL THEN
    RAISE EXCEPTION 'No posted journal entry found for this invoice';
  END IF;

  -- Prevent duplicate reversal
  SELECT id INTO v_reversal_exists
  FROM journal_entries
  WHERE business_id = v_invoice.business_id
    AND reference_type = 'sales_invoice_reversal'
    AND reference_id = p_invoice_id
  LIMIT 1;

  IF v_reversal_exists IS NOT NULL THEN
    RETURN v_reversal_exists;
  END IF;

  -- Build reversal lines by swapping debit/credit from original
  FOR v_line IN
    SELECT account_id, debit_amount, credit_amount
    FROM journal_entry_lines
    WHERE entry_id = v_original_entry_id
  LOOP
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_line.account_id,
        'debit_amount', v_line.credit_amount,
        'credit_amount', v_line.debit_amount
      )
    );
  END LOOP;

  v_entry_id := post_journal_entry(
    v_invoice.business_id,
    v_invoice.invoice_date,
    'Reversal: Sales invoice ' || v_invoice.invoice_number,
    'sales_invoice_reversal',
    p_invoice_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION reverse_sales_invoice_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reverse_sales_invoice_journal FROM anon;
GRANT EXECUTE ON FUNCTION reverse_sales_invoice_journal TO authenticated;

-- ============================================================================
-- Function: reverse_purchase_bill_journal
-- ============================================================================
CREATE OR REPLACE FUNCTION reverse_purchase_bill_journal(p_bill_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill RECORD;
  v_original_entry_id uuid;
  v_reversal_exists uuid;
  v_lines jsonb := '[]'::jsonb;
  v_line RECORD;
  v_entry_id uuid;
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  IF v_bill.status != 'cancelled' THEN
    RAISE EXCEPTION 'Only cancelled bills can be reversed';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_bill.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Find the original journal entry
  SELECT id INTO v_original_entry_id
  FROM journal_entries
  WHERE business_id = v_bill.business_id
    AND reference_type = 'purchase_bill'
    AND reference_id = p_bill_id
    AND status = 'posted'
  LIMIT 1;

  IF v_original_entry_id IS NULL THEN
    RAISE EXCEPTION 'No posted journal entry found for this bill';
  END IF;

  -- Prevent duplicate reversal
  SELECT id INTO v_reversal_exists
  FROM journal_entries
  WHERE business_id = v_bill.business_id
    AND reference_type = 'purchase_bill_reversal'
    AND reference_id = p_bill_id
  LIMIT 1;

  IF v_reversal_exists IS NOT NULL THEN
    RETURN v_reversal_exists;
  END IF;

  -- Build reversal lines by swapping debit/credit from original
  FOR v_line IN
    SELECT account_id, debit_amount, credit_amount
    FROM journal_entry_lines
    WHERE entry_id = v_original_entry_id
  LOOP
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_line.account_id,
        'debit_amount', v_line.credit_amount,
        'credit_amount', v_line.debit_amount
      )
    );
  END LOOP;

  v_entry_id := post_journal_entry(
    v_bill.business_id,
    v_bill.bill_date,
    'Reversal: Purchase bill ' || v_bill.bill_number,
    'purchase_bill_reversal',
    p_bill_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION reverse_purchase_bill_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reverse_purchase_bill_journal FROM anon;
GRANT EXECUTE ON FUNCTION reverse_purchase_bill_journal TO authenticated;
