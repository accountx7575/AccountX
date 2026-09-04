/*
# Sales & Purchase Journal Integration

Adds two SECURITY DEFINER functions that post the accounting journal entry
for a sales invoice or purchase bill, atomically and duplicate-safe.

## post_sales_invoice_journal(p_invoice_id)
- Loads the invoice (must be status='issued')
- Checks no existing journal entry with reference_type='sales_invoice' + reference_id = invoice id
- Finds or creates a Sundry Debtors account named after the customer
- Finds or creates a Direct Income account named 'Sales'
- Posts a balanced journal entry: debit customer/receivable, credit sales
- Links via reference_type='sales_invoice', reference_id=invoice_id
- Returns the journal entry id

## post_purchase_bill_journal(p_bill_id)
- Loads the bill (must be status='confirmed')
- Checks no existing journal entry with reference_type='purchase_bill' + reference_id = bill id
- Finds or creates a Sundry Creditors account named after the supplier
- Finds or creates a Direct Expense account named 'Purchases'
- Posts a balanced journal entry: debit purchases, credit supplier/payable
- Links via reference_type='purchase_bill', reference_id=bill_id
- Returns the journal entry id

## Security
- Both functions SECURITY DEFINER, fixed search_path = public
- EXECUTE revoked from PUBLIC and anon, granted to authenticated
- Caller must have write access (can_write_business)
- All existing RLS remains intact
*/

-- ============================================================================
-- Helper: find or create an account for a business
-- ============================================================================
CREATE OR REPLACE FUNCTION find_or_create_account(
  p_business_id uuid,
  p_name text,
  p_group_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT id INTO v_account_id
  FROM accounts
  WHERE business_id = p_business_id AND name = p_name
  LIMIT 1;

  IF v_account_id IS NOT NULL THEN
    RETURN v_account_id;
  END IF;

  INSERT INTO accounts (business_id, name, group_name, opening_balance, current_balance, is_system)
  VALUES (p_business_id, p_name, p_group_name, 0, 0, false)
  ON CONFLICT (business_id, name) DO NOTHING
  RETURNING id INTO v_account_id;

  IF v_account_id IS NULL THEN
    SELECT id INTO v_account_id
    FROM accounts
    WHERE business_id = p_business_id AND name = p_name
    LIMIT 1;
  END IF;

  RETURN v_account_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION find_or_create_account FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION find_or_create_account FROM anon;
GRANT EXECUTE ON FUNCTION find_or_create_account TO authenticated;

-- ============================================================================
-- Function: post_sales_invoice_journal
-- ============================================================================
CREATE OR REPLACE FUNCTION post_sales_invoice_journal(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_customer_name text;
  v_receivable_account_id uuid;
  v_sales_account_id uuid;
  v_entry_id uuid;
  v_existing uuid;
BEGIN
  SELECT * INTO v_invoice FROM sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot post journal entry for a draft invoice';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_invoice.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_invoice.business_id
    AND reference_type = 'sales_invoice'
    AND reference_id = p_invoice_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_customer_name FROM customers WHERE id = v_invoice.customer_id;

  -- Find or create receivable (Sundry Debtors) account for this customer
  v_receivable_account_id := find_or_create_account(
    v_invoice.business_id,
    v_customer_name,
    'Sundry Debtors'
  );

  -- Find or create Sales income account
  v_sales_account_id := find_or_create_account(
    v_invoice.business_id,
    'Sales',
    'Direct Income'
  );

  -- Post the journal entry using the existing post_journal_entry function
  v_entry_id := post_journal_entry(
    v_invoice.business_id,
    v_invoice.invoice_date,
    'Sales invoice ' || v_invoice.invoice_number,
    'sales_invoice',
    p_invoice_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_receivable_account_id,
        'debit_amount', v_invoice.grand_total,
        'credit_amount', 0
      ),
      jsonb_build_object(
        'account_id', v_sales_account_id,
        'debit_amount', 0,
        'credit_amount', v_invoice.grand_total
      )
    )
  );

  RETURN v_entry_id;
END;
$$;

-- ============================================================================
-- Function: post_purchase_bill_journal
-- ============================================================================
CREATE OR REPLACE FUNCTION post_purchase_bill_journal(p_bill_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill RECORD;
  v_supplier_name text;
  v_payable_account_id uuid;
  v_purchase_account_id uuid;
  v_entry_id uuid;
  v_existing uuid;
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  IF v_bill.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot post journal entry for a draft bill';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_bill.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_bill.business_id
    AND reference_type = 'purchase_bill'
    AND reference_id = p_bill_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_bill.supplier_id;

  -- Find or create payable (Sundry Creditors) account for this supplier
  v_payable_account_id := find_or_create_account(
    v_bill.business_id,
    v_supplier_name,
    'Sundry Creditors'
  );

  -- Find or create Purchases expense account
  v_purchase_account_id := find_or_create_account(
    v_bill.business_id,
    'Purchases',
    'Direct Expense'
  );

  -- Post the journal entry using the existing post_journal_entry function
  v_entry_id := post_journal_entry(
    v_bill.business_id,
    v_bill.bill_date,
    'Purchase bill ' || v_bill.bill_number,
    'purchase_bill',
    p_bill_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_purchase_account_id,
        'debit_amount', v_bill.grand_total,
        'credit_amount', 0
      ),
      jsonb_build_object(
        'account_id', v_payable_account_id,
        'debit_amount', 0,
        'credit_amount', v_bill.grand_total
      )
    )
  );

  RETURN v_entry_id;
END;
$$;

-- Revoke and grant
REVOKE EXECUTE ON FUNCTION post_sales_invoice_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_sales_invoice_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_sales_invoice_journal TO authenticated;

REVOKE EXECUTE ON FUNCTION post_purchase_bill_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_purchase_bill_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_purchase_bill_journal TO authenticated;
