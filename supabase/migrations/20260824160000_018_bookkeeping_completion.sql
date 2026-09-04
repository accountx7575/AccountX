/*
# 018 — Bookkeeping completeness (T18)

## (a) post_expense_journal(p_expense_id uuid) RETURNS uuid
Expenses finally hit the books (were invisible to TB/P&L before).
- Debit: ledger named after the expense category (find-or-create,
  group 'Indirect Expense'; missing category -> 'Miscellaneous Expense').
- Credit side honours R9 and canonical cash names:
    payment_method 'cash'                      -> 'Cash'   (Cash & Bank)
    'bank'/'upi'/'card'/'cheque'               -> 'Bank'   (Cash & Bank)
    'credit' or anything else                  -> 'Expense Payable'
                                                 (Current Liabilities)
  Money only moved when it moved: 'credit' expenses post against a
  payables ledger, never against cash/bank.
- Amount = COALESCE(total_amount, amount + tax_amount); must be > 0.
- Duplicate-safe via reference_type 'expense' + reference_id (returns the
  existing entry id instead of double-posting).
- Note: expenses.payment_method has no CHECK constraint (schema reality);
  anything unrecognised lands on the payables ledger, never on cash.

## (b) post_stock_adjustment_journal(
         p_business_id uuid, p_product_id uuid, p_quantity_change numeric,
         p_reference_id uuid, p_notes text DEFAULT NULL,
         p_date date DEFAULT CURRENT_DATE) RETURNS uuid
Inventory valuation moves with adjustments (still invisible to books
today). p_reference_id (the stock_movement id driving the change) is
REQUIRED -> duplicate-safe.
- Valuation basis: abs(quantity_change) * products.selling_price — RETAIL
  basis, flagged until T41 introduces cost layers (FIFO/WAC).
- increase: Dr Inventory / Cr 'Stock Adjustments' (Indirect Expense)
  decrease: Dr 'Stock Adjustments' / Cr Inventory
  One plug ledger both directions keeps P&L net effect correct.
- Zero-valued adjustments raise (the engine forbids zero JEs anyway).

## (c) CoA seed completion — idempotent backfill
Adds the four missing system ledgers to EVERY business (existing ones get
them here; future businesses are covered lazily by find_or_create_account
on first use, since migration 002 may not be edited):
  Inventory              Current Assets
  Duties & Taxes         Current Liabilities   (GST liability home)
  Opening Balance Equity Capital Account       (counterweight for T19's
                                                opening-balance workflow)
  Capital                Capital Account

Boundaries respected: additive only, no client files, no enum changes,
taxed-doc posting bodies untouched. Statics: paired $$ bodies, IF/END IF
balanced.
*/

-- ============================================================================
-- (c) Backfill system ledgers for every business (idempotent)
-- ============================================================================
INSERT INTO public.accounts (business_id, name, group_name, opening_balance, current_balance, is_system)
SELECT b.id, s.name, s.group_name, 0, 0, true
FROM public.businesses b
CROSS JOIN (VALUES
  ('Inventory', 'Current Assets'),
  ('Duties & Taxes', 'Current Liabilities'),
  ('Opening Balance Equity', 'Capital Account'),
  ('Capital', 'Capital Account')
) AS s(name, group_name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts x
  WHERE x.business_id = b.id AND x.name = s.name
);

-- ============================================================================
-- (a) Expense journal path
-- ============================================================================
CREATE OR REPLACE FUNCTION post_expense_journal(p_expense_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense RECORD;
  v_category_name text;
  v_expense_account_id uuid;
  v_credit_account_id uuid;
  v_entry_id uuid;
  v_existing uuid;
  v_lines jsonb;
  v_amount numeric(14,2);
BEGIN
  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_expense.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Duplicate-safe: one journal per expense
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_expense.business_id
    AND reference_type = 'expense'
    AND reference_id = p_expense_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_amount := round(COALESCE(v_expense.total_amount,
                             COALESCE(v_expense.amount, 0) + COALESCE(v_expense.tax_amount, 0)), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Expense has no postable amount';
  END IF;

  SELECT name INTO v_category_name
  FROM expense_categories
  WHERE id = v_expense.category_id AND business_id = v_expense.business_id;

  v_expense_account_id := find_or_create_account(
    v_expense.business_id,
    COALESCE(v_category_name, 'Miscellaneous Expense'),
    'Indirect Expense'
  );

  -- R9: money moved vs money owed
  v_credit_account_id := CASE v_expense.payment_method
    WHEN 'cash' THEN find_or_create_account(v_expense.business_id, 'Cash', 'Cash & Bank')
    WHEN 'bank' THEN find_or_create_account(v_expense.business_id, 'Bank', 'Cash & Bank')
    WHEN 'upi'  THEN find_or_create_account(v_expense.business_id, 'Bank', 'Cash & Bank')
    WHEN 'card' THEN find_or_create_account(v_expense.business_id, 'Bank', 'Cash & Bank')
    WHEN 'cheque' THEN find_or_create_account(v_expense.business_id, 'Bank', 'Cash & Bank')
    ELSE find_or_create_account(v_expense.business_id, 'Expense Payable', 'Current Liabilities')
  END;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_expense_account_id,
      'debit_amount', v_amount,
      'credit_amount', 0
    ),
    jsonb_build_object(
      'account_id', v_credit_account_id,
      'debit_amount', 0,
      'credit_amount', v_amount
    )
  );

  v_entry_id := post_journal_entry(
    v_expense.business_id,
    v_expense.date,
    'Expense ' || v_expense.expense_number || COALESCE(' - ' || v_expense.description, ''),
    'expense',
    p_expense_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_expense_journal(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_expense_journal(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION post_expense_journal(uuid) TO authenticated;

-- ============================================================================
-- (b) Stock adjustment journal path (retail valuation until T41)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_stock_adjustment_journal(
  p_business_id uuid,
  p_product_id uuid,
  p_quantity_change numeric,
  p_reference_id uuid,
  p_notes text DEFAULT NULL,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
  v_existing uuid;
  v_value numeric(14,2);
  v_inventory_account_id uuid;
  v_plug_account_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF COALESCE(p_quantity_change, 0) = 0 THEN
    RAISE EXCEPTION 'Quantity change must be non-zero';
  END IF;

  IF p_reference_id IS NULL THEN
    RAISE EXCEPTION 'reference_id (stock_movement id) is required';
  END IF;

  -- Duplicate-safe: one journal per adjustment movement
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = p_business_id
    AND reference_type = 'stock_adjustment'
    AND reference_id = p_reference_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM products
    WHERE id = p_product_id AND business_id = p_business_id AND type = 'product'
  ) THEN
    RAISE EXCEPTION 'Product % not found in this business', p_product_id;
  END IF;

  SELECT round(COALESCE(selling_price, 0) * abs(p_quantity_change), 2)
  INTO v_value
  FROM products
  WHERE id = p_product_id;

  IF v_value <= 0 THEN
    RAISE EXCEPTION 'Adjustment value is zero (selling price x quantity); nothing to journal';
  END IF;

  v_inventory_account_id := find_or_create_account(p_business_id, 'Inventory', 'Current Assets');
  v_plug_account_id := find_or_create_account(p_business_id, 'Stock Adjustments', 'Indirect Expense');

  IF p_quantity_change > 0 THEN
    -- stock came in: inventory up
    v_entry_id := post_journal_entry(
      p_business_id,
      p_date,
      'Stock adjustment ' || COALESCE(p_notes, ''),
      'stock_adjustment',
      p_reference_id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_inventory_account_id, 'debit_amount', v_value, 'credit_amount', 0),
        jsonb_build_object('account_id', v_plug_account_id, 'debit_amount', 0, 'credit_amount', v_value)
      )
    );
  ELSE
    -- stock went out: inventory down
    v_entry_id := post_journal_entry(
      p_business_id,
      p_date,
      'Stock adjustment ' || COALESCE(p_notes, ''),
      'stock_adjustment',
      p_reference_id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_plug_account_id, 'debit_amount', v_value, 'credit_amount', 0),
        jsonb_build_object('account_id', v_inventory_account_id, 'debit_amount', 0, 'credit_amount', v_value)
      )
    );
  END IF;

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_stock_adjustment_journal(uuid, uuid, numeric, uuid, text, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_stock_adjustment_journal(uuid, uuid, numeric, uuid, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION post_stock_adjustment_journal(uuid, uuid, numeric, uuid, text, date) TO authenticated;
