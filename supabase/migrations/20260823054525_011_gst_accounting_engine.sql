/*
# GST Accounting Engine

Updates the sales and purchase journal RPCs to post proper GST-aware
journal entries with separate Output/Input GST ledger accounts.

## Changes
1. account_nature: add 'GST Payable' and 'GST Receivable' groups (credit/debit)
2. find_or_create_gst_accounts: helper to ensure all 6 GST accounts exist
3. post_sales_invoice_journal: now posts multi-line entry splitting taxable
   value (Sales) and GST (Output CGST/SGST/IGST) — only when GST amounts > 0
4. post_purchase_bill_journal: now posts multi-line entry splitting taxable
   value (Purchases) and GST (Input CGST/SGST/IGST) — only when GST amounts > 0
5. calculate_gst: pure helper that computes CGST/SGST/IGST from taxable amount
   and tax rate, given inter-state flag — for validation and reporting

## Security
- All functions SECURITY DEFINER, fixed search_path = public
- EXECUTE revoked from PUBLIC and anon, granted to authenticated
- can_write_business enforced on all posting functions
- All existing RLS remains intact
*/

-- ============================================================================
-- Update account_nature to recognize GST groups
-- ============================================================================
CREATE OR REPLACE FUNCTION account_nature(p_group_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_group_name IN (
      'Current Assets', 'Fixed Assets', 'Direct Expense',
      'Indirect Expense', 'Sundry Debtors', 'Cash & Bank',
      'GST Receivable'
    ) THEN 'debit'
    WHEN p_group_name IN (
      'Current Liabilities', 'Long-term Liabilities', 'Capital Account',
      'Direct Income', 'Indirect Income', 'Sundry Creditors',
      'GST Payable'
    ) THEN 'credit'
    ELSE 'debit'
  END;
$$;

REVOKE EXECUTE ON FUNCTION account_nature(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION account_nature(text) FROM anon;
GRANT EXECUTE ON FUNCTION account_nature(text) TO authenticated;

-- ============================================================================
-- Helper: ensure all 6 GST accounts exist for a business, return their ids
-- ============================================================================
CREATE OR REPLACE FUNCTION find_or_create_gst_accounts(p_business_id uuid)
RETURNS TABLE (
  output_cgst uuid, output_sgst uuid, output_igst uuid,
  input_cgst uuid, input_sgst uuid, input_igst uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_oc uuid; v_os uuid; v_oi uuid;
  v_ic uuid; v_is uuid; v_ii uuid;
BEGIN
  v_oc := find_or_create_account(p_business_id, 'Output CGST', 'GST Payable');
  v_os := find_or_create_account(p_business_id, 'Output SGST', 'GST Payable');
  v_oi := find_or_create_account(p_business_id, 'Output IGST', 'GST Payable');
  v_ic := find_or_create_account(p_business_id, 'Input CGST', 'GST Receivable');
  v_is := find_or_create_account(p_business_id, 'Input SGST', 'GST Receivable');
  v_ii := find_or_create_account(p_business_id, 'Input IGST', 'GST Receivable');

  RETURN QUERY SELECT v_oc, v_os, v_oi, v_ic, v_is, v_ii;
END;
$$;

REVOKE EXECUTE ON FUNCTION find_or_create_gst_accounts FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION find_or_create_gst_accounts FROM anon;
GRANT EXECUTE ON FUNCTION find_or_create_gst_accounts TO authenticated;

-- ============================================================================
-- Helper: calculate GST amounts from taxable + rate + inter-state flag
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_gst(
  p_taxable_amount numeric,
  p_tax_rate numeric,
  p_is_inter_state boolean DEFAULT false
)
RETURNS TABLE (
  cgst_amount numeric, sgst_amount numeric, igst_amount numeric,
  total_tax numeric
)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    CASE WHEN p_is_inter_state THEN 0
      ELSE round(p_taxable_amount * p_tax_rate / 200, 2) END,
    CASE WHEN p_is_inter_state THEN 0
      ELSE round(p_taxable_amount * p_tax_rate / 200, 2) END,
    CASE WHEN p_is_inter_state
      THEN round(p_taxable_amount * p_tax_rate / 100, 2) ELSE 0 END,
    round(p_taxable_amount * p_tax_rate / 100, 2);
$$;

REVOKE EXECUTE ON FUNCTION calculate_gst FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION calculate_gst FROM anon;
GRANT EXECUTE ON FUNCTION calculate_gst TO authenticated;

-- ============================================================================
-- Updated: post_sales_invoice_journal with GST split
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
  v_gst RECORD;
  v_entry_id uuid;
  v_existing uuid;
  v_lines jsonb := '[]'::jsonb;
  v_total_tax numeric(14,2);
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

  v_receivable_account_id := find_or_create_account(
    v_invoice.business_id, v_customer_name, 'Sundry Debtors'
  );
  v_sales_account_id := find_or_create_account(
    v_invoice.business_id, 'Sales', 'Direct Income'
  );

  v_total_tax := COALESCE(v_invoice.cgst_amount, 0) + COALESCE(v_invoice.sgst_amount, 0) + COALESCE(v_invoice.igst_amount, 0);

  -- Build journal lines: debit receivable (full grand_total), credit sales (taxable) + GST
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_receivable_account_id,
      'debit_amount', v_invoice.grand_total,
      'credit_amount', 0
    ),
    jsonb_build_object(
      'account_id', v_sales_account_id,
      'debit_amount', 0,
      'credit_amount', v_invoice.taxable_amount
    )
  );

  -- Add GST lines only if there is GST
  IF v_total_tax > 0 THEN
    SELECT * INTO v_gst FROM find_or_create_gst_accounts(v_invoice.business_id);

    IF COALESCE(v_invoice.cgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_cgst,
          'debit_amount', 0,
          'credit_amount', v_invoice.cgst_amount
        )
      );
    END IF;

    IF COALESCE(v_invoice.sgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_sgst,
          'debit_amount', 0,
          'credit_amount', v_invoice.sgst_amount
        )
      );
    END IF;

    IF COALESCE(v_invoice.igst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_igst,
          'debit_amount', 0,
          'credit_amount', v_invoice.igst_amount
        )
      );
    END IF;
  END IF;

  v_entry_id := post_journal_entry(
    v_invoice.business_id,
    v_invoice.invoice_date,
    'Sales invoice ' || v_invoice.invoice_number,
    'sales_invoice',
    p_invoice_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_sales_invoice_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_sales_invoice_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_sales_invoice_journal TO authenticated;

-- ============================================================================
-- Updated: post_purchase_bill_journal with GST split
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
  v_gst RECORD;
  v_entry_id uuid;
  v_existing uuid;
  v_lines jsonb := '[]'::jsonb;
  v_total_tax numeric(14,2);
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

  v_payable_account_id := find_or_create_account(
    v_bill.business_id, v_supplier_name, 'Sundry Creditors'
  );
  v_purchase_account_id := find_or_create_account(
    v_bill.business_id, 'Purchases', 'Direct Expense'
  );

  v_total_tax := COALESCE(v_bill.cgst_amount, 0) + COALESCE(v_bill.sgst_amount, 0) + COALESCE(v_bill.igst_amount, 0);

  -- Build journal lines: debit purchases (taxable) + GST input, credit payable (full grand_total)
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_purchase_account_id,
      'debit_amount', v_bill.taxable_amount,
      'credit_amount', 0
    ),
    jsonb_build_object(
      'account_id', v_payable_account_id,
      'debit_amount', 0,
      'credit_amount', v_bill.grand_total
    )
  );

  IF v_total_tax > 0 THEN
    SELECT * INTO v_gst FROM find_or_create_gst_accounts(v_bill.business_id);

    IF COALESCE(v_bill.cgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_cgst,
          'debit_amount', v_bill.cgst_amount,
          'credit_amount', 0
        )
      );
    END IF;

    IF COALESCE(v_bill.sgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_sgst,
          'debit_amount', v_bill.sgst_amount,
          'credit_amount', 0
        )
      );
    END IF;

    IF COALESCE(v_bill.igst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_igst,
          'debit_amount', v_bill.igst_amount,
          'credit_amount', 0
        )
      );
    END IF;
  END IF;

  v_entry_id := post_journal_entry(
    v_bill.business_id,
    v_bill.bill_date,
    'Purchase bill ' || v_bill.bill_number,
    'purchase_bill',
    p_bill_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_purchase_bill_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_purchase_bill_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_purchase_bill_journal TO authenticated;
