/*
# 013b — Balanced journals (round_off + cess) & canonical cash/bank names

Fixes audit findings §3.2 (unbalanced JEs) and §3.3 (duplicate cash ledgers).

## Part A/B — round_off + cess journaled (post_sales_invoice_journal,
              post_purchase_bill_journal re-emitted from 011 verbatim plus
              the new lines)

Canonical balancing identity enforced by the posting engine:

  grand_total = taxable_amount + cgst_amount + sgst_amount + igst_amount
              + COALESCE(cess_amount,0) + COALESCE(round_off,0)

- Sales: debit receivable grand_total; credit taxable, output GST, output
  cess; 'Round Off' credited when positive, debited at |amount| when
  negative (it is the plugging figure).
- Purchase: mirror image — debit taxable, input GST, input cess and
  Round Off (positive case); credit payable grand_total.
- Cess homes: 'Output Cess' in group 'GST Payable', 'Input Cess' in group
  'GST Receivable' (both legalised by 013a; account_nature already maps
  these groups credit/debit respectively).
- 'Round Off' ledger home: group 'Indirect Income' (debits when negative
  act as the expense side of rounding within one ledger).
- Untaxed / unrounded documents take exactly the same two-line path as
  before — every new line is behind an IF guard, behaviour preserved.

## Part C — ONE canonical cash/bank pair ('Cash' / 'Bank')

Decision taken ONCE, per dispatch: canonical names are 'Cash' and 'Bank'
(the names every payment JE already looks up). Seeds are renamed to match;
no payment RPC is edited.

1. Data backfill for existing businesses: legacy seeds 'Cash In Hand' /
   'Bank Account' are merged into 'Cash' / 'Bank' — balances folded,
   journal_entry_lines re-pointed, legacy rows deleted.
2. Forward fix WITHOUT rewriting 002 (forbidden): BEFORE INSERT OR UPDATE
   trigger renames any account called 'Cash In Hand'/'Bank Account' to
   the canonical name at the gate, so newly seeded businesses land on the
   canonical pair from day one and future splits are impossible.
*/

-- ============================================================================
-- Part C.2 first (gate): normalise seed names on write
-- ============================================================================
CREATE OR REPLACE FUNCTION normalize_cash_bank_seed_names()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.name = 'Cash In Hand' THEN
    NEW.name := 'Cash';
  ELSIF NEW.name = 'Bank Account' THEN
    NEW.name := 'Bank';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION normalize_cash_bank_seed_names() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION normalize_cash_bank_seed_names() FROM anon;

DROP TRIGGER IF EXISTS trg_accounts_normalize_cash_bank ON public.accounts;

CREATE TRIGGER trg_accounts_normalize_cash_bank
  BEFORE INSERT OR UPDATE OF name ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION normalize_cash_bank_seed_names();

-- ============================================================================
-- Part C.1 — backfill/merge legacy seeds into canonical pair
-- ============================================================================
-- Map used by every step below:
--   'Cash In Hand' -> 'Cash'      'Bank Account' -> 'Bank'

-- 1) Create the canonical account where a business has only the legacy seed
INSERT INTO public.accounts (business_id, name, group_name, opening_balance, current_balance, is_system)
SELECT l.business_id,
       m.canonical,
       l.group_name,
       0,
       0,
       true
FROM public.accounts l
JOIN (VALUES ('Cash In Hand', 'Cash'),
             ('Bank Account', 'Bank')) AS m(legacy, canonical)
  ON l.name = m.legacy
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts c
  WHERE c.business_id = l.business_id AND c.name = m.canonical
);

-- 2) Fold legacy opening/current balances into the canonical account
UPDATE public.accounts c
SET opening_balance = c.opening_balance + l.opening_balance,
    current_balance = c.current_balance + l.current_balance
FROM public.accounts l
JOIN (VALUES ('Cash In Hand', 'Cash'),
             ('Bank Account', 'Bank')) AS m(legacy, canonical)
  ON l.name = m.legacy
WHERE c.business_id = l.business_id
  AND c.name = m.canonical
  AND (l.opening_balance <> 0 OR l.current_balance <> 0);

-- 3) Re-point journal entry lines onto the canonical account
UPDATE public.journal_entry_lines lin
SET account_id = c.id
FROM public.accounts l
JOIN (VALUES ('Cash In Hand', 'Cash'),
             ('Bank Account', 'Bank')) AS m(legacy, canonical)
  ON l.name = m.legacy
JOIN public.accounts c
  ON c.business_id = l.business_id AND c.name = m.canonical
WHERE lin.account_id = l.id;

-- 4) Drop the legacy accounts (lines re-pointed above, FK no longer blocks)
DELETE FROM public.accounts l
USING (VALUES ('Cash In Hand'), ('Bank Account')) AS m(legacy)
WHERE l.name = m.legacy;

-- ============================================================================
-- Part A — post_sales_invoice_journal: + cess line, + signed round_off line
--          (otherwise byte-identical to migration 011)
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
  v_cess_account_id uuid;
  v_round_off_account_id uuid;
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

  -- Cess liability line (group home legalised by 013a)
  IF COALESCE(v_invoice.cess_amount, 0) > 0 THEN
    v_cess_account_id := find_or_create_account(
      v_invoice.business_id, 'Output Cess', 'GST Payable'
    );
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_cess_account_id,
        'debit_amount', 0,
        'credit_amount', v_invoice.cess_amount
      )
    );
  END IF;

  -- Rounding plug: credit when positive, debit |amount| when negative
  IF COALESCE(v_invoice.round_off, 0) <> 0 THEN
    v_round_off_account_id := find_or_create_account(
      v_invoice.business_id, 'Round Off', 'Indirect Income'
    );
    IF v_invoice.round_off > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', 0,
          'credit_amount', v_invoice.round_off
        )
      );
    ELSE
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', abs(v_invoice.round_off),
          'credit_amount', 0
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
-- Part B — post_purchase_bill_journal: + input cess line, + signed round_off
--          (otherwise byte-identical to migration 011)
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
  v_cess_account_id uuid;
  v_round_off_account_id uuid;
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

  -- Input cess asset line (group home legalised by 013a)
  IF COALESCE(v_bill.cess_amount, 0) > 0 THEN
    v_cess_account_id := find_or_create_account(
      v_bill.business_id, 'Input Cess', 'GST Receivable'
    );
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_cess_account_id,
        'debit_amount', v_bill.cess_amount,
        'credit_amount', 0
      )
    );
  END IF;

  -- Rounding plug (mirror of sales): debit when positive (adds to cost),
  -- credit |amount| when negative
  IF COALESCE(v_bill.round_off, 0) <> 0 THEN
    v_round_off_account_id := find_or_create_account(
      v_bill.business_id, 'Round Off', 'Indirect Income'
    );
    IF v_bill.round_off > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', v_bill.round_off,
          'credit_amount', 0
        )
      );
    ELSE
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', 0,
          'credit_amount', abs(v_bill.round_off)
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
